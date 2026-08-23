/**
 * Role Management: GET / PUT / DELETE /api/lib/access/role-pages
 *
 * Which pages each role may open. Super admin only, on every verb — this is the
 * screen that decides what everyone else can reach, so it is the one screen
 * that must never be reachable by the people it governs.
 *
 * GET returns the whole picture at once: the page catalogue, and for each of
 * the three configurable roles what it is set to, whether that is the code
 * default, and which of its pages are locked. The screen draws itself from
 * this and holds no copy of the rules.
 *
 * PUT saves one role. DELETE puts one role back on the default.
 *
 * `super_admin` is not configurable here at all. A super admin is never
 * restricted, and the account that hands out access must not be able to lock
 * itself out of the screen that does it.
 */

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth/server-access'
import {
	MANAGEABLE_ROLES,
	PAGE_CATALOGUE,
	defaultPagesFor,
	isManageableRole,
	lockFor,
	settledPagesFor,
} from '@/lib/auth/role-pages'
import { ROLE_LABEL } from '@/lib/auth/library-roles'
import { resetRolePages, saveRolePages, storedRolePages } from '@/lib/auth/role-page-store'

/** Only a super admin, and the same answer for every verb. */
async function requireSuperAdmin(request: Request) {
	const { caller, error, status } = await getCaller(request)
	if (!caller) {
		return { ok: false as const, response: NextResponse.json({ error }, { status: status ?? 401 }) }
	}

	if (!caller.isSuperAdmin) {
		return {
			ok: false as const,
			response: NextResponse.json(
				{ error: 'Only a super admin can manage what a role may open' },
				{ status: 403 }
			),
		}
	}

	return { ok: true as const, caller }
}

export async function GET(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const stored = await storedRolePages()

		const roles = MANAGEABLE_ROLES.map(role => {
			// Path → why it cannot be ticked. Only the pages that are fixed appear,
			// so the screen shows a checkbox for everything else without asking.
			const locks: Record<string, { state: 'on' | 'off'; reason: string }> = {}
			for (const group of PAGE_CATALOGUE) {
				for (const page of group.pages) {
					const lock = lockFor(role, page.url)
					if (lock) locks[page.url] = lock
				}
			}

			return {
				role,
				label: ROLE_LABEL[role],
				pages: settledPagesFor(role, stored[role]),
				/** True while nobody has changed it — the screen says so rather than implying a choice was made. */
				is_default: stored[role] === null,
				locks,
			}
		})

		return NextResponse.json({
			catalogue: PAGE_CATALOGUE,
			roles,
			caller: { role: guard.caller.role, user_id: guard.caller.userId },
		})
	} catch (error) {
		console.error('Unexpected error reading role pages:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const body = await request.json().catch(() => null)
		if (!body) return NextResponse.json({ error: 'A body is required' }, { status: 400 })

		const role = body.role
		if (!isManageableRole(role)) {
			return NextResponse.json(
				{ error: `role must be one of ${MANAGEABLE_ROLES.join(', ')}` },
				{ status: 400 }
			)
		}

		if (!Array.isArray(body.pages)) {
			return NextResponse.json({ error: 'pages must be a list of paths' }, { status: 400 })
		}

		const result = await saveRolePages(role, body.pages.map(String), {
			userId: guard.caller.userId,
			name: guard.caller.fullName,
		})

		if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

		return NextResponse.json({ role, pages: result.pages, is_default: false })
	} catch (error) {
		console.error('Unexpected error saving role pages:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const role = new URL(request.url).searchParams.get('role')
		if (!isManageableRole(role)) {
			return NextResponse.json(
				{ error: `role must be one of ${MANAGEABLE_ROLES.join(', ')}` },
				{ status: 400 }
			)
		}

		const result = await resetRolePages(role)
		if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

		return NextResponse.json({ role, pages: defaultPagesFor(role), is_default: true })
	} catch (error) {
		console.error('Unexpected error resetting role pages:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
