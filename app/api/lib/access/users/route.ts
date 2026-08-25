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
import { listGrants, idForGrantedEmail } from '@/lib/auth/role-grants'

/** One line on the Staff Access screen. */
interface AccessRow {
	id: string
	email: string
	full_name: string | null
	role: string
	is_super_admin: boolean
	is_active: boolean
	institution_id: string | null
	last_login: string | null
	staff_code: string | null
	/** Every MyJKKN role they hold, not only the library one. */
	assigned_roles: string[]
	effective_role: string
	/** Where their access comes from. MyJKKN, for everybody normal. */
	access_source: 'myjkkn' | 'grant'
	/** The last day a temporary grant works, when there is one. */
	grant_expires_on: string | null
}

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

		const rows: AccessRow[] = []
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
				assigned_roles: person.roleKeys,
				effective_role: role,
				access_source: 'myjkkn',
				grant_expires_on: null,
			})
		}

		// Anybody holding a temporary grant, listed alongside the real staff.
		//
		// Shown whatever college is selected, and shown even once lapsed. Two
		// people carrying super_admin that the access screen does not mention is
		// exactly the kind of thing nobody notices until it matters, and a grant
		// that has quietly expired is worth seeing too — it is usually the answer
		// to "why can they not sign in any more".
		for (const grant of listGrants()) {
			const already = rows.find(r => r.email.toLowerCase() === grant.email)
			if (already) {
				// They are staff with a library role of their own; the grant adds
				// nothing, so say so on their existing row rather than twice over
				already.access_source = 'myjkkn'
				already.grant_expires_on = grant.expiresOn
				continue
			}

			rows.push({
				id: idForGrantedEmail(grant.email),
				email: grant.email,
				full_name: null,
				role: grant.role,
				is_super_admin: grant.role === 'super_admin',
				is_active: !grant.isExpired,
				institution_id: null,
				last_login: null,
				staff_code: null,
				assigned_roles: [],
				effective_role: grant.role,
				access_source: 'grant',
				grant_expires_on: grant.expiresOn,
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
