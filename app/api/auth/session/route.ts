/**
 * Who is signed in, and what they are allowed to do.
 *
 * GET /api/auth/session
 *
 * The one place the browser gets its profile from. Everything in the answer is
 * worked out here from the token: the email comes from Supabase Auth, and the
 * role, the permissions and the college come from the person's MyJKKN role.
 * Nothing is taken from the request body, and nothing is assigned in this
 * module. Super Admin (`super_admin`) has full access.
 *
 * A display aid, still. Every `/api/lib/*` route re-checks the same role
 * server-side, so a tampered answer here gains nobody anything.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { verifyAccessToken } from '@/lib/auth/supabase-auth-server'
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/supabase-auth'
import { staffByEmail, collegeForMyjkknInstitution } from '@/lib/auth/myjkkn-staff'
import { permissionsForRoles } from '@/lib/auth/role-permissions'
import { grantFor } from '@/lib/auth/role-grants'
import { highestLibraryRole } from '@/lib/auth/library-roles'

/** Reads one cookie value off the request. */
function readCookie(request: Request, wanted: string): string | null {
	const cookie = request.headers.get('cookie')
	if (!cookie) return null

	for (const part of cookie.split(';')) {
		const [name, ...rest] = part.trim().split('=')
		if (name === wanted) return rest.join('=')
	}
	return null
}

function readToken(request: Request): string | null {
	const header = request.headers.get('authorization')
	if (header?.startsWith('Bearer ')) return header.slice(7)
	return readCookie(request, ACCESS_TOKEN_COOKIE)
}

/** The college a person belongs to, spelled out for the institution switcher. */
async function institutionDetails(institutionId: string | null) {
	const empty = {
		institution_id: null as string | null,
		institution_code: null as string | null,
		institution_name: null as string | null,
		counselling_code: null as string | null,
		myjkkn_institution_ids: null as string[] | null,
	}

	if (!institutionId) return empty

	const supabase = getSupabaseServer()
	const { data } = await supabase
		.from('institutions')
		.select('id, institution_code, name, counselling_code, myjkkn_institution_ids')
		.eq('id', institutionId)
		.maybeSingle()

	if (!data) return { ...empty, institution_id: institutionId }

	return {
		institution_id: data.id as string,
		institution_code: (data.institution_code as string) ?? null,
		institution_name: (data.name as string) ?? null,
		counselling_code: (data.counselling_code as string) ?? null,
		myjkkn_institution_ids: (data.myjkkn_institution_ids as string[]) ?? null,
	}
}

export async function GET(request: Request) {
	const token = readToken(request)
	if (!token) {
		return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
	}

	const identity = await verifyAccessToken(token)
	if (!identity) {
		return NextResponse.json({ error: 'Session expired' }, { status: 401 })
	}

	const staff = await staffByEmail(identity.email)
	const grant = grantFor(identity.email)

	const roleKeys = [
		...new Set([
			...(staff?.roleKeys ?? []),
			...identity.roleKeys,
			...(grant ? [grant.role] : []),
		]),
	]

	const role = highestLibraryRole(roleKeys)
	const isSuperAdmin = role === 'super_admin'
	const spansEveryCollege = isSuperAdmin || role === 'library_admin'
	const institutionId = spansEveryCollege
		? null
		: await collegeForMyjkknInstitution(staff?.myjkknInstitutionId ?? null)

	const [permissions, institution] = await Promise.all([
		isSuperAdmin ? Promise.resolve([] as string[]) : permissionsForRoles(roleKeys),
		institutionDetails(institutionId),
	])

	const hasLibraryAccess = Boolean(role) && (staff ? staff.isActive : isSuperAdmin || role === 'library_admin' || Boolean(grant))

	return NextResponse.json({
		id: staff?.id ?? (hasLibraryAccess ? identity.authUserId : null),
		email: identity.email,
		full_name: staff?.fullName ?? identity.fullName,
		avatar_url: identity.avatarUrl,
		role: role ?? roleKeys[0] ?? null,
		roles: roleKeys,
		permissions,
		is_super_admin: isSuperAdmin,
		is_active: staff ? staff.isActive : true,
		has_library_access: hasLibraryAccess,
		...institution,
	})
}
