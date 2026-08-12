/**
 * A learner's photo, which lives in MyJKKN and never in our tables.
 *
 * Used at the gate, where the whole point is seeing that the face matches the
 * card being scanned. Best effort by design: a slow or unreachable MyJKKN must
 * never stop an entry being recorded, so this returns null instead of throwing,
 * and gives up after a couple of seconds rather than holding the queue.
 */

const MYJKKN_API_URL = process.env.MYJKKN_API_URL ?? 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY ?? ''

/** Long enough for a normal response, short enough that a queue keeps moving. */
const TIMEOUT_MS = 2500

export async function fetchLearnerPhoto(learnerId: string | null | undefined): Promise<string | null> {
	if (!learnerId || !MYJKKN_API_KEY) return null

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
