/**
 * The signed letter behind a waived fine.
 *
 * POST /api/lib/circulation/waiver-document   (multipart: institution_id, file)
 *   → { path, name }   the path is then sent with the settle request
 *
 * GET  /api/lib/circulation/waiver-document?charge_id=…
 *   → { url, name }    a link that works for five minutes, then stops
 *
 * The file never travels to or from the browser's own Supabase client. It goes
 * through here, on the service role, because the bucket is private and must
 * stay that way: a waiver letter names a learner and says why they could not
 * pay, and that is not something to leave on a URL which outlives the person
 * who opened it.
 *
 * Institution scoping lives in the object path — `<institution_id>/<file>` —
 * and the GET re-reads the charge through the guard before signing anything,
 * so a librarian cannot read another college's letters by holding a path.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'

export const BUCKET = 'library-waivers'

const ALLOWED = new Map([
	['application/pdf', 'pdf'],
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
])

const MAX_BYTES = 1024 * 1024

/**
 * A file size next to a 1 MB cap.
 *
 * Megabytes to one decimal would call 1,074,000 bytes "1.0 MB" and then
 * refuse it for being over 1 MB, which reads like a bug. Anything near
 * the limit is given in KB instead, where the comparison is obvious.
 */
const sizeLabel = (bytes: number) =>
	bytes < 2 * 1024 * 1024
		? `${Math.round(bytes / 1024)} KB`
		: `${(bytes / 1048576).toFixed(1)} MB`

/** A missing bucket means the migration has not been run — say which one. */
const notSetUp = (message: string) =>
	/bucket.*not found|does not exist/i.test(message)

/**
 * A file name safe to put in an object path, with its extension kept.
 *
 * Whatever the librarian's machine called it — spaces, Tamil, a slash — the
 * stored name is reduced to something a path can hold. The name they typed is
 * kept separately on the charge, for the link to show.
 */
function safeName(original: string, ext: string): string {
	const base = original.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
	return `${base.slice(0, 60) || 'letter'}.${ext}`
}

export async function POST(request: Request) {
	try {
		// Parsed defensively: a request that is not multipart at all throws
		// here, and that is a bad request, not a server fault.
		const form = await request.formData().catch(() => null)
		if (!form) {
			return NextResponse.json({ error: 'Send the letter as a file upload' }, { status: 400 })
		}
		const file = form.get('file')
		const asked = form.get('institution_id')

		const guard = await guardWrite(request, typeof asked === 'string' ? asked : null)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId

		if (!institutionId) {
			return NextResponse.json({ error: 'Name the college this waiver belongs to' }, { status: 400 })
		}
		if (!(file instanceof File)) {
			return NextResponse.json({ error: 'Choose a file to upload' }, { status: 400 })
		}

		const ext = ALLOWED.get(file.type)
		if (!ext) {
			return NextResponse.json(
				{ error: 'The letter has to be a PDF, a JPG or a PNG' },
				{ status: 400 }
			)
		}
		if (file.size > MAX_BYTES) {
			return NextResponse.json(
				{ error: `That file is ${sizeLabel(file.size)} — 1 MB is the most we can take` },
				{ status: 400 }
			)
		}
		if (file.size === 0) {
			return NextResponse.json({ error: 'That file is empty' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		// The college is in the path, so one college's letters cannot be listed
		// from another's, whatever is passed in later.
		const path = `${institutionId}/${crypto.randomUUID()}-${safeName(file.name, ext)}`

		const { error } = await supabase.storage
			.from(BUCKET)
			.upload(path, file, { contentType: file.type, upsert: false })

		if (error) {
			const message = String(error.message ?? error)
			if (notSetUp(message)) {
				return NextResponse.json(
					{ error: 'Waiver letters are not set up yet — run migration 20261013_lib_waiver_document.sql' },
					{ status: 503 }
				)
			}
			console.error('Could not store a waiver letter:', error)
			return NextResponse.json({ error: 'Could not upload the letter' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'file_upload',
			resource_type: 'late_charge',
			resource_id: '/circulation',
			institution_id: institutionId,
			metadata: { waiver_letter: file.name, bytes: file.size },
		})

		return NextResponse.json({ path, name: file.name })
	} catch (error) {
		console.error('Unexpected error uploading a waiver letter:', error)
		return NextResponse.json({ error: 'Could not upload the letter' }, { status: 500 })
	}
}

export async function GET(request: Request) {
	try {
		const chargeId = new URL(request.url).searchParams.get('charge_id')
		if (!chargeId) {
			return NextResponse.json({ error: 'Which waiver?' }, { status: 400 })
		}

		// Reads the charge through the guard first: another college's charge is
		// a 404 here, so a letter cannot be reached by holding on to its id.
		const guard = await guardRecord(request, 'lib_late_charges', chargeId)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()
		const { data: charge, error } = await supabase
			.from('lib_late_charges')
			.select('id, waiver_document_path, waiver_document_name')
			.eq('id', chargeId)
			.maybeSingle()

		if (error?.code === '42703') {
			return NextResponse.json(
				{ error: 'Waiver letters are not set up yet — run migration 20261013_lib_waiver_document.sql' },
				{ status: 503 }
			)
		}
		if (!charge?.waiver_document_path) {
			return NextResponse.json({ error: 'No letter was kept with this waiver' }, { status: 404 })
		}

		// Five minutes: long enough to open and read, short enough that a link
		// copied out of the address bar is useless by the time it is shared.
		const { data: signed, error: signError } = await supabase.storage
			.from(BUCKET)
			.createSignedUrl(charge.waiver_document_path, 300)

		if (signError || !signed?.signedUrl) {
			console.error('Could not sign a waiver letter link:', signError)
			return NextResponse.json({ error: 'Could not open the letter' }, { status: 500 })
		}

		// Who looked at a waiver letter is worth keeping: it is the paper that
		// justified money being let go, and somebody will ask one day.
		await logActivity(request, {
			action: 'file_download',
			resource_type: 'late_charge',
			resource_id: '/circulation/charges',
			institution_id: guard.institutionId,
			metadata: { charge_id: charge.id, waiver_letter: charge.waiver_document_name ?? null },
		})

		return NextResponse.json({ url: signed.signedUrl, name: charge.waiver_document_name ?? 'Letter' })
	} catch (error) {
		console.error('Unexpected error opening a waiver letter:', error)
		return NextResponse.json({ error: 'Could not open the letter' }, { status: 500 })
	}
}
