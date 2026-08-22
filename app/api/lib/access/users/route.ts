/**
 * Who can open the library: GET /api/lib/access/users
 *
 * Read-only, and super admin only.
 *
 * Roles are MyJKKN's now. This project neither stores them nor grants them, so
 * this screen no longer hands anything out — it reports. It lists the MyJKKN
 * staff who hold one of the four library roles, so a super admin can see at a
 * glance who has access and to which college, and go and change it in MyJKKN if
 * that is wrong.
 *
 * POST is answered rather than removed so a page left open from before the
 * change says why, instead of failing with a bare 405.
 */

import { NextResponse } from 'next/server'
import { getCaller, resolveInstitutionScope } from '@/lib/auth/server-access'
import { LIBRARY_ROLES, highestLibraryRole } from '@/lib/auth/library-roles'
import { allStaff, collegeForMyjkknInstitution, myjkknStaffConfigured } from '@/lib/auth/myjkkn-staff'

export async function GET(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) return NextResponse.json({ error }, { status: status ?? 401 })

		// Granting library roles is not something this application does at all
		// any more, but seeing who holds one is still a super admin's business.
		if (!caller.isSuperAdmin) {
			return NextResponse.json({ error: 'Only a super admin can view staff access' }, { status: 403 })
		}

		const { searchParams } = new URL(request.url)
		const scope = resolveInstitutionScope(caller, searchParams.get('institution_id'))
		if (scope.error) return NextResponse.json({ error: scope.error }, { status: scope.status ?? 403 })

		if (!myjkknStaffConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so roles cannot be read' },
				{ status: 503 }
			)
		}

		const staff = await allStaff()

		const rows = []
		for (const person of staff) {
			// Only the people this screen is about
			const role = highestLibraryRole(person.roleKeys)
			if (!role) continue

			const institutionId = role === 'super_admin'
				? null
				: await collegeForMyjkknInstitution(person.myjkknInstitutionId)

			// A college was asked for: show only that college's people. A super
			// admin belongs to none of them, so they are shown either way.
			if (scope.institutionId && institutionId !== scope.institutionId && role !== 'super_admin') continue

			rows.push({
				id: person.id,
				email: person.email,
				full_name: person.fullName,
				role,
				is_super_admin: role === 'super_admin',
				is_active: person.isActive,
				institution_id: institutionId,
				last_login: null,
				staff_code: person.staffCode,
				/** Every MyJKKN role they hold, not only the library one. */
				assigned_roles: person.roleKeys,
				effective_role: role,
			})
		}

		rows.sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))

		return NextResponse.json({
			data: rows,
			caller: { role: caller.role, institution_id: caller.institutionId },
			// Nothing is assignable from here any more — the screen is a report.
			assignable_roles: [],
			library_roles: LIBRARY_ROLES,
			managed_in: 'myjkkn',
		})
	} catch (error) {
		console.error('Unexpected error listing staff access:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST() {
	return NextResponse.json(
		{
			error:
				'Library roles are set in MyJKKN, not here. Add or remove super_admin, library_admin, librarian or assistant_librarian on the person\'s MyJKKN staff record.',
		},
		{ status: 410 }
	)
}
