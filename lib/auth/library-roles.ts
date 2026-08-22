/**
 * Who may open this library at all.
 *
 * A person's role is MyJKKN's to decide, not ours. This project keeps no role
 * of its own any more — it only asks MyJKKN what roles someone holds and looks
 * for one of these four. Anything else, including a perfectly senior MyJKKN
 * role like `ceo`, means the library is not their tool and they are shown the
 * restricted page.
 *
 * Deliberately in a file of its own, with no server imports, so the guard on
 * the API and the page that explains the refusal both read the same list and
 * cannot drift apart.
 */

/** The only roles that open this application. Highest first. */
export const LIBRARY_ROLES = [
	'super_admin',
	'library_admin',
	'librarian',
	'assistant_librarian',
] as const

export type LibraryRole = (typeof LIBRARY_ROLES)[number]

/** Used for "at least this role" checks. */
export const ROLE_RANK: Record<LibraryRole, number> = {
	super_admin: 4,
	library_admin: 3,
	librarian: 2,
	assistant_librarian: 1,
}

/** What each role is called on screen. */
export const ROLE_LABEL: Record<LibraryRole, string> = {
	super_admin: 'Super Admin',
	library_admin: 'Library Admin',
	librarian: 'Librarian',
	assistant_librarian: 'Assistant Librarian',
}

/**
 * MyJKKN writes a role key in more than one shape depending on where it is
 * read from — `library_admin`, `Library Admin`, `LIBRARY-ADMIN`. All three mean
 * the same person, so they are flattened before being compared.
 */
export function normaliseRoleKey(value: unknown): string {
	return (value ?? '')
		.toString()
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
}

export function isLibraryRole(value: unknown): value is LibraryRole {
	return (LIBRARY_ROLES as readonly string[]).includes(normaliseRoleKey(value))
}

/**
 * The best library role among everything MyJKKN says this person is.
 *
 * A person may hold several roles at once — the rule is that ANY one of the
 * four lets them in, and where more than one matches, the highest wins: a
 * librarian who is also a library admin gets the library admin's reach.
 * Returns null when none of their roles is a library role.
 */
export function highestLibraryRole(roleKeys: readonly unknown[]): LibraryRole | null {
	let best: LibraryRole | null = null

	for (const key of roleKeys) {
		const normalised = normaliseRoleKey(key)
		if (!isLibraryRole(normalised)) continue
		const role = normalised as LibraryRole
		if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role
	}

	return best
}

/** True when the caller holds at least the given role. */
export function rankAtLeast(role: LibraryRole, minimum: LibraryRole): boolean {
	return ROLE_RANK[role] >= ROLE_RANK[minimum]
}
