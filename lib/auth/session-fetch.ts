'use client'

/**
 * Keeps the app usable when MyJKKN expires the access token mid-session.
 *
 * The token lasts about an hour but the cookie lasts days, so pages carried on
 * looking signed in while every /api/lib/* request quietly returned 401. The
 * damage was invisible: the institution switcher swallows fetch errors and
 * renders "No Institution", and lists just toast "failed to load" — neither
 * tells you the session is the problem.
 *
 * This wrapper turns that 401 into a single refresh-and-retry, and sends the
 * user to the login page only when the refresh itself is refused.
 */

import { parentAuthService } from './parent-auth-service'

let installed = false
let inFlightRefresh: Promise<boolean> | null = null

/**
 * One renewal at a time. A page that fires six requests together would
 * otherwise fire six refreshes, and MyJKKN may rotate the refresh token on
 * each one — leaving five of them holding a token that is already void.
 */
function refreshOnce(): Promise<boolean> {
	if (!inFlightRefresh) {
		inFlightRefresh = parentAuthService.refreshToken().finally(() => {
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
 * The auth endpoints must be excluded: /api/token/refresh answers 401 when the
 * refresh token itself is dead, and retrying that would recurse.
 */
function isGuardedApi(path: string): boolean {
	if (!path.startsWith('/api/')) return false
	return !path.startsWith('/api/token/') && !path.startsWith('/api/auth/')
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
			// refreshToken() has already cleared the local session on failure.
			if (!window.location.pathname.startsWith('/login')) {
				const redirect = encodeURIComponent(window.location.pathname + window.location.search)
				window.location.href = `/login?error=session_expired&redirect=${redirect}`
			}
			return response
		}

		return originalFetch(input, init)
	}
}
