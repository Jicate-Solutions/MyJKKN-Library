/**
 * Who is signed in, and whether the library opens for them.
 *
 * Answers even when the answer is no. That is the point of this route: every
 * other `/api/lib/*` route refuses a person without a library role outright,
 * but the browser still has to be told *why* so it can draw the restricted page
 * instead of an empty shell. So this one route reports the refusal rather than
 * simply returning 403 — with the roles MyJKKN does give them, so the page can
 * say what it found.
 *
 * A display aid only. Every route re-checks the same role server-side, so a
 * tampered answer gains nothing.
 */

import { NextResponse } from 'next/server'
import { identifyCaller } from '@/lib/auth/server-access'
import { LIBRARY_ROLES } from '@/lib/auth/library-roles'
import { allowedPagesFor } from '@/lib/auth/role-page-store'
import { warmCollegeDirectory } from '@/lib/library/myjkkn-directory'

export async function GET(request: Request) {
	const identity = await identifyCaller(request)

	if (!identity.ok) {
		// Not signed in at all is a different thing from signed in and refused:
		// the first sends them to the login page, the second to the restricted
		// one. So only the first keeps its 401.
		const notSignedIn = identity.reason === 'not_signed_in' || identity.reason === 'session_expired'

		return NextResponse.json(
			{
				allowed: false,
				reason: identity.reason,
				error: identity.error,
				email: identity.email ?? null,
				full_name: identity.fullName ?? null,
				myjkkn_roles: identity.myjkknRoles ?? [],
				library_roles: LIBRARY_ROLES,
				role: null,
				pages: [],
			},
			{ status: notSignedIn ? (identity.status ?? 401) : 200 }
		)
	}

	const { caller } = identity

	// Which pages their role may open, as a super admin has set it. null means a
	// super admin, who is never restricted. Answered here rather than from a
	// route of its own because the menu, the page guard and the mobile navbar all
	// want it and this reply is already fetched once per tab and cached.
	// Somebody on a temporary grant for one job carries their own short list,
	// and it is the whole answer — a role's configured pages are not consulted,
	// so nothing a super admin ticks for assistant librarians widens it.
	const pages = caller.onlyPages ?? await allowedPagesFor(caller.role)

	// Their college's roll is started on the way in, not awaited: the members
	// page and the desk then find it in hand instead of paying MyJKKN's walk on
	// their first visit. A super admin has no one college, so nothing is warmed.
	// A helper who only scans shelves never reads a member, so nothing is
	// fetched from MyJKKN for them at all.
	if (caller.institutionId && !caller.onlyPages) warmCollegeDirectory(caller.institutionId)

	return NextResponse.json({
		allowed: true,
		role: caller.role,
		pages,
		// True for a stock check helper: the menu shows their one page, and the
		// screens hide what they cannot do rather than offering it and refusing.
		limited_to_pages: Boolean(caller.onlyPages),
		// Colleges they were lent to for a stock check. In these the menu holds
		// the Stock Check page alone, however much their own role would open at
		// home — the API refuses the rest either way, and offering a menu that
		// only produces refusals is worse than not offering it.
		stock_check_institution_ids: caller.stockCheckInstitutionIds ?? [],
		myjkkn_roles: caller.myjkknRoles,
		library_roles: LIBRARY_ROLES,
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
