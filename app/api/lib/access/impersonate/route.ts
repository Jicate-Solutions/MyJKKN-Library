/**
 * View as another user — super admin only.
 *
 * POST   /api/lib/access/impersonate   { user_id }   start
 * DELETE /api/lib/access/impersonate                 stop
 *
 * Once started, every route sees the caller AS that person: their role, their
 * institution, their limits. That is deliberate — the feature exists to
 * reproduce exactly what they can do, including what they cannot.
 *
 * The choice is held in an httpOnly cookie so the browser cannot set it
 * itself, and the server re-checks on every request that the real signed-in
 * account is a super admin. A stolen or hand-written cookie in anyone else's
 * browser does nothing.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, IMPERSONATION_COOKIE } from '@/lib/auth/server-access'
import { recordImpersonationEvent } from '@/lib/auth/impersonation-log'

export async function POST(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) return NextResponse.json({ error }, { status: status ?? 401 })

		// The real account must be a super admin. If they are already viewing as
		// someone, `caller` is that someone — so check who is really behind it.
		const realIsSuperAdmin = caller.impersonatedBy ? true : caller.isSuperAdmin
		if (!realIsSuperAdmin) {
			return NextResponse.json({ error: 'Only a super admin can view as another user' }, { status: 403 })
		}

		const body = await request.json()
		const targetId: string | undefined = body.user_id
		if (!targetId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })

		const realUserId = caller.impersonatedBy?.userId ?? caller.userId
		const realEmail = caller.impersonatedBy?.email ?? caller.email

		if (targetId === realUserId) {
			return NextResponse.json({ error: 'That is already your own account' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const { data: target } = await supabase
			.from('users')
			.select('id, email, full_name, is_active, institution_id')
			.eq('id', targetId)
			.maybeSingle()

		if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
		if (!target.is_active) {
			return NextResponse.json({ error: 'That account is inactive' }, { status: 400 })
		}

		// Not awaited — whether the audit line lands has no bearing on whether the
		// switch succeeds, and its own catch already tolerates a failed write, so
		// making the response wait for it bought nothing.
		void recordImpersonationEvent({
			event: 'start',
			realUserId,
			realEmail,
			targetUserId: target.id,
			targetEmail: target.email,
		})

		const response = NextResponse.json({
			success: true,
			viewing_as: {
				user_id: target.id,
				email: target.email,
				full_name: target.full_name,
			},
		})

		response.cookies.set(IMPERSONATION_COOKIE, target.id, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			maxAge: 60 * 60 * 4,
		})

		return response
	} catch (error) {
		console.error('Unexpected error starting impersonation:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const { caller } = await getCaller(request)

		if (caller?.impersonatedBy) {
			void recordImpersonationEvent({
				event: 'stop',
				realUserId: caller.impersonatedBy.userId,
				realEmail: caller.impersonatedBy.email,
				targetUserId: caller.userId,
				targetEmail: caller.email,
			})
		}

		const response = NextResponse.json({ success: true })
		response.cookies.set(IMPERSONATION_COOKIE, '', { path: '/', maxAge: 0 })
		return response
	} catch (error) {
		console.error('Unexpected error stopping impersonation:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
