/**
 * Fetching from the desk and the gate, on the network those rooms actually have.
 *
 * A browser left to itself will wait on a request that is never going to be
 * answered for minutes, and the counter has no way of knowing whether the card
 * was read. That is worse than a plain failure: the librarian stands in front
 * of a box that says "Working…" while the queue grows, and cannot even try
 * again, because the scan before is still nominally in flight.
 *
 * So every call from those two screens is given a deadline. Past it the request
 * is dropped and reported like any other failure, and the next card can be
 * scanned at once.
 *
 * A read that dies on the way is simply asked again — asking twice costs
 * nothing and answers the same. A write is never repeated: a gate scan that
 * timed out may well have been recorded, and sending it again would read as the
 * person leaving again. That one is reported, and the librarian decides.
 */

/** Long enough for a cold server to read a whole college's roll from MyJKKN. */
export const LOOKUP_TIMEOUT_MS = 20_000

/** A scan writes, so it is never retried — see above. */
export const SCAN_TIMEOUT_MS = 15_000

export interface DeskFetchOptions extends RequestInit {
	timeoutMs?: number
	/** How many extra times a dropped request is sent. Reads only. */
	retries?: number
}

/** True when the request never got an answer, rather than got a bad one. */
function droppedOnTheWay(error: unknown): boolean {
	const name = (error as { name?: string })?.name
	return name === 'AbortError' || name === 'TypeError'
}

/**
 * One fetch with a deadline, and optionally one more go if it never landed.
 *
 * Throws the same shapes fetch does, plus a plain Error on a timeout, worded
 * for the person at the counter rather than for a log.
 */
export async function deskFetch(url: string, options: DeskFetchOptions = {}): Promise<Response> {
	const { timeoutMs = LOOKUP_TIMEOUT_MS, retries = 0, ...init } = options

	for (let attempt = 0; ; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			return await fetch(url, { ...init, signal: controller.signal })
		} catch (error) {
			if (attempt < retries && droppedOnTheWay(error)) continue
			if ((error as { name?: string })?.name === 'AbortError') {
				throw new Error('The network is too slow to answer — try again')
			}
			throw error
		} finally {
			clearTimeout(timer)
		}
	}
}
