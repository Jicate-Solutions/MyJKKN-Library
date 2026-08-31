/**
 * Reading the sign-in session on the server.
 *
 * Two shapes are needed and they are deliberately different.
 *
 * `getAuthRouteClient` is bound to Next's cookie store and may WRITE — it is
 * what the OAuth callback uses to turn a code into a session, and what sign-out
 * uses to end one. Only routes that own their response should use it.
 *
 * `verifyAccessToken` only READS. It takes a token and asks the auth project
 * who it belongs to, holding no session of its own and touching no cookie. That
 * matters: a client that could refresh would rotate the refresh token behind
 * the browser's back and, having nowhere to write the new one, would leave the
 * browser holding a token that is already void — the random-logout bug that
 * makes this whole area miserable to debug. Refreshing is the browser's job
 * alone; the server only ever checks.
 */

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY, supabaseAuthConfigured } from './supabase-auth'
import { normaliseRoleKey } from './library-roles'

/**
 * A client bound to this request's cookies, able to write the session back.
 *
 * Use only from a route handler. A Server Component cannot set cookies, and the
 * write is swallowed there rather than throwing — Next itself is explicit that
 * this is safe as long as something else owns the response.
 */
export async function getAuthRouteClient(): Promise<SupabaseClient> {
	const store = await cookies()

	return createServerClient(SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY, {
		cookies: {
			getAll: () => store.getAll(),
			setAll: list => {
				try {
					for (const { name, value, options } of list) store.set(name, value, options)
				} catch {
					// Called from a Server Component, which may not set cookies.
					// Harmless: the route that owns the response writes them.
				}
			},
		},
	})
}

/** One read-only client, made once — it carries no session, so it is shareable. */
let verifier: SupabaseClient | null = null

function getVerifier(): SupabaseClient | null {
	if (!supabaseAuthConfigured()) return null

	if (!verifier) {
		verifier = createClient(SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY, {
			auth: {
				persistSession: false,
				autoRefreshToken: false,
				detectSessionInUrl: false,
			},
		})
	}
	return verifier
}

/** Who the auth project says this token belongs to. */
export interface AuthIdentity {
	/** The Supabase auth user id. */
	authUserId: string
	email: string
	/** Whatever name the identity provider supplied, if any. */
	fullName: string | null
	avatarUrl: string | null
	/**
	 * MyJKKN roles carried on the auth user — app_metadata, user_metadata, and
	 * the `profiles` row on the same project when RLS lets this token read it.
	 *
	 * `super_admin` here is enough for full library access, whether it arrives
	 * as the role itself or as `profiles.is_super_admin`. The Supabase Auth role
	 * (`authenticated`) is never treated as a MyJKKN role.
	 */
	roleKeys: string[]
}

/** The name as the identity provider spells it, in whichever field it used. */
function nameFromMetadata(metadata: Record<string, unknown> | undefined | null): string | null {
	if (!metadata) return null

	const first = (metadata.given_name ?? metadata.first_name ?? '') as string
	const last = (metadata.family_name ?? metadata.last_name ?? '') as string
	const joined = [first, last].filter(Boolean).join(' ')

	const name = String(metadata.full_name ?? metadata.name ?? joined ?? '')
		.replace(/\s+/g, ' ')
		.trim()

	return name.length > 0 ? name : null
}

/** Postgres/Auth built-in roles — never a MyJKKN library role. */
const NOT_A_MYJKKN_ROLE = new Set(['authenticated', 'anon', 'service_role'])

/** MyJKKN roles named on one metadata object. */
function roleKeysFromMetadata(meta: Record<string, unknown> | undefined | null): string[] {
	if (!meta) return []

	const found = new Set<string>()
	const add = (value: unknown) => {
		const key = normaliseRoleKey(value)
		if (!key || NOT_A_MYJKKN_ROLE.has(key)) return
		found.add(key)
	}

	add(meta.role)
	add(meta.role_key)
	if (meta.is_super_admin === true) add('super_admin')

	for (const field of ['roles', 'role_keys', 'user_roles']) {
		const list = meta[field]
		if (!Array.isArray(list)) continue
		for (const entry of list) {
			if (entry && typeof entry === 'object') {
				const row = entry as Record<string, unknown>
				add(row.role_key)
				add(row.role_name)
				add(row.name)
				add(row.role)
			} else {
				add(entry)
			}
		}
	}

	return [...found]
}

