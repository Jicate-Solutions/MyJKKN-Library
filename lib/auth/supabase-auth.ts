/**
 * The Supabase project people sign in against.
 *
 * Two Supabase projects are in play and they do different jobs.
 *
 * THIS one — `NEXT_PUBLIC_SUPABASE_URL1` — answers WHO somebody is, and what
 * MyJKKN role they hold. It is the project Google OAuth is configured on.
 * Super Admin (`super_admin`) on that role has full access to this application.
 * No role is assigned in the library module.
 *
 * The OTHER one — `NEXT_PUBLIC_SUPABASE_URL`, reached through
 * `lib/supabase-server.ts` — holds the library itself: catalogue, loans,
 * settings. It does not decide who may sign in.
 *
 * This file is imported by the browser. It must not reach for `next/headers` or
 * anything server-only — that lives in `supabase-auth-server.ts`.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_AUTH_URL = process.env.NEXT_PUBLIC_SUPABASE_URL1 ?? ''
export const SUPABASE_AUTH_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY1 ?? ''

/**
 * The plain, readable copy of the access token.
 *
 * Supabase keeps the session in its own `sb-<ref>-auth-token` cookies, which
 * are base64 and split into chunks when long. Every `/api/lib/*` route already
 * reads a single `access_token` cookie and validates whatever it finds, so the
 * token is mirrored into that one name as well and the existing guard is left
 * alone. It is only ever a copy: Supabase remains the one that issues, renews
 * and revokes it.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token'

/** True when this deployment has been given a project to sign in against. */
export function supabaseAuthConfigured(): boolean {
	return SUPABASE_AUTH_URL.length > 0 && SUPABASE_AUTH_ANON_KEY.length > 0
}

let browserClient: SupabaseClient | null = null

/**
 * The browser's client, made once.
 *
 * `createBrowserClient` stores the session in cookies rather than local
 * storage, which is what lets the callback route write it server-side and every
 * API route read it back. Made once because a second client would run a second
 * refresh timer against the same session, and two refreshes racing is how a
 * rotated refresh token leaves one of them holding a dead one.
 */
export function getAuthBrowserClient(): SupabaseClient {
	if (!browserClient) {
		if (!supabaseAuthConfigured()) {
			throw new Error(
				'Sign-in is not configured: NEXT_PUBLIC_SUPABASE_URL1 and NEXT_PUBLIC_SUPABASE_ANON_KEY1 are required.'
			)
		}
		browserClient = createBrowserClient(SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY)
	}
	return browserClient
}

/**
 * Writes the readable copy of the token, or clears it when the session ends.
 *
 * Called on every auth change the browser sees, so a token Supabase has just
 * renewed is the one the server is handed on the next request. `secure` is left
 * off on http://localhost, where the browser would otherwise drop the cookie.
 */
export function mirrorAccessTokenCookie(accessToken: string | null, expiresAt?: number | null): void {
	if (typeof document === 'undefined') return

	const secure = window.location.protocol === 'https:' ? '; secure' : ''

	if (!accessToken) {
		document.cookie = `${ACCESS_TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`
		return
	}

	// Supabase gives `expires_at` as a unix time in seconds. Fall back to an
	// hour, which is the default access-token lifetime.
	const seconds = expiresAt ? Math.max(0, Math.floor(expiresAt - Date.now() / 1000)) : 3600

	document.cookie =
		`${ACCESS_TOKEN_COOKIE}=${accessToken}; path=/; max-age=${seconds}; samesite=lax${secure}`
}
