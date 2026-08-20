/**
 * Enrolling a ticked list of learners: POST /api/lib/members/bulk
 *
 * The Bulk tab sends the learners the librarian ticked, in chunks, so the
 * screen can show how far it has got. Each learner is written on their own —
 * one that fails does not take the rest of the chunk down with it, and comes
 * back named, with the reason.
 *
 * A learner's member number is their MyJKKN roll number, exactly as it is when
 * they are enrolled one at a time, so a card issued through this tab scans the
 * same at the gate.
 *
 * Dates are not decided here. Each learner arrives with the start and end date
 * of their own batch, which is the whole point of enrolling by program.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { getInstitutionSettings } from '@/lib/library/institution-settings'

interface IncomingLearner {
	/** MyJKKN id — a learner's profile id, or a staff member's */
	learner_id?: string
	display_name?: string
	roll_number?: string
	email?: string | null
	phone?: string | null
	membership_start_date?: string
	membership_end_date?: string | null
}

interface Failure {
	name: string
	roll_number: string
	error: string
}

const text = (value: unknown): string => (value ?? '').toString().trim()

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const learners: IncomingLearner[] = Array.isArray(body.learners) ? body.learners : []
		if (learners.length === 0) {
			return NextResponse.json({ error: 'No learners were sent' }, { status: 400 })
		}

		// Learners carry their roll number as their member number; facilitators
		// have no such number, so the library gives them one.
		const isFacilitator = body.category === 'facilitator'
		const linkColumn = isFacilitator ? 'facilitator_id' : 'learner_id'

		const supabase = getSupabaseServer()

		// Everything already taken in this library, read once rather than twice per
		// person. Scoped to this institution — another campus's roll number is a
		// different person and must not block this one.
		const peopleIds = learners.map(l => text(l.learner_id)).filter(Boolean)
		const rollNumbers = learners.map(l => text(l.roll_number)).filter(Boolean)

		const [{ data: byPerson }, { data: byNumber }] = await Promise.all([
			supabase
				.from('lib_members')
				.select(`${linkColumn}, member_number`)
				.eq('institution_id', institutionId)
				.in(linkColumn, peopleIds.length > 0 ? peopleIds : ['00000000-0000-0000-0000-000000000000']),
			supabase
				.from('lib_members')
				.select('member_number, display_name')
				.eq('institution_id', institutionId)
				.in('member_number', rollNumbers.length > 0 ? rollNumbers : ['—none—']),
		])

		const enrolled = new Map(
			((byPerson || []) as Record<string, any>[]).map(m => [m[linkColumn] as string, m.member_number as string])
		)
		const numberTaken = new Map((byNumber || []).map(m => [m.member_number as string, (m.display_name ?? 'another member') as string]))

		// The running number this library hands out, continued from the highest
		// one already issued this year — deleting a member never frees a number.
		const settings = await getInstitutionSettings(institutionId)
		const prefix = `${settings.member_number_prefix}-${new Date().getFullYear()}-`
		let nextSequence = 0

		if (isFacilitator) {
			const { data: last } = await supabase
				.from('lib_members')
				.select('member_number')
				.eq('institution_id', institutionId)
				.like('member_number', `${prefix}%`)
				.order('member_number', { ascending: false })
				.limit(1)
				.maybeSingle()

			const lastSequence = last?.member_number
				? parseInt(last.member_number.slice(prefix.length), 10)
				: 0
			nextSequence = Number.isFinite(lastSequence) ? lastSequence : 0
		}

		const failures: Failure[] = []
		let created = 0

		for (const learner of learners) {
			const personId = text(learner.learner_id)
			const name = text(learner.display_name) || text(learner.roll_number) || (isFacilitator ? 'Unnamed staff member' : 'Unnamed learner')
			const rollNumber = text(learner.roll_number)
			const start = text(learner.membership_start_date)
			const end = text(learner.membership_end_date)

			// A facilitator's number comes from the library's own run, unless this
			// campus has said it uses college IDs and this person has one.
			const usesCollegeId = settings.member_number_source === 'college_id' && !!rollNumber
			const memberNumber = isFacilitator && !usesCollegeId
				? `${prefix}${String(nextSequence + 1).padStart(4, '0')}`
				: rollNumber

			const problem =
				!personId ? 'Missing MyJKKN id'
					: !isFacilitator && !rollNumber ? 'No roll number in MyJKKN'
						: !start ? (isFacilitator ? 'No start date given' : 'No batch start date in MyJKKN')
							: enrolled.has(personId) ? `Already a member (${enrolled.get(personId)})`
								: numberTaken.has(memberNumber) ? `Member number ${memberNumber} is already used by ${numberTaken.get(memberNumber)}`
									: end && end < start ? 'The end date is before the start date'
										: null

			if (problem) {
				failures.push({ name, roll_number: rollNumber, error: problem })
				continue
			}

			const { error } = await supabase.from('lib_members').insert({
				institution_id: institutionId,
				member_number: memberNumber,
				member_category: isFacilitator ? 'facilitator' : 'learner',
				[linkColumn]: personId,
				display_name: name,
				email: learner.email || null,
				phone: learner.phone || null,
				membership_start_date: start,
				membership_end_date: end || null,
				is_active: true,
				is_delinquent: false,
			})

			if (error) {
				failures.push({
					name,
					roll_number: rollNumber,
					error: error.code === '23505'
						? `Member number ${memberNumber} is already used in this library`
						: error.message,
				})
				continue
			}

			// Two people in one chunk cannot claim the same number either
			enrolled.set(personId, memberNumber)
			numberTaken.set(memberNumber, name)
			if (isFacilitator && !usesCollegeId) nextSequence++
			created++
		}

		return NextResponse.json({
			created,
			failed: failures.length,
			total: learners.length,
			failures,
		})
	} catch (error) {
		console.error('Unexpected error enrolling members in bulk:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
