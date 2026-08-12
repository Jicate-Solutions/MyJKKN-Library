/**
 * Renews an expired MyJKKN access token.
 *
 * MyJKKN issues an access token that lives about an hour, but the browser keeps
 * the cookie for days. Without this route the app sat in a state where it still
 * looked signed in while every /api/lib/* call returned 401 — the institution
 * switcher emptied itself and every list said "failed to load".
 *
 * `parentAuthService.refreshToken()` has always POSTed here; the route simply
 * did not exist, so every renewal attempt 404'd and silently gave up.
 */

import { NextResponse } from 'next/server'

export async function POST(request: Request) {
	try {
		const body = await request.json().catch(() => null)
		const refreshToken = body?.refresh_token

		if (!refreshToken) {
			return NextResponse.json({ error: 'refresh_token is required' }, { status: 400 })
		}

		const parentAppUrl = process.env.NEXT_PUBLIC_PARENT_APP_URL
		const appId = process.env.NEXT_PUBLIC_APP_ID
		const apiKey = process.env.API_KEY // Server-side only — never sent to the browser

		if (!parentAppUrl || !appId || !apiKey) {
			console.error('[token/refresh] Missing auth configuration', {
				parentAppUrl: !!parentAppUrl,
				appId: !!appId,
				apiKey: !!apiKey,
			})
			return NextResponse.json({ error: 'Authentication configuration error' }, { status: 500 })
		}

		const parentResponse = await fetch(`${parentAppUrl}/api/auth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				app_id: appId,
				api_key: apiKey,
			}),
		})

		const data = await parentResponse.json().catch(() => null)

		if (!parentResponse.ok || !data?.access_token) {
			// A refused refresh token means the session is genuinely over. Answer 401
			// so the caller signs the user out instead of retrying forever.
			console.warn('[token/refresh] Refresh rejected:', parentResponse.status, data?.error)
			return NextResponse.json(
				{ error: data?.error_description || data?.error || 'Could not renew your session' },
				{ status: 401 }
			)
		}

		const expiresIn: number = data.expires_in || 3600
		const newRefreshToken: string = data.refresh_token || refreshToken

		const response = NextResponse.json({
			access_token: data.access_token,
			refresh_token: newRefreshToken,
			token_type: data.token_type || 'Bearer',
			expires_in: expiresIn,
			user: data.user,
		})

		// Mirror the cookies the OAuth callback sets — /api/lib/* reads the caller's
		// token from `access_token`, so a renewal that only updated localStorage
		// would leave every server route still seeing the dead token.
		const sevenDaysInSeconds = 7 * 24 * 60 * 60
		const thirtyDaysInSeconds = 30 * 24 * 60 * 60

		response.cookies.set('access_token', data.access_token, {
			path: '/',
			maxAge: sevenDaysInSeconds,
			httpOnly: false, // Needs to be readable by client JS
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
		})
		response.cookies.set('refresh_token', newRefreshToken, {
			path: '/',
			maxAge: thirtyDaysInSeconds,
			httpOnly: false,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
		})

		return response
	} catch (error) {
		console.error('[token/refresh] Unexpected error:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
