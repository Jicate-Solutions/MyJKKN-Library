/**
 * A learner's photo, which lives in MyJKKN and never in our tables.
 *
 * Used at the gate, where the whole point is seeing that the face matches the
 * card being scanned. Best effort by design: a slow or unreachable MyJKKN must
 * never stop an entry being recorded, so this returns null instead of throwing,
 * and gives up after a couple of seconds rather than holding the queue.
 *
 * The answer is remembered for a while, because a photo does not change between
 * one scan and the next and MyJKKN is the slowest thing in the request. The
 * first scan of a person in the morning pays for the trip; every scan after it,
 * theirs or anyone else's already seen, costs nothing.
 */

const MYJKKN_API_URL = process.env.MYJKKN_API_URL ?? 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY ?? ''

/** Long enough for a normal response, short enough that a queue keeps moving. */
const TIMEOUT_MS = 2500

/** A photo is the same all day; half an hour is well inside that. */
const PHOTO_TTL_MS = 30 * 60 * 1000

/**
 * "No photo" is held for less time than a photo, because it is as often a
 * MyJKKN hiccup as a real absence, and a missing face should heal by itself.
 */
const MISSING_TTL_MS = 5 * 60 * 1000

/** Seven colleges' worth of faces, comfortably. */
const MAX_CACHED_PHOTOS = 2000

interface CachedPhoto {
	url: string | null
	expiresAt: number
}

const photoCache = new Map<string, CachedPhoto>()

/**
 * Fetches already under way, so two people scanning the same card at the same
 * moment make one trip to MyJKKN rather than two.
 */
const inFlight = new Map<string, Promise<string | null>>()

function prune(): void {
	if (photoCache.size < MAX_CACHED_PHOTOS) return

	const now = Date.now()
	for (const [key, entry] of photoCache) {
		if (entry.expiresAt <= now) photoCache.delete(key)
	}

	if (photoCache.size >= MAX_CACHED_PHOTOS) photoCache.clear()
}

/** The trip to MyJKKN itself. Never throws. */
async function requestPhoto(learnerId: string): Promise<string | null> {
	try {
		const res = await fetch(`${MYJKKN_API_URL}/api-management/learners/profiles/${learnerId}`, {
			headers: { Authorization: `Bearer ${MYJKKN_API_KEY}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) return null

		const json = await res.json()
		const profile = json?.data ?? json
		return profile?.student_photo_url ?? profile?.profile_picture ?? profile?.photo_url ?? null
	} catch {
		return null
	}
}

export async function fetchLearnerPhoto(learnerId: string | null | undefined): Promise<string | null> {
	if (!learnerId || !MYJKKN_API_KEY) return null

	const cached = photoCache.get(learnerId)
	if (cached && cached.expiresAt > Date.now()) return cached.url

	const running = inFlight.get(learnerId)
	if (running) return running

	const work = requestPhoto(learnerId)
		.then(url => {
			prune()
			photoCache.set(learnerId, {
				url,
				expiresAt: Date.now() + (url ? PHOTO_TTL_MS : MISSING_TTL_MS),
			})
			return url
		})
		.finally(() => {
			inFlight.delete(learnerId)
		})

	inFlight.set(learnerId, work)
	return work
}
