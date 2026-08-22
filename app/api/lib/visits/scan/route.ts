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
import { istToday, istTimeNow } from '@/lib/library/ist-clock'
import { personByCardNumber, myjkknConfigured } from '@/lib/library/myjkkn-directory'

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
				return NextResponse.json({ error: 'Could not record the exit' }, { status: 500 })
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
					visit_purpose: body.visit_purpose ?? null,
				})
				.select('id, entry_time')
				.single()

			if (openError || !opened) {
				console.error('Error recording entry:', openError)
				// The gate columns arrive with the 2026-08-22 database update
				if (openError?.code === '42703') {
					return NextResponse.json(
						{ error: 'This library\'s database has not been updated for the new member system yet — please run the pending database update' },
						{ status: 400 }
					)
				}
				return NextResponse.json({ error: 'Could not record the entry' }, { status: 500 })
			}

			visitId = opened.id
			entryTime = opened.entry_time
		}

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
