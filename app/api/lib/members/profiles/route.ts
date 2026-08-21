/**
 * Profiles for a page of members: POST /api/lib/members/profiles
 *
 * The members table shows each learner's and facilitator's real name, photo and
 * roll number, and those live in MyJKKN rather than in our tables. Every row
 * used to ask for its own — a page of fifty rows was fifty separate calls from
 * the browser, each one an uncapped trip to the slowest service we depend on,
 * and "All" on a large college fired hundreds at once.
 *
 * Now the page asks once for everyone on it. The server holds the answers, so a
 * second page of the same programme, a second librarian, or a return to page one
 * costs nothing at all.
 *
 * POST rather than GET only because a page of ids is too long for a URL; it
 * reads and writes nothing.
 */

import { NextResponse } from 'next/server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchMyjkknProfiles, type ProfileKind } from '@/lib/library/myjkkn-profile'

/** One page of the members table, with room to spare. Not a page of the college. */
const MAX_PEOPLE = 500

const KINDS: ProfileKind[] = ['learner', 'facilitator']

export async function POST(request: Request) {
	try {
		// The same guard as the list this serves: signed in, and not a member
		// poking at other people's names
		const guard = await guardCollection(request, null)
		if (!guard.ok) return guard.response

		const body = await request.json().catch(() => ({}))
		const asked = Array.isArray(body?.people) ? body.people : []

		const people = asked
			.filter((person: any) => person && KINDS.includes(person.kind) && typeof person.id === 'string' && person.id)
			.slice(0, MAX_PEOPLE)
			.map((person: any) => ({ kind: person.kind as ProfileKind, id: person.id as string }))

		if (people.length === 0) return NextResponse.json({ profiles: {} })

		const profiles = await fetchMyjkknProfiles(people)
		return NextResponse.json({ profiles })
	} catch (error) {
		console.error('Unexpected error reading member profiles:', error)
		// A page that cannot show MyJKKN names still shows the stored ones
		return NextResponse.json({ profiles: {} })
	}
}
