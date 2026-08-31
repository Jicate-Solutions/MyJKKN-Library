'use client'

/**
 * Keeps the app usable when the access token expires mid-session.
 *
 * Supabase renews the token on its own timer, but a laptop that has been asleep
 * wakes with a dead one and fires its requests before the renewal lands. Pages
 * carried on looking signed in while every /api/lib/* request quietly returned
 * 401. The damage was invisible: the institution switcher swallows fetch errors
 * and renders "No Institution", and lists just toast "failed to load" — neither
 * tells you the session is the problem.
 *
 * This wrapper turns that 401 into a single refresh-and-retry, and sends the
 * user to the login page only when the refresh itself is refused.
 */

import { getAuthBrowserClient, mirrorAccessTokenCookie } from './supabase-auth'

let installed = false
let inFlightRefresh: Promise<boolean> | null = null

/**
 * One renewal at a time. A page that fires six requests together would
 * otherwise fire six refreshes, and Supabase rotates the refresh token on each
 * one — leaving five of them holding a token that is already void.
 */
function refreshOnce(): Promise<boolean> {
	if (!inFlightRefresh) {
		// Deferred into the promise so a misconfigured deployment reports a
		// failed refresh rather than throwing out of whatever fetch triggered it.
		inFlightRefresh = Promise.resolve()
			.then(() => getAuthBrowserClient().auth.refreshSession())
			.then(({ data, error }) => {
				if (error || !data.session) {
					mirrorAccessTokenCookie(null)
					return false
				}
				// The retry below reads this cookie, so it has to be written
				// before we report success.
				mirrorAccessTokenCookie(data.session.access_token, data.session.expires_at ?? null)
				return true
			})
			.catch(() => false)
			.finally(() => {
				inFlightRefresh = null
			})
	}
	return inFlightRefresh
}

/** Same-origin API path, or null for anything we must not touch. */
function toApiPath(input: RequestInfo | URL): string | null {
	try {
		const raw =
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
		const url = new URL(raw, window.location.origin)
		if (url.origin !== window.location.origin) return null
		return url.pathname
	} catch {
		return null
	}
}

/**
 * The auth endpoints must be excluded: /api/auth/session answers 401 when the
 * token is dead, and retrying that would recurse.
 */
function isGuardedApi(path: string): boolean {
	if (!path.startsWith('/api/')) return false
	return !path.startsWith('/api/auth/')
}

export function installSessionFetch(): void {
	if (installed || typeof window === 'undefined') return
	installed = true

	const originalFetch = window.fetch.bind(window)

	window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const response = await originalFetch(input, init)
		if (response.status !== 401) return response

		const path = toApiPath(input)
		if (!path || !isGuardedApi(path)) return response

		// A Request object's body is a one-shot stream and a non-string init.body
		// may be too, so those calls cannot be replayed — hand back the 401 and
		// let the caller deal with it rather than retrying with an empty body.
		if (input instanceof Request) return response
		if (init?.body != null && typeof init.body !== 'string') return response

		const refreshed = await refreshOnce()

		if (!refreshed) {
			// refreshOnce() has already cleared the mirrored token on failure.
			if (!window.location.pathname.startsWith('/login')) {
				const redirect = encodeURIComponent(window.location.pathname + window.location.search)
				window.location.href = `/login?error=session_expired&redirect=${redirect}`
			}
			return response
		}

		return originalFetch(input, init)
	}
}
