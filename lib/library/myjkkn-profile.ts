/**
 * A member's MyJKKN profile — the name, photo and roll number the members list
 * shows for a learner or a facilitator.
 *
 * None of this lives in our tables: the library stores a membership, MyJKKN
 * stores the person. So the list has to ask, and MyJKKN is the slowest thing in
 * any request we make.
 *
 * The rules here are the same ones `learner-photo.ts` already keeps at the gate,
 * for the same reasons:
 *
 *   * Never throws. A profile that cannot be fetched shows as the member's
 *     stored name, and the page carries on.
 *   * Gives up after a couple of seconds. A page of fifty rows must not be held
 *     open by one unresponsive lookup.
 *   * Remembers the answer, and shares a fetch already under way. Fifty rows of
 *     the same programme, or two librarians looking at the same page, make one
 *     trip between them rather than fifty.
 */

const MYJKKN_API_URL = process.env.MYJKKN_API_URL ?? 'https://www.jkkn.ai/api'
/** No fallback written here: this repository is public. Without the key the
 *  table simply shows the names the library stored. */
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY ?? ''

/** Long enough for a normal response, short enough that a page keeps moving. */
const TIMEOUT_MS = 2500

/** A name and a photo do not change during a working day. */
const PROFILE_TTL_MS = 30 * 60 * 1000

/**
 * "Not found" is held for less time than a profile, because it is as often a
 * MyJKKN hiccup as a real absence, and a blank row should heal by itself.
 */
const MISSING_TTL_MS = 5 * 60 * 1000

/** Seven colleges' worth of people, comfortably. */
const MAX_CACHED_PROFILES = 4000

export type ProfileKind = 'learner' | 'facilitator'

export interface MyjkknProfile {
	name: string
	identifier: string
	photoUrl: string | null
	subtitle: string
}

interface CachedProfile {
	profile: MyjkknProfile | null
	expiresAt: number
}

const profileCache = new Map<string, CachedProfile>()

/** Fetches already under way, so the same person is never asked for twice at once. */
const inFlight = new Map<string, Promise<MyjkknProfile | null>>()

function keyOf(kind: ProfileKind, id: string): string {
	return `${kind}:${id}`
}

function prune(): void {
	if (profileCache.size < MAX_CACHED_PROFILES) return

	const now = Date.now()
	for (const [key, entry] of profileCache) {
		if (entry.expiresAt <= now) profileCache.delete(key)
	}

	if (profileCache.size >= MAX_CACHED_PROFILES) profileCache.clear()
}

/** Shapes one MyJKKN record into what the members table renders. */
function shape(kind: ProfileKind, person: Record<string, any>): MyjkknProfile {
	const name = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()

	if (kind === 'learner') {
		return {
			name,
			identifier: person.roll_number || person.register_number || '',
			photoUrl: person.student_photo_url || person.profile_picture || null,
			subtitle: person.program_code || person.program?.program_name || '',
		}
	}

	return {
		name,
		identifier: person.staff_id || person.staff_code || '',
		photoUrl: person.profile_picture || person.staff_photo_url || null,
		subtitle: person.designation || '',
	}
}

/** The trip to MyJKKN itself. Never throws. */
async function request(kind: ProfileKind, id: string): Promise<MyjkknProfile | null> {
	const path = kind === 'learner'
		? `api-management/learners/profiles/${id}`
		: `api-management/staff/${id}`

	try {
		const res = await fetch(`${MYJKKN_API_URL}/${path}`, {
			headers: { Authorization: `Bearer ${MYJKKN_API_KEY}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) return null

		const json = await res.json()
		const person = json?.data ?? json
		if (!person || typeof person !== 'object') return null

		const profile = shape(kind, person)
		return profile.name ? profile : null
	} catch {
		return null
	}
}

/** One person's profile, from the cache where possible. */
export async function fetchMyjkknProfile(
	kind: ProfileKind,
	id: string | null | undefined
): Promise<MyjkknProfile | null> {
	if (!id || !MYJKKN_API_KEY) return null

	const key = keyOf(kind, id)

	const cached = profileCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.profile

	const running = inFlight.get(key)
	if (running) return running

	const work = request(kind, id)
		.then(profile => {
			prune()
			profileCache.set(key, {
				profile,
				expiresAt: Date.now() + (profile ? PROFILE_TTL_MS : MISSING_TTL_MS),
			})
			return profile
		})
		.finally(() => {
			inFlight.delete(key)
		})

	inFlight.set(key, work)
	return work
}

/**
 * How many trips to MyJKKN are made at once.
 *
 * A page of members can ask about every row at once, and a librarian who sets
 * the page size to "All" on a large college asks about hundreds. Firing all of
 * them together is how a page of fifty rows became fifty simultaneous external
 * calls; a handful at a time is as quick in practice and far kinder to MyJKKN.
 */
const AT_ONCE = 6

/**
 * Profiles for a whole page of members, keyed "learner:<id>" / "facilitator:<id>".
 *
 * Everything already known comes back immediately; only the rest is asked for,
 * a few at a time. A person MyJKKN has nothing for is present in the answer as
 * null, so the caller can tell "not known" from "not asked yet".
 */
export async function fetchMyjkknProfiles(
	people: { kind: ProfileKind; id: string }[]
): Promise<Record<string, MyjkknProfile | null>> {
	const wanted = new Map<string, { kind: ProfileKind; id: string }>()
	for (const person of people) {
		if (person.id) wanted.set(keyOf(person.kind, person.id), person)
	}

	const resolved: Record<string, MyjkknProfile | null> = {}
	const queue = [...wanted.entries()]

	const workers = Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
		for (;;) {
			const next = queue.shift()
			if (!next) return
			const [key, person] = next
			resolved[key] = await fetchMyjkknProfile(person.kind, person.id)
		}
	})

	await Promise.all(workers)
	return resolved
}
