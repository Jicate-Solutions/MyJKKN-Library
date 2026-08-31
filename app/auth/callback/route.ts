/**
 * Where Google sends people back to.
 *
 * Supabase hands over a one-time code; this turns it into a session and writes
 * it to cookies, then sends the person on to wherever they were headed. The
 * exchange happens here on the server rather than in the browser so the session
 * cookies exist before the first page renders — otherwise the dashboard's own
 * requests would fire against a session that is not written yet and come back
 * 401, which reads to the user as "signed in, but nothing loads".
 *
 * Nothing is put in the URL. The previous arrangement passed the token and the
 * whole user object as query parameters for the login page to pick up, which
 * meant the access token was written into browser history, server logs and any
 * referrer header the next page sent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthRouteClient } from '@/lib/auth/supabase-auth-server'
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/supabase-auth'

/**
 * Only a path within this application, never an absolute URL.
 *
 * `?redirect=` comes in from the address bar, so without this an emailed link
 * could carry somebody straight off to another site immediately after signing
 * in — with the sign-in itself having appeared to work.
 */
function safeRedirect(value: string | null): string {
	if (!value) return '/dashboard'
	if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
	return value
}

export async function GET(request: NextRequest) {
	const requestUrl = new URL(request.url)
	const code = requestUrl.searchParams.get('code')
	const error = requestUrl.searchParams.get('error')
	const errorDescription = requestUrl.searchParams.get('error_description')
	const redirectTo = safeRedirect(requestUrl.searchParams.get('redirect'))

	// The request's own origin is used rather than NEXT_PUBLIC_SITE_URL: this
	// route is only ever reached by the browser being sent here, so the origin
	// is right by construction, and a misconfigured site URL cannot bounce
	// somebody to a host they are not signed in on.
	const siteUrl = requestUrl.origin

	const failWith = (reason: string, description?: string | null) => {
		const loginUrl = new URL('/login', siteUrl)
		loginUrl.searchParams.set('error', reason)
		if (description) loginUrl.searchParams.set('error_description', description)
		if (redirectTo !== '/dashboard') loginUrl.searchParams.set('redirect', redirectTo)
		return NextResponse.redirect(loginUrl)
	}

	// Google or Supabase refused before we ever saw a code
	if (error) {
		console.error('[auth] Sign-in refused:', error, errorDescription)
		return failWith(error, errorDescription)
	}

	if (!code) {
		return failWith('missing_code', 'No sign-in code was returned')
	}

	try {
		const supabase = await getAuthRouteClient()
		const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

		if (exchangeError || !data?.session) {
			console.error('[auth] Code exchange failed:', exchangeError?.message)
			return failWith('exchange_failed', exchangeError?.message ?? 'Could not complete sign-in')
		}

		const response = NextResponse.redirect(new URL(redirectTo, siteUrl))

		// The readable copy every /api/lib/* route reads. Supabase's own session
		// cookies were already written by the exchange above; this is the single
		// plain name the guard looks for, kept in step by the browser from here
		// on (see `mirrorAccessTokenCookie`).
		const { access_token, expires_at } = data.session
		const maxAge = expires_at
			? Math.max(0, Math.floor(expires_at - Date.now() / 1000))
			: 3600

		response.cookies.set(ACCESS_TOKEN_COOKIE, access_token, {
			path: '/',
			maxAge,
			// Read in the browser so the auth context can tell at a glance
			// whether a session exists without waiting on a round trip.
			httpOnly: false,
			secure: requestUrl.protocol === 'https:',
			sameSite: 'lax',
		})

		return response
	} catch (err) {
		console.error('[auth] Callback error:', err)
		return failWith('server_error', 'An unexpected error occurred')
	}
}
