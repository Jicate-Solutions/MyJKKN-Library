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

/**
 * The auth project's service key.
 *
 * Server-only — deliberately not `NEXT_PUBLIC_`, so it never reaches a browser.
 * It exists because `profiles` is behind RLS: with the anon key, or with the
 * signed-in person's own token, the table answers with nothing at all (0 rows
 * of 7,605 when asked anonymously). That is why somebody whose only record in
 * MyJKKN is a `profiles` row — no staff record — could not be identified, and
 * had to be let in by hand through the grant list.
 *
 * Without this key everything still works exactly as it did: the read falls
 * back to the caller's own token, and a deployment that has not been given the
 * key is no worse off than before.
 */
const AUTH_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY1 ?? ''

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

/** The same, for reading `profiles` past RLS. Null when no service key is set. */
let profileReader: SupabaseClient | null = null

function getProfileReader(): SupabaseClient | null {
	if (!supabaseAuthConfigured() || !AUTH_SERVICE_ROLE_KEY) return null

	if (!profileReader) {
		profileReader = createClient(SUPABASE_AUTH_URL, AUTH_SERVICE_ROLE_KEY, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	}
	return profileReader
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
	/**
	 * What MyJKKN's own `profiles` row says, or null when there is none.
	 *
	 * Kept separate from `roleKeys` because it answers a second question:
	 * whether the account is switched on at all. Somebody who is `super_admin`
	 * in profiles but `is_active = false` must not be let in on that role.
	 */
	profile: AuthProfile | null
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
 * The MyJKKN `profiles` row behind a signed-in account.
 *
 * `profiles` is where MyJKKN keeps what somebody is: `role`, the
 * `is_super_admin` flag, whether the account is live, and their name. It is
 * deliberately NOT the library's own `users` table, which is not consulted
 * anywhere any more.
 *
 * The role values there are already the keys this project uses — the live table
 * holds `super_admin`, `library_admin`, `librarian` and `assistant_librarian`
 * spelled exactly so. "Super Administrator" is only the title shown on screen,
 * so nothing is translated here.
 *
 * Read with the service key where one is configured, because RLS otherwise
 * hides the row even from its own owner. Where it is not, the caller's token is
 * used exactly as before — that path finds nothing on this project, but a
 * deployment without the key is no worse off than it was.
 *
 * Read by `id` first: `profiles.id` IS the Supabase auth user id (verified on
 * the live project), so it is an exact primary-key hit. Email is tried only if
 * that misses, for a project whose ids are kept apart.
 *
 * A missing table or an RLS miss is not an error — the staff API still answers.
 * Warned once so a project that is auth-only does not fill the log.
 */
let warnedMissingProfiles = false

/** What the profile says about somebody, as this project needs it. */
export interface AuthProfile {
	fullName: string | null
	roleKeys: string[]
	/** MyJKKN's own switch. 830 of the live profiles are off. */
	isActive: boolean
	/** A separate switch again, set on 109 of them. Either one closes the door. */
	loginDisabled: boolean
}

interface ProfileRow {
	full_name?: unknown
	role?: unknown
	is_super_admin?: boolean
	is_active?: boolean
	is_login_disabled?: boolean
}

const PROFILE_COLUMNS = 'full_name, role, is_super_admin, is_active, is_login_disabled'

async function profileFromAuthDatabase(
	token: string,
	authUserId: string,
	email: string
): Promise<AuthProfile | null> {
	if (!supabaseAuthConfigured()) return null

	try {
		// The service client carries no session, so one is made and shared. The
		// token client cannot be: it is bound to one person's request.
		const client = getProfileReader()
			?? createClient(SUPABASE_AUTH_URL, SUPABASE_AUTH_ANON_KEY, {
				global: { headers: { Authorization: `Bearer ${token}` } },
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
			})

		const readProfile = (column: 'id' | 'email', value: string) =>
			client
				.from('profiles')
				.select(PROFILE_COLUMNS)
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
				return null
			}
			return null
		}

		if (!data && email) {
			const byEmail = await readProfile('email', email.toLowerCase())
			if (byEmail.error) return null
			data = byEmail.data
		}

		if (!data) return null

		const row = data as ProfileRow
		const keys: string[] = []
		const role = normaliseRoleKey(row.role)
		if (role && !NOT_A_MYJKKN_ROLE.has(role)) keys.push(role)
		// The flag is generated from `role = 'super_admin'`, so the two normally
		// agree — read anyway, so the flag alone is enough for full access.
		if (row.is_super_admin === true) keys.push('super_admin')

		const name = (row.full_name ?? '').toString().replace(/\s+/g, ' ').trim()

		return {
			fullName: name.length > 0 ? name : null,
			roleKeys: keys,
			// Absent means present-and-fine: a column this project has not been
			// given must never be read as "switched off".
			isActive: row.is_active !== false,
			loginDisabled: row.is_login_disabled === true,
		}
	} catch {
		return null
	}
}

/** A single reusable client is not kept here on purpose — see the note above. */

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

		// Always read, rather than only when the token named no role. The row
		// carries the active flags as well as the role, and skipping it for
		// somebody whose metadata happens to say `super_admin` would skip the one
		// thing that can say they have since been switched off. It is a
		// primary-key hit, and `identifyCaller` holds the whole answer for a
		// minute, so it costs one small read per person per minute.
		const profile = await profileFromAuthDatabase(token, data.user.id, data.user.email)

		return {
			authUserId: data.user.id,
			email: data.user.email,
			// MyJKKN's own spelling of the name wins over Google's.
			fullName: profile?.fullName ?? nameFromMetadata(metadata),
			avatarUrl: (metadata?.avatar_url ?? metadata?.picture ?? null) as string | null,
			roleKeys: [...new Set([...fromUser, ...(profile?.roleKeys ?? [])])],
			profile,
		}
	} catch (error) {
		console.error('[auth] Token check failed:', error)
		return null
	}
}
