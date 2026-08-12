/**
 * The signed-in caller's library role.
 *
 * The client cannot work this out on its own: the MyJKKN session carries the
 * parent app's role, not ours. The sidebar needs OUR role to decide what to
 * show, so it asks here. This is a display aid only — every API route re-checks
 * the same role server-side, so a tampered answer gains nothing.
 */

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth/server-access'

export async function GET(request: Request) {
	const { caller, error, status } = await getCaller(request)
	if (!caller) {
		return NextResponse.json({ error: error ?? 'Not signed in' }, { status: status ?? 401 })
	}

	return NextResponse.json({
		role: caller.role,
		institution_id: caller.institutionId,
		is_super_admin: caller.isSuperAdmin,
		user_id: caller.userId,
		email: caller.email,
		full_name: caller.fullName,
		// Set while a super admin is viewing as someone else. The fields above
		// then describe the person being viewed, which is what the banner says.
		impersonating: caller.impersonatedBy
			? { real_email: caller.impersonatedBy.email, viewing_as: caller.email }
			: null,
	})
}
