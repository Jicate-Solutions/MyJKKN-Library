/**
 * One scan at the gate: POST /api/lib/visits/scan
 *
 * The card is scanned on the way in and again on the way out, so the server —
 * not the page — decides which of the two this scan is. The page cannot know
 * reliably: two quick scans of the same card would both read the same loaded
 * list, both conclude "not inside yet", and open two entries for one person.
 *
 * Who the card belongs to comes from MyJKKN. Walking into the library is not
 * borrowing, so a gate scan writes no borrower row — the visit carries the
 * person itself: their MyJKKN id, and the name and number the register prints.
 *
 * Times are the library's own clock, never the server's.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { istToday, istTimeNow, formatClockTime } from '@/lib/library/ist-clock'
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { personByCardNumber, myjkknConfigured, type DirectoryPerson } from '@/lib/library/myjkkn-directory'

/** Said once per server, not once per scan. */
let warnedNoFunction = false

/**
 * Seconds from one wall-clock time to another on the same day.
 *
 * Times are stored as the library's own HH:MM:SS. A value carrying a 'T' is an
 * older row stamped as a full timestamp, and is compared as one.
 */
function secondsBetween(earlier: string, later: string): number | null {
	if (earlier.includes('T') || later.includes('T')) {
		const a = new Date(earlier).getTime()
		const b = new Date(later).getTime()
		return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 1000)
	}
	const toSeconds = (value: string) => {
		const [h, m, s] = value.split(':').map(Number)
		return [h, m].some(Number.isNaN) ? null : h * 3600 + m * 60 + (Number.isNaN(s) ? 0 : s)
	}
	const a = toSeconds(earlier)
	const b = toSeconds(later)
	return a === null || b === null ? null : b - a
}

/** What one scan came to, or why it could not be recorded. */
type ScanOutcome =
	| { direction: 'in' | 'out'; visitId: string | null; entryTime: string | null }
	| { error: string; status: number }

interface ScanInput {
	institutionId: string
	person: DirectoryPerson
	visitDate: string
	now: string
	visitPurpose: string | null
}

/** The gate columns arrive with the 2026-08-22 database update. */
const NEEDS_DB_UPDATE =
	'This library\'s database has not been updated for the new member system yet — please run the pending database update'

/**
 * One scan, one round trip.
 *
 * `lib_gate_scan` decides entry or exit and writes it in a single statement.
 * Every round trip to the database costs about 75ms of network whatever it
 * asks, so doing this as two dependent queries spent half the student's wait
 * on the second question travelling.
 *
 * Returns null when the function is not installed — a library that has not run
 * the 2026-08-27 update falls back to the two queries below and behaves
 * exactly as it did before.
 */
