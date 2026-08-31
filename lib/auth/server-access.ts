/**
 * Server-side access control for library APIs.
 *
 * Two questions, two answers, two different places — neither of them the
 * library's own `users` table.
 *
 * WHO is this? Supabase Auth, on the project in `NEXT_PUBLIC_SUPABASE_URL1`.
 * The sign-in token is checked there and what comes back is an email address,
 * plus any MyJKKN roles the auth user already carries.
 *
 * WHAT may they do? Their MyJKKN role. The email is matched to a MyJKKN staff
 * record, and that record's roles — pooled with whatever the token already
 * named — decide everything: whether the library opens at all, and which
 * college they see. Nothing is assigned in this module.
 *
 * Only four MyJKKN roles open this application: super_admin, library_admin,
 * librarian and assistant_librarian. A person may hold several at once and only
 * one of them needs to be a library role; where more than one matches, the
 * highest wins. Super Admin (`super_admin`) has full access — every college,
 * every page, no further grant required. Anyone else — including senior roles
 * like `ceo` — is refused and shown the restricted page.
 *
 * The library `users` and `user_roles` tables are no longer read. They are
 * left in the database untouched, but nothing here consults them.
 *
 * One narrow exception exists: `role-grants.ts`, a list of email addresses in
 * the environment that are given a library role for a fixed number of days. It
 * is not a second login — a granted person still signs in the same way and is
 * still validated the same way — it only answers the question MyJKKN could
 * not, for somebody who has no staff record yet.
 */

import {
	LIBRARY_ROLES,
	ROLE_LABEL,
	highestLibraryRole,
	rankAtLeast,
	type LibraryRole,
} from './library-roles'
import {
	staffByEmail,
	staffById,
	collegeForMyjkknInstitution,
	invalidateStaff,
	type MyjkknStaff,
} from './myjkkn-staff'
import { verifyAccessToken } from './supabase-auth-server'
import { ACCESS_TOKEN_COOKIE } from './supabase-auth'
import { grantFor, idForGrantedEmail } from './role-grants'

export type { LibraryRole } from './library-roles'
export { LIBRARY_ROLES, ROLE_LABEL } from './library-roles'

