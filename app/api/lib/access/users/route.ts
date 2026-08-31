/**
 * Who can open the library: GET /api/lib/access/users
 *
 * Read-only, and super admin only.
 *
 * Roles are MyJKKN's now. This project neither stores them nor grants them, so
 * this screen no longer hands anything out — it reports. It lists everybody
 * MyJKKN gives one of the four library roles, so a super admin can see at a
 * glance who has access and to which college, and go and change it in MyJKKN if
 * that is wrong.
 *
 * MyJKKN says so in two places and both are read: the staff directory, and the
 * `profiles` row behind a MyJKKN user. The second matters because senior people
 * often have no staff record at all — they sign in on that row, so a screen that
 * read only the directory could not see the very people most likely to be Super
 * Admin.
 *
 * POST is answered rather than removed so a page left open from before the
 * change says why, instead of failing with a bare 405.
 */

import { NextResponse } from 'next/server'
import { getCaller, resolveInstitutionScope } from '@/lib/auth/server-access'
import { LIBRARY_ROLES, highestLibraryRole } from '@/lib/auth/library-roles'
import { allStaff, collegeForMyjkknInstitution, myjkknStaffConfigured } from '@/lib/auth/myjkkn-staff'
import { listGrants, idForGrantedEmail } from '@/lib/auth/role-grants'
import { libraryRoleProfiles } from '@/lib/auth/supabase-auth-server'

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
	/**
	 * Where their access comes from. MyJKKN, for everybody normal.
	 *
	 * `profile` is still MyJKKN — it means the role was found on their MyJKKN
	 * user rather than on a staff record, which is how the people who are not
	 * in the staff directory sign in.
	 */
	access_source: 'myjkkn' | 'profile' | 'grant'
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

		// The people MyJKKN knows without a staff record.
		//
		// Access has never come from the staff directory alone: somebody whose
		// only record in MyJKKN is a `profiles` row signs in on that row. This
		// screen could not see them, so it was silently wrong about exactly the
		// senior people most likely to hold Super Admin.
		//
		// Listed on the same rule the door uses, so the two agree: Super Admin and
		// Library Admin span every college and need no staff record, while the two
		// college roles do — that record is where their college comes from, and
		// sign-in turns them away without one.
		const onScreen = new Set(rows.map(r => r.email.toLowerCase()))
		const staffByEmail = new Map(staff.map(person => [person.email.toLowerCase(), person]))

		for (const person of await libraryRoleProfiles()) {
			if (onScreen.has(person.email)) continue

			const role = highestLibraryRole(person.roleKeys)
			if (!role) continue

			// May exist and simply carry no library role of its own — that is the
			// other half of this gap, and those people get in too, because the
			// roles from both sources are pooled when the caller is identified.
			const record = staffByEmail.get(person.email) ?? null

			if (role !== 'super_admin' && role !== 'library_admin' && !record) continue

			const institutionId = record && role !== 'super_admin'
				? await collegeForMyjkknInstitution(record.myjkknInstitutionId)
				: null

			// Belonging to no one college, they are shown whichever is selected.
			if (scope.institutionId && institutionId && institutionId !== scope.institutionId) continue

			rows.push({
				id: record?.id ?? person.authUserId,
				email: person.email,
				full_name: person.fullName ?? record?.fullName ?? null,
				role,
				is_super_admin: role === 'super_admin',
				// A staff record decides while there is one, which is how sign-in
				// reads it too — one live super admin is active on their staff
				// record and inactive in profiles.
				is_active: record ? record.isActive : person.isActive && !person.loginDisabled,
				institution_id: institutionId,
				last_login: null,
				staff_code: record?.staffCode ?? null,
				assigned_roles: person.roleKeys,
				effective_role: role,
				access_source: 'profile',
				grant_expires_on: null,
			})
			onScreen.add(person.email)
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
				// MyJKKN already gives them the role; the grant adds nothing, so it
				// is noted on their existing row rather than listed twice over.
				// Their source is left alone — it says where the role really comes
				// from, and whether they can be viewed as.
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