function roleKeysFromAuthUser(user: User): string[] {
	const fromApp = roleKeysFromMetadata(user.app_metadata as Record<string, unknown> | undefined)
	const fromUser = roleKeysFromMetadata(user.user_metadata as Record<string, unknown> | undefined)
	return [...new Set([...fromApp, ...fromUser])]
}

/**
 * The MyJKKN `profiles` row this token is allowed to read on the auth project.
 *
 * `profiles` is where MyJKKN keeps what somebody is: `role`, and the
 * `is_super_admin` flag generated from it. It is deliberately NOT the library's
 * own `users` table, which is not consulted anywhere any more.
 *
 * Read by `id` rather than by email, because `profiles.id` IS the Supabase auth
 * user id — an exact primary-key hit, and the shape RLS is normally written
 * for (`auth.uid() = id`), where a search by email is usually refused outright.
 * Email is tried only if that misses, for a project whose ids are kept apart.
 *
 * A missing table or an RLS miss is not an error — the staff API still answers.
 * Warned once so a project that is auth-only does not fill the log.
 */
let warnedMissingProfiles = false

interface ProfileRoleRow {
	role?: unknown
	is_super_admin?: boolean
}

async function roleKeysFromAuthDatabase(
	token: string,
	authUserId: string,
	email: string
): Promise<string[]> {
	if (!supabaseAuthConfigured()) return []

	try {
		const client = createClient(SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY, {
			global: { headers: { Authorization: `Bearer ${token}` } },
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})

		const readProfile = (column: 'id' | 'email', value: string) =>
			client
				.from('profiles')
				.select('role, is_super_admin')
				.eq(column, value)
				.limit(1)
				.maybeSingle()

		let { data, error } = await readProfile('id', authUserId)

		if (error) {
			if (error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) {
				if (!warnedMissingProfiles) {
					warnedMissingProfiles = true
					console.warn('[auth] No profiles table on the auth project — roles come from metadata and MyJKKN staff')
				}
				return []
			}
			return []
		}

		// `profiles.id` is normally the auth user id; fall back to the address
		// only when it is not, rather than silently reporting no roles at all.
		if (!data && email) {
			const byEmail = await readProfile('email', email.toLowerCase())
			if (byEmail.error) return []
			data = byEmail.data
		}

		if (!data) return []

		const row = data as ProfileRoleRow
		const keys: string[] = []
		const role = normaliseRoleKey(row.role)
		if (role && !NOT_A_MYJKKN_ROLE.has(role)) keys.push(role)
		// The flag is generated from `role = 'super_admin'`, so the two normally
		// agree — read anyway, so the flag alone is enough for full access.
		if (row.is_super_admin === true) keys.push('super_admin')
		return keys
	} catch {
		return []
	}
}

/**
 * Checks one access token against the auth project.
 *
 * Returns null for anything that is not a live token belonging to a real
 * account — expired, revoked, forged, or simply unreachable. The caller treats
 * all of those the same way, as "not signed in", which is the safe direction.
 */
export async function verifyAccessToken(token: string): Promise<AuthIdentity | null> {
	const client = getVerifier()
	if (!client) {
		console.error('[auth] NEXT_PUBLIC_SUPABASE_URL1 / _ANON_KEY1 are not set — nobody can sign in')
		return null
	}

	try {
		const { data, error } = await client.auth.getUser(token)
		if (error || !data?.user?.email) return null

		const metadata = data.user.user_metadata as Record<string, unknown> | undefined
		const fromUser = roleKeysFromAuthUser(data.user)
		const alreadyHasLibraryRole = fromUser.includes('super_admin')
			|| fromUser.includes('library_admin')
			|| fromUser.includes('librarian')
			|| fromUser.includes('assistant_librarian')
		const fromTable = alreadyHasLibraryRole
			? []
			: await roleKeysFromAuthDatabase(token, data.user.id, data.user.email)

		return {
			authUserId: data.user.id,
			email: data.user.email,
			fullName: nameFromMetadata(metadata),
			avatarUrl: (metadata?.avatar_url ?? metadata?.picture ?? null) as string | null,
			roleKeys: [...new Set([...fromUser, ...fromTable])],
		}
	} catch (error) {
		console.error('[auth] Token check failed:', error)
		return null
	}
}