async function scanInOneTrip(
	supabase: ReturnType<typeof getSupabaseServer>,
	{ institutionId, person, visitDate, now, visitPurpose }: ScanInput
): Promise<ScanOutcome | null> {
	const { data, error } = await supabase.rpc('lib_gate_scan', {
		p_institution_id: institutionId,
		p_myjkkn_id: person.myjkkn_id,
		p_person_kind: person.person_kind,
		p_member_number: person.member_number,
		p_display_name: person.display_name,
		p_member_category: person.member_category,
		p_visit_date: visitDate,
		p_now: now,
		p_visit_purpose: visitPurpose,
	})

	// Anything at all wrong with the fast path hands the scan to the two queries
	// below rather than failing. PGRST202 is simply a database without the
	// function, which is the normal state until the update is run; anything else
	// is worth shouting about in the log, but not worth stopping a queue at the
	// door for. One function call is one statement, so a failed call wrote
	// nothing and the fallback cannot double-record the visit.
	if (error) {
		if (error.code !== 'PGRST202' && error.code !== '42883') {
			console.error('[gate] lib_gate_scan failed, falling back to two queries:', error)
		} else if (!warnedNoFunction) {
			warnedNoFunction = true
			console.warn('[gate] lib_gate_scan is not installed on this database — run the 2026-08-27 update (supabase/migrations/20260827_*.sql). Until then every scan costs two round trips instead of one.')
		}
		return null
	}

	const row = (Array.isArray(data) ? data[0] : data) as {
		out_direction?: 'in' | 'out'
		out_visit_id?: string
		out_entry_time?: string
	} | undefined

	if (!row?.out_direction) {
		console.error('[gate] lib_gate_scan returned nothing for', person.member_number)
		return null
	}

	return {
		direction: row.out_direction,
		visitId: row.out_visit_id ?? null,
		entryTime: row.out_entry_time ?? null,
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const barcode = (body.barcode ?? '').toString().trim()
		if (!barcode) {
			return NextResponse.json({ error: 'Scan a card or type an ID' }, { status: 400 })
		}

		if (!myjkknConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so cards cannot be checked' },
				{ status: 503 }
			)
		}

		// Only this college's Active people. Someone from another campus, or
		// someone MyJKKN no longer has as active, simply is not found.
		const person = await personByCardNumber(institutionId, barcode)
		if (!person) {
			return NextResponse.json(
				{ error: `No member found for "${barcode}"` },
				{ status: 404 }
			)
		}

		const supabase = getSupabaseServer()
		const visitDate = istToday()
		const now = istTimeNow()

		// The same card again, seconds later, is the same entry — a student
		// unsure the first scan took, not one leaving. Read as an exit it made a
		// one-minute visit and counted them twice in the footfall. The window is
		// this college's own setting; 0 turns the check off and costs nothing.
		const settings = await getInstitutionSettings(institutionId)
		const rescanWindow = Number(settings.gate_rescan_seconds ?? 0)
		if (rescanWindow > 0) {
			const { data: open } = await supabase
				.from('lib_member_visits')
				.select('id, entry_time')
				.eq('institution_id', institutionId)
				.eq('myjkkn_id', person.myjkkn_id)
				.eq('visit_date', visitDate)
				.not('entry_time', 'is', null)
				.is('exit_time', null)
				.order('created_at', { ascending: false })
				.limit(1)

			const since = open?.[0]?.entry_time as string | undefined
			const ago = since ? secondsBetween(since, now) : null
			if (since && ago !== null && ago >= 0 && ago < rescanWindow) {
				return NextResponse.json(
					{
						error: `${person.display_name} is already in since ${formatClockTime(since)} — to mark them out, scan again after ${rescanWindow - ago}s`,
						repeat: true,
						since,
						member: { display_name: person.display_name, member_number: person.member_number, photo_url: person.photo_url },
					},
					{ status: 409 }
				)
			}
		}

		const input: ScanInput = {
			institutionId,
			person,
			visitDate,
			now,
			visitPurpose: body.visit_purpose ?? null,
		}

		const recorded = (await scanInOneTrip(supabase, input)) ?? (await scanInTwoTrips(supabase, input))
		if ('error' in recorded) {
			return NextResponse.json({ error: recorded.error }, { status: recorded.status })
		}

		const { direction, visitId, entryTime } = recorded

		return NextResponse.json({
			direction,
			at: direction === 'out' ? now : entryTime,
			visit: { id: visitId, visit_date: visitDate, entry_time: entryTime, exit_time: direction === 'out' ? now : null },
			member: {
				// MyJKKN's id. There is no membership row to point at any more.
				id: person.myjkkn_id,
				myjkkn_id: person.myjkkn_id,
				person_kind: person.person_kind,
				member_number: person.member_number,
				display_name: person.display_name,
				member_category: person.member_category,
				role_label: person.role_label,
				// Only Active people are ever found above
				is_active: true,
				// Already in hand from the same read — no second trip for a face
				photo_url: person.photo_url,
			},
		})
	} catch (error) {
		console.error('Unexpected error at the gate:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

/**
 * The same scan as two separate queries, for a database without the function.
 *
 * Left exactly as it was written, down to the race it guards against, so a
 * library that has not run the update sees no change in behaviour at all.
 */
async function scanInTwoTrips(
	supabase: ReturnType<typeof getSupabaseServer>,
	{ institutionId, person, visitDate, now, visitPurpose }: ScanInput
): Promise<ScanOutcome> {
	// Still inside from an earlier scan today?
	const { data: openVisits } = await supabase
		.from('lib_member_visits')
		.select('id, entry_time')
		.eq('institution_id', institutionId)
		.eq('myjkkn_id', person.myjkkn_id)
		.eq('visit_date', visitDate)
		.not('entry_time', 'is', null)
		.is('exit_time', null)
		.order('created_at', { ascending: false })
		.limit(1)

	const openVisit = openVisits?.[0]
	let direction: 'in' | 'out' = 'in'
	let visitId: string | null = null
	let entryTime: string | null = null

	if (openVisit) {
		// `.is('exit_time', null)` in the update as well: if a second scan of
		// the same card lands at the same moment, only one of them writes an
		// exit and the other is told to try again rather than overwriting it.
		const { data: closed, error: closeError } = await supabase
			.from('lib_member_visits')
			.update({ exit_time: now })
			.eq('id', openVisit.id)
			.is('exit_time', null)
			.select('id, entry_time, exit_time')

		if (closeError) {
			console.error('Error recording exit:', closeError)
			return { error: 'Could not record the exit', status: 500 }
		}

		if (closed && closed.length > 0) {
			direction = 'out'
			visitId = closed[0].id
			entryTime = closed[0].entry_time
		}
		// Nothing updated means the visit was closed a moment ago by another
		// scan — fall through and treat this one as a fresh entry.
	}

	if (direction === 'in') {
		const { data: opened, error: openError } = await supabase
			.from('lib_member_visits')
			.insert({
				institution_id: institutionId,
				// No borrower row: nobody becomes a borrower by walking in.
				member_id: null,
				myjkkn_id: person.myjkkn_id,
				person_kind: person.person_kind,
				member_number: person.member_number,
				display_name: person.display_name,
				member_category: person.member_category,
				visit_date: visitDate,
				entry_time: now,
				visit_purpose: visitPurpose,
			})
			.select('id, entry_time')
			.single()

		if (openError || !opened) {
			console.error('Error recording entry:', openError)
			if (openError?.code === '42703') return { error: NEEDS_DB_UPDATE, status: 400 }
			return { error: 'Could not record the entry', status: 500 }
		}

		visitId = opened.id
		entryTime = opened.entry_time
	}

	return { direction, visitId, entryTime }
}
