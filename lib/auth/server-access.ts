/**
 * Server-side access control for library APIs.
 *
 * MyJKKN proves WHO the caller is. This project decides WHAT they may do:
 * the role is read from our own `users` / `user_roles` tables, never from the
 * MyJKKN token, so a MyJKKN role change can never silently grant library rights.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import { authConfig } from './config'

export type LibraryRole = 'super_admin' | 'admin' | 'librarian' | 'assistant_librarian' | 'member'

/** Highest first — used for "at least this role" checks. */
const ROLE_RANK: Record<LibraryRole, number> = {
	super_admin: 5,
	admin: 4,
	librarian: 3,
	assistant_librarian: 2,
	member: 1,
}

export interface Caller {
	userId: string
	email: string
	fullName: string | null
	role: LibraryRole
	/** null for super_admin — they are not tied to one institution */
	institutionId: string | null
	isSuperAdmin: boolean
	/**
	 * Set only while a super admin is viewing the system as someone else. The
	 * fields above then describe the person being viewed — the whole point is
	 * that every rule applies to them — and this says who is really at the
	 * keyboard, so an action taken during impersonation stays traceable.
	 */
	impersonatedBy?: { userId: string; email: string } | null
}

export interface AccessResult {
	caller: Caller | null
	error?: string
	status?: number
}

/** Name of the cookie that holds the id of the user being viewed as. */
export const IMPERSONATION_COOKIE = 'lib_view_as'

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

/** Reads the access token from the Authorization header or the access_token cookie. */
function readToken(request: Request): string | null {
	const header = request.headers.get('authorization')
	if (header?.startsWith('Bearer ')) return header.slice(7)

	return readCookie(request, 'access_token')
}

/**
 * The name as MyJKKN spells it.
 *
 * Different sign-in paths fill different fields, so the first non-empty one
 * wins, falling back to first + last. Returns null rather than an empty string
 * when MyJKKN sends no name at all — an absent name must never overwrite the
 * one we already hold.
 */
export function nameFromParent(user: any): string | null {
	if (!user) return null

	const joined = [user.first_name, user.last_name].filter(Boolean).join(' ')
	const name = String(user.full_name || user.name || user.display_name || user.displayName || joined || '')
		.replace(/\s+/g, ' ')
		.trim()

	return name.length > 0 ? name : null
}

interface ParentIdentity {
	email: string
	fullName: string | null
}

