/**
 * The shape of a signed-in person, as the browser holds them.
 *
 * Filled by `GET /api/auth/session`, which works every field out server-side:
 * the email from Supabase Auth, and the role, permissions and college from
 * their MyJKKN role. Nothing here is set by the browser. Super Admin has full
 * access — `is_super_admin` is true and `role` is `super_admin`.
 */

export interface AppUser {
	/** MyJKKN staff id, or the auth user id when they have no staff record. */
	id: string | null
	email: string
	full_name: string
	first_name?: string
	last_name?: string
	/** The highest role they hold. */
	role: string
	/** Every role on their account. */
	roles?: string[]
	avatar_url?: string
	permissions?: string[]
	institution_id?: string | null
	institution_code?: string | null
	institution_name?: string | null
	counselling_code?: string | null
	/** MyJKKN institution UUIDs, for filtering calls to the MyJKKN API. */
	myjkkn_institution_ids?: string[] | null
	short_name?: string
	institution_type?: string
	department_code?: string
	is_active?: boolean
	is_super_admin?: boolean
	/** True when one of their roles opens the library at all. */
	has_library_access?: boolean
	last_login?: string
}

/**
 * The old name, kept so the components that import it keep compiling.
 *
 * @deprecated There is no parent app any more — use `AppUser`.
 */
export type ParentAppUser = AppUser