export interface Caller {
	/** MyJKKN's staff id, or the auth user id when they have no staff record. */
	userId: string
	email: string
	fullName: string | null
	/** The highest library role MyJKKN gives them. */
	role: LibraryRole
	/** Every role MyJKKN gives them, library or not — shown, never trusted for access. */
	myjkknRoles: string[]
	/** null for super_admin, and for a library admin who oversees every college */
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

/** Why somebody was turned away, in enough detail for the page to explain it. */
export type RefusalReason =
	| 'not_signed_in'
	| 'session_expired'
	| 'not_staff'
	| 'inactive'
	| 'role_not_allowed'
	| 'no_institution'

export type Identity =
	| { ok: true; caller: Caller }
	| {
		ok: false
		reason: RefusalReason
		error: string
		status: number
		/** What MyJKKN does say they are, so the refusal can name it. */
		email?: string | null
		fullName?: string | null
		myjkknRoles?: string[]
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

	return readCookie(request, ACCESS_TOKEN_COOKIE)
}

/**
 * Builds a caller from one MyJKKN staff record.
 *
 * Shared by the signed-in caller and by whoever a super admin is viewing as, so
 * both are resolved by exactly the same rules — there is no second, laxer path
 * into the system.
 *
 * `extraRoleKeys` carries anything the sign-in token itself said, pooled with
 * the staff record's roles: a role named in either place counts, because only
 * one library role is needed to get in.
 */
async function callerFromStaff(
	staff: MyjkknStaff,
	extraRoleKeys: string[] = []
): Promise<Identity> {
	const allRoleKeys = [...new Set([...staff.roleKeys, ...extraRoleKeys.map(String)])]

	if (!staff.isActive) {
		return {
			ok: false,
			reason: 'inactive',
			error: 'Your MyJKKN account is not active',
			status: 403,
			email: staff.email,
			fullName: staff.fullName,
			myjkknRoles: allRoleKeys,
		}
	}

	const role = highestLibraryRole(allRoleKeys)
	if (!role) {
		return {
			ok: false,
			reason: 'role_not_allowed',
			error: 'Your MyJKKN role does not have access to the library',
			status: 403,
			email: staff.email,
			fullName: staff.fullName,
			myjkknRoles: allRoleKeys,
		}
	}

	// Super Admin and Library Admin oversee every college. The college MyJKKN
	// files them under is where they sit, not what they run — reading it as a
	// pin took the switcher away.
	const spansEveryCollege = role === 'super_admin' || role === 'library_admin'
	const institutionId = spansEveryCollege
		? null
		: await collegeForMyjkknInstitution(staff.myjkknInstitutionId)

	// A librarian must belong to a college; without one there is nothing for
	// them to run, and letting them through unscoped would show them every
	// campus at once. Super Admin is never in this branch.
	if (!institutionId && !spansEveryCollege) {
		return {
			ok: false,
			reason: 'no_institution',
			error: 'Your MyJKKN college is not set up as a library yet',
			status: 403,
			email: staff.email,
			fullName: staff.fullName,
			myjkknRoles: allRoleKeys,
		}
	}

	return {
		ok: true,
		caller: {
			userId: staff.id,
			email: staff.email,
			fullName: staff.fullName,
			role,
			myjkknRoles: allRoleKeys,
			institutionId,
			isSuperAdmin: role === 'super_admin',
			impersonatedBy: null,
		},
	}
}

/**
 * How long a resolved caller is reused before being worked out again.
 *
 * Answering "who is this" costs a round trip to Supabase to check the token,
 * plus the MyJKKN staff lookup. Every `/api/lib/*` route starts with it, and
 * opening one page fires several at once, so the desk would pay that toll
 * several times over before anything appeared.
 *
 * So the answer is held briefly and shared. The rules themselves are untouched
 * — the same validation, the same role resolution, the same institution scope,
 * just not repeated for every request in the same breath. A role changed in
 * MyJKKN takes effect within the minute.
 */
const CALLER_TTL_MS = 60_000

/** Refusals are held far more briefly — just long enough to absorb one burst. */
const REFUSAL_TTL_MS = 10_000

/** Well above the number of people signed in at once; keeps the map bounded. */
const MAX_CACHED_CALLERS = 500

interface CachedIdentity {
	identity: Identity
	expiresAt: number
	/** Who this entry describes, so a change can drop it by hand. */
	userId: string | null
}

const callerCache = new Map<string, CachedIdentity>()

/**
 * Resolutions already under way, keyed the same as the cache.
 *
 * The several requests a page opens with arrive together, so without this they
 * would all miss the empty cache and each start their own validation. Sharing
 * the one promise turns that burst into a single round trip.
 */
const callerInFlight = new Map<string, Promise<Identity>>()

/** Drops entries that have expired, and if still crowded, the whole lot. */
function pruneCallerCache(): void {
	if (callerCache.size < MAX_CACHED_CALLERS) return

	const now = Date.now()
	for (const [key, entry] of callerCache) {
		if (entry.expiresAt <= now) callerCache.delete(key)
	}

	if (callerCache.size >= MAX_CACHED_CALLERS) callerCache.clear()
}

/**
 * Forgets what is known about one person, or about everyone.
 *
 * Called wherever something that decides access may have changed, so it is felt
 * on the very next request rather than up to a minute later.
 */
export function invalidateCaller(userId?: string | null): void {
	invalidateStaff(userId)

	if (!userId) {
		callerCache.clear()
		return
	}

	for (const [key, entry] of callerCache) {
		if (entry.userId === userId) callerCache.delete(key)
	}
}

/**
 * Identifies the caller, in full — including why somebody was turned away.
 *
 * Used by the route that tells the browser whether to draw the application or
 * the restricted page. Everywhere else wants `getCaller`.
 */
export async function identifyCaller(request: Request): Promise<Identity> {
	const token = readToken(request)
	if (!token) {
		return { ok: false, reason: 'not_signed_in', error: 'Not signed in', status: 401 }
	}

	// Viewing as someone else gives a different caller for the same token, so it
	// has to be part of the key or a super admin would be served their own row.
	const viewAsId = readCookie(request, IMPERSONATION_COOKIE)
	const key = `${token}|${viewAsId ?? ''}`

	const cached = callerCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.identity

	const running = callerInFlight.get(key)
	if (running) return running

	const work = resolveIdentityFor(token, viewAsId)
		.then(identity => {
			pruneCallerCache()
			callerCache.set(key, {
				identity,
				expiresAt: Date.now() + (identity.ok ? CALLER_TTL_MS : REFUSAL_TTL_MS),
				userId: identity.ok ? identity.caller.userId : null,
			})
			return identity
		})
		.finally(() => {
			callerInFlight.delete(key)
		})

	callerInFlight.set(key, work)
	return work
}

/**
 * Identifies the caller.
 *
 * When a super admin has picked someone to view as, the returned caller IS
 * that person — same role, same college, same limits — because the point of the
 * feature is to see and do exactly what they can. Who is really at the keyboard
 * is kept on `impersonatedBy` so nothing becomes anonymous.
 */
export async function getCaller(request: Request): Promise<AccessResult> {
	const identity = await identifyCaller(request)
	if (identity.ok) return { caller: identity.caller }
	return { caller: null, error: identity.error, status: identity.status }
}

/**
 * A person MyJKKN has no staff row for, but whose token already names a role
 * that spans every college — Super Admin, or Library Admin.
 *
 * Super Admin has full access on that role alone. Nothing is assigned here.
 */
function callerFromTokenRoles(
	identity: { authUserId: string; email: string; fullName: string | null },
	roleKeys: string[]
): Promise<Identity> | null {
	const role = highestLibraryRole(roleKeys)
	if (role !== 'super_admin' && role !== 'library_admin') return null

	return callerFromStaff({
		id: identity.authUserId,
		email: identity.email,
		fullName: identity.fullName,
		staffCode: null,
		roleKeys,
		myjkknInstitutionId: null,
		isActive: true,
	})
}

/** The work behind identifyCaller, unchanged apart from being callable. */
async function resolveIdentityFor(token: string, viewAsId: string | null): Promise<Identity> {
	const identity = await verifyAccessToken(token)
	if (!identity) {
		return {
			ok: false,
			reason: 'session_expired',
			error: 'Session expired — please sign in again',
			status: 401,
		}
	}

	const staff = await staffByEmail(identity.email)

	let real: Identity = staff
		? await callerFromStaff(staff, identity.roleKeys)
		: {
			ok: false,
			reason: 'not_staff',
			error: 'MyJKKN has no staff record for this account',
			status: 403,
			email: identity.email,
			fullName: identity.fullName,
			myjkknRoles: identity.roleKeys,
		}

	// No staff row, but the token already names Super Admin (or Library Admin).
	// They span every college, so the missing staff record costs them nothing
	// — Super Admin has full access from the MyJKKN role alone.
	if (!real.ok && real.reason === 'not_staff') {
		const fromToken = await callerFromTokenRoles(identity, identity.roleKeys)
		if (fromToken) real = fromToken
	}

	// Turned away by MyJKKN, but named in the grant list.
	//
	// Only these two refusals are overridden. `inactive` deliberately is not: an
	// account switched off in MyJKKN stays off, and a grant must never be a way
	// back in for somebody who has been deactivated on purpose.
	if (!real.ok && (real.reason === 'not_staff' || real.reason === 'role_not_allowed')) {
		const grant = grantFor(identity.email)
		if (grant) {
			const granted = await callerFromStaff({
				id: staff?.id ?? idForGrantedEmail(identity.email),
				email: identity.email,
				fullName: staff?.fullName ?? identity.fullName,
				staffCode: staff?.staffCode ?? null,
				roleKeys: [grant.role],
				myjkknInstitutionId: staff?.myjkknInstitutionId ?? null,
				isActive: true,
			})
			if (granted.ok) real = granted
		}
	}

	if (!real.ok) return real

	// Only a super admin can be viewing as someone else. If anyone else has the
	// cookie it is ignored outright rather than trusted.
	if (viewAsId && real.caller.isSuperAdmin && viewAsId !== real.caller.userId) {
		const target = await staffById(viewAsId)
		if (target) {
			const asCaller = await callerFromStaff(target)
			if (asCaller.ok) {
				return {
					ok: true,
					caller: {
						...asCaller.caller,
						impersonatedBy: { userId: real.caller.userId, email: real.caller.email },
					},
				}
			}
		}
		// Target gone, deactivated, or no longer a library person — fall through
		// as the real super admin rather than refusing them their own session
	}

	return real
}

/** True when the caller holds at least the given role. */
export function hasAtLeast(caller: Caller, minimum: LibraryRole): boolean {
	return rankAtLeast(caller.role, minimum)
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

	// A library admin oversees all seven and switches between them, exactly as a
	// super admin does. Deliberately narrower in one respect: it reads every
	// library but, unlike super_admin, it cannot open Staff Access or view as
	// another user — running the libraries is not the same as deciding who may.
	if (caller.role === 'library_admin') {
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
