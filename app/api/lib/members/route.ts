/**
 * Who this college's library members are: GET /api/lib/members
 *
 * There is no roll to keep any more. Every Active learner and every Active
 * staff member in MyJKKN is a member of their own college's library, and the
 * answer is read from MyJKKN on every request rather than stored here. Nobody
 * is enrolled, nobody is edited, nobody is deleted — which is why this route
 * no longer accepts POST.
 *
 * What this database does hold is what the library itself knows about them:
 * whether they owe a fine, and whether they have ever borrowed. That comes from
 * `lib_borrowers`, which is written only when somebody actually takes a book.
 *
 * A college sees its own people and no one else's. Only a super admin, or an
 * admin overseeing every campus, may ask for all of them at once.
 *
 * The reply carries an `X-Roll-Read-At` header: when MyJKKN was last asked for
 * the oldest roll in the answer. The page prints it beside Refresh.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { collegeRoll, myjkknConfigured, type DirectoryPerson } from '@/lib/library/myjkkn-directory'
import { fetchAllRows } from '@/lib/library/fetch-all'

/**
 * One row of the members list, as the page renders it.
 *
 * The phone number is deliberately not here. The table never shows it, and a
 * college of five thousand members sent it five thousand times on every visit;
 * it travels with the one-member summary (`/api/lib/members/[id]`) instead.
 */
interface MemberRow {
	/** Stable across requests, and unique within a college — MyJKKN's id, kinded. */
	id: string
	myjkkn_id: string
	person_kind: 'learner' | 'facilitator'
	institution_id: string
	member_number: string
	member_category: string
	display_name: string
	email: string | null
	photo_url: string | null
	/** MyJKKN's own word for what they are — their programme, or their designation. */
	role_label: string
	/** Everyone read from MyJKKN is Active there; the inactive are never returned. */
	is_active: true
	is_delinquent: boolean
	/** Whether they have ever taken a book out of this library. */
	has_borrowed: boolean
}

/** The colleges a caller who spans campuses should see. */
async function everyLibraryInstitution(): Promise<string[]> {
	const supabase = getSupabaseServer()
	const { data } = await supabase
		.from('institutions')
		.select('id, myjkkn_institution_ids')

	return (data || [])
		.filter(row => Array.isArray(row.myjkkn_institution_ids) && row.myjkkn_institution_ids.length > 0)
		.map(row => row.id as string)
}

/**
 * What the library knows about the people it is about to list: who owes money,
 * and who has borrowed at all. One read per college, not one per person.
 */
async function libraryFacts(institutionIds: string[]) {
	const supabase = getSupabaseServer()

	// Read in slices. A college that has been lending for a few years passes a
	// thousand borrowers, and a single request stops at exactly that without
	// saying so — every borrower past the thousandth would show as owing
	// nothing, which is the one thing on this page that must not be wrong.
	const { data, error } = await fetchAllRows<{
		institution_id: string
		myjkkn_id: string
		is_delinquent: boolean
	}>(range => supabase
		.from('lib_borrowers')
		.select('institution_id, myjkkn_id, is_delinquent')
		.in('institution_id', institutionIds)
		.order('myjkkn_id', { ascending: true })
		.range(range.from, range.to))

	// A database without the new table yet still lists members — it simply
	// cannot say who owes, which is better than showing nothing at all.
	if (error) {
		console.warn('[members] Could not read borrowers:', (error as Error).message)
		return new Map<string, boolean>()
	}

	const facts = new Map<string, boolean>()
	for (const row of data || []) {
		facts.set(`${row.institution_id}:${row.myjkkn_id}`, row.is_delinquent === true)
	}
	return facts
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!myjkknConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so the member list cannot be read' },
				{ status: 503 }
			)
		}

		// A college, or every college for whoever is allowed to see every college
		const institutionIds = guard.institutionId
			? [guard.institutionId]
			: await everyLibraryInstitution()

		if (institutionIds.length === 0) return NextResponse.json([])

		const [rolls, facts] = await Promise.all([
			Promise.all(institutionIds.map(id => collegeRoll(id))),
			libraryFacts(institutionIds),
		])

		const memberCategory = searchParams.get('member_category')
		const search = (searchParams.get('search') ?? '').trim().toLowerCase()

		const rows: MemberRow[] = []
		for (const roll of rolls) {
			for (const person of roll.people as DirectoryPerson[]) {
				if (memberCategory && person.member_category !== memberCategory) continue

				if (search) {
					const haystack = [person.member_number, person.display_name, person.email ?? '']
						.join(' ').toLowerCase()
					if (!haystack.includes(search)) continue
				}

				const key = `${person.institution_id}:${person.myjkkn_id}`
				rows.push({
					id: `${person.person_kind}:${person.myjkkn_id}`,
					myjkkn_id: person.myjkkn_id,
					person_kind: person.person_kind,
					institution_id: person.institution_id,
					member_number: person.member_number,
					member_category: person.member_category,
					display_name: person.display_name,
					email: person.email,
					photo_url: person.photo_url,
					role_label: person.role_label,
					is_active: true,
					is_delinquent: facts.get(key) === true,
					has_borrowed: facts.has(key),
				})
			}
		}

		// With several colleges on one answer, the oldest read is the honest age
		const readAt = rolls.map(roll => roll.readAt).sort()[0] ?? null

		return NextResponse.json(rows, {
			headers: readAt ? { 'X-Roll-Read-At': readAt } : undefined,
		})
	} catch (error) {
		console.error('Unexpected error listing members:', error)
		return NextResponse.json({ error: 'Failed to read the member list from MyJKKN' }, { status: 500 })
	}
}

/**
 * Enrolment is gone.
 *
 * Answered rather than removed so a page left open from before the change gets
 * told why its Save did nothing, instead of a bare 405 that reads like a bug.
 */
export async function POST() {
	return NextResponse.json(
		{
			error: 'Members are no longer added here — everyone Active in MyJKKN is already a member of their college\'s library',
		},
		{ status: 410 }
	)
}