/** Asks MyJKKN who this token belongs to. Returns their email and name, or null. */
async function resolveIdentity(token: string): Promise<ParentIdentity | null> {
	try {
		const response = await fetch(`${authConfig.parentAppUrl}/api/auth/validate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ access_token: token, child_app_id: authConfig.appId }),
		})
		if (!response.ok) return null

		const data = await response.json()
		const email = data?.user?.email ?? null
		if (!email) return null

		return { email, fullName: nameFromParent(data.user) }
	} catch (error) {
		console.error('[access] Token validation failed:', error)
		return null
	}
}

/**
 * Builds a caller from one `users` row, resolving their library role from our
 * database. `user_roles` wins when present; otherwise the legacy `users.role`
 * column is used, so accounts created before RBAC still work.
 *
 * Shared by the signed-in caller and by whoever a super admin is viewing as,
 * so both are resolved by exactly the same rules — there is no second, laxer
 * path into the system.
 */
async function callerFromUser(
	user: {
		id: string
		email: string
		full_name: string | null
		role: string | null
		is_super_admin: boolean
		institution_id: string | null
	}
): Promise<Caller> {
	const supabase = getSupabaseServer()

	// Assigned roles take precedence over the legacy column
	const { data: assigned } = await supabase
		.from('user_roles')
		.select('roles(name)')
		.eq('user_id', user.id)
		.eq('is_active', true)

	const assignedNames = (assigned || [])
		.map(r => (r.roles as any)?.name)
		.filter(Boolean) as LibraryRole[]

	let role: LibraryRole = 'member'
	if (assignedNames.length > 0) {
		role = assignedNames.reduce((best, next) =>
			(ROLE_RANK[next] ?? 0) > (ROLE_RANK[best] ?? 0) ? next : best
		)
	} else if (user.is_super_admin) {
		role = 'super_admin'
	} else if (user.role && user.role in ROLE_RANK) {
		role = user.role as LibraryRole
	}

	// The legacy flag can only ever raise the role, never lower an assigned one
	if (user.is_super_admin) role = 'super_admin'

	return {
		userId: user.id,
		email: user.email,
		fullName: user.full_name ?? null,
		role,
		institutionId: role === 'super_admin' ? null : (user.institution_id ?? null),
		isSuperAdmin: role === 'super_admin',
		impersonatedBy: null,
	}
}

const USER_FIELDS = 'id, email, full_name, role, is_super_admin, institution_id, is_active'

/**
 * Keeps our copy of the name identical to MyJKKN's.
 *
 * MyJKKN owns who a person is; this project only borrows it. So whatever their
 * MyJKKN profile says is what the library shows — including after a correction
 * or a change of name there, with nobody having to edit the row by hand.
 *
 * The row is written only when the two actually differ, so an ordinary request
 * costs one string comparison. A failed write is logged and swallowed: a stale
 * name is no reason to refuse someone entry.
 */
async function syncNameFromParent(
	supabase: ReturnType<typeof getSupabaseServer>,
	user: { id: string; full_name: string | null },
	parentName: string | null
): Promise<void> {
	if (!parentName || parentName === user.full_name) return

	const { error } = await supabase
		.from('users')
		.update({ full_name: parentName, updated_at: new Date().toISOString() })
		.eq('id', user.id)

	if (error) {
		console.error('[access] Could not sync name from MyJKKN:', error.message)
		return
	}

	// Show the new name on this request, not the next one
	user.full_name = parentName
}

/**
 * Identifies the caller.
 *
 * When a super admin has picked someone to view as, the returned caller IS
 * that person — same role, same institution, same limits — because the point
 * of the feature is to see and do exactly what they can. Who is really at the
 * keyboard is kept on `impersonatedBy` so nothing becomes anonymous.
 */
export async function getCaller(request: Request): Promise<AccessResult> {
	const token = readToken(request)
	if (!token) return { caller: null, error: 'Not signed in', status: 401 }

	const identity = await resolveIdentity(token)
	if (!identity) return { caller: null, error: 'Session expired — please sign in again', status: 401 }

	const supabase = getSupabaseServer()

	const { data: user } = await supabase
		.from('users')
		.select(USER_FIELDS)
		.eq('email', identity.email)
		.maybeSingle()

	if (!user) return { caller: null, error: 'Your account is not provisioned for the library', status: 403 }
	if (!user.is_active) return { caller: null, error: 'Your account is inactive', status: 403 }

	await syncNameFromParent(supabase, user, identity.fullName)

	const realCaller = await callerFromUser(user)

	// Only a super admin can be viewing as someone else. If anyone else has the
	// cookie it is ignored outright rather than trusted.
	const viewAsId = readCookie(request, IMPERSONATION_COOKIE)
	if (viewAsId && realCaller.isSuperAdmin && viewAsId !== realCaller.userId) {
		const { data: target } = await supabase
			.from('users')
			.select(USER_FIELDS)
			.eq('id', viewAsId)
			.maybeSingle()

		if (target?.is_active) {
			const asCaller = await callerFromUser(target)
			return {
				caller: {
					...asCaller,
					impersonatedBy: { userId: realCaller.userId, email: realCaller.email },
				},
			}
		}
		// Target gone or deactivated — fall through as the real super admin
	}

	return { caller: realCaller }
}

/** True when the caller holds at least the given role. */
export function hasAtLeast(caller: Caller, minimum: LibraryRole): boolean {
	return ROLE_RANK[caller.role] >= ROLE_RANK[minimum]
}

/**
 * Which institution's data may this caller touch?
 *
 * super_admin may pass any institution_id (or none, to see everything).
 * Everyone else is pinned to their own institution — a requested id that is not
 * theirs is refused rather than quietly ignored, so a hand-edited URL cannot
 * read another campus's records.
 */
export function resolveInstitutionScope(
	caller: Caller,
	requestedInstitutionId: string | null
): { institutionId: string | null; error?: string; status?: number } {
	if (caller.isSuperAdmin) {
		return { institutionId: requestedInstitutionId }
	}

	// An admin with no college attached oversees all of them — the CEO's case.
	// Deliberately narrow: it reads every library but, unlike super_admin, it
	// cannot open Staff Access or view as another user.
	if (caller.role === 'admin' && !caller.institutionId) {
		return { institutionId: requestedInstitutionId }
	}

	if (!caller.institutionId) {
		return {
			institutionId: null,
			error: 'Your account is not linked to an institution',
			status: 403,
		}
	}

	if (requestedInstitutionId && requestedInstitutionId !== caller.institutionId) {
		return {
			institutionId: null,
			error: 'You can only access your own institution',
			status: 403,
		}
	}

	return { institutionId: caller.institutionId }
}

/**
 * Role-assignment rules.
 *
 * super_admin may grant anything. admin may staff their own institution but may
 * NOT create another super_admin or admin — that stops an admin promoting
 * themselves (or a friend) to full system access.
 */
export function canAssignRole(caller: Caller, targetRole: LibraryRole): { allowed: boolean; reason?: string } {
	if (caller.role === 'super_admin') return { allowed: true }

	if (caller.role === 'admin') {
		if (targetRole === 'super_admin') {
			return { allowed: false, reason: 'Only a super admin can grant the super_admin role' }
		}
		if (targetRole === 'admin') {
			return { allowed: false, reason: 'Only a super admin can grant the admin role' }
		}
		return { allowed: true }
	}

	return { allowed: false, reason: 'You do not have permission to assign roles' }
}

export const ASSIGNABLE_ROLES: LibraryRole[] = [
	'super_admin',
	'admin',
	'librarian',
	'assistant_librarian',
	'member',
]
