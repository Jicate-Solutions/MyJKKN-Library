/**
 * One scan at the gate: POST /api/lib/visits/scan
 *
 * The card is scanned on the way in and again on the way out, so the server —
 * not the page — decides which of the two this scan is. The page cannot know
 * reliably: two quick scans of the same card would both read the same loaded
 * list, both conclude "not inside yet", and open two entries for one person.
 *
 * Times are the library's own clock, never the server's.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { istToday, istTimeNow } from '@/lib/library/ist-clock'
import { fetchLearnerPhoto } from '@/lib/library/learner-photo'

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

		const supabase = getSupabaseServer()

		// The member number is the card number. Matched whole and case
		// insensitively, so a typed `pb23001` finds what a scanner finds.
		const { data: members, error: memberError } = await supabase
			.from('lib_members')
			.select('id, member_number, display_name, member_category, learner_id, is_active')
			.eq('institution_id', institutionId)
			.ilike('member_number', barcode)
			.limit(1)

		if (memberError) {
			console.error('Error looking up member at the gate:', memberError)
			return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
		}

		const member = members?.[0]
		if (!member) {
			return NextResponse.json({ error: `No member found for "${barcode}"` }, { status: 404 })
		}

		const visitDate = istToday()
		const now = istTimeNow()

		// Still inside from an earlier scan today?
		const { data: openVisits } = await supabase
			.from('lib_member_visits')
			.select('id, entry_time')
			.eq('institution_id', institutionId)
			.eq('member_id', member.id)
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
					member_id: member.id,
					visit_date: visitDate,
					entry_time: now,
					visit_purpose: body.visit_purpose ?? null,
				})
				.select('id, entry_time')
				.single()

			if (openError || !opened) {
				console.error('Error recording entry:', openError)
				return NextResponse.json({ error: 'Could not record the entry' }, { status: 500 })
			}

			visitId = opened.id
			entryTime = opened.entry_time
		}

		// Only after the visit is safely recorded — the face on the screen is
		// worth waiting a moment for, but never worth losing an entry over.
		const photo = member.member_category === 'learner'
			? await fetchLearnerPhoto(member.learner_id)
			: null

		return NextResponse.json({
			direction,
			at: direction === 'out' ? now : entryTime,
			visit: { id: visitId, visit_date: visitDate, entry_time: entryTime, exit_time: direction === 'out' ? now : null },
			member: {
				id: member.id,
				member_number: member.member_number,
				display_name: member.display_name,
				member_category: member.member_category,
				is_active: member.is_active,
				photo_url: photo,
			},
		})
	} catch (error) {
		console.error('Unexpected error at the gate:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
