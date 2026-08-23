/**
 * Reading and writing what each role may open.
 *
 * The policy itself is in `role-pages.ts`, which knows nothing about a
 * database. This is the thin layer that fetches the stored choice and hands it
 * back already settled — locks applied, unknown paths dropped — so no caller
 * has to remember to do that.
 *
 * Held in memory briefly. `/api/lib/access/me` is asked once per tab and every
 * page guard reads the answer from there, so this is not a hot query; the cache
 * is there so a burst of tabs opening at once costs one round trip rather than
 * several. A change made on the Role Management screen drops it by hand, so it
 * is felt on the very next request and not up to a minute later.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import {
	defaultPagesFor,
	isManageableRole,
	settledPagesFor,
	type ManageableRole,
} from './role-pages'

/** What is stored, before the locks are applied. null means no row. */
export type StoredPages = Record<ManageableRole, string[] | null>

const STORE_TTL_MS = 60_000

let cached: { rows: StoredPages; expiresAt: number } | null = null
let inFlight: Promise<StoredPages> | null = null

/** Warned about only once, so a missing table does not fill the log. */
let warnedMissingTable = false

function emptyStore(): StoredPages {
	return { library_admin: null, librarian: null, assistant_librarian: null }
}

/** Forgets the stored choice so the next read comes from the database. */
export function invalidateRolePages(): void {
	cached = null
}

async function loadStore(): Promise<StoredPages> {
	const supabase = getSupabaseServer()
	const { data, error } = await supabase
		.from('lib_role_pages')
		.select('role, pages')

	if (error) {
		// The table arrives in a migration that may not have been run yet. That
		// must not take the application down: with no table there is no stored
		// choice, which is exactly the same thing as an empty table — every role
		// falls back to the code default and behaves as it always did.
		if (error.code === '42P01') {
			if (!warnedMissingTable) {
				warnedMissingTable = true
				console.warn(
					'[role-pages] lib_role_pages does not exist yet — every role is on the code default. ' +
					'Run supabase/migrations/20260823_lib_role_pages.sql to enable Role Management.'
				)
			}
			return emptyStore()
		}

		// Anything else is a real fault. Falling back to the default is the safe
		// direction: it is what the role had before this feature existed.
		console.error('[role-pages] Could not read lib_role_pages:', error.message)
		return emptyStore()
	}

	const rows = emptyStore()
	for (const row of data ?? []) {
		if (!isManageableRole(row.role)) continue
		rows[row.role] = Array.isArray(row.pages) ? row.pages.map(String) : []
	}
	return rows
}

/** Every role's stored choice, cached. null against a role means no row. */
export async function storedRolePages(): Promise<StoredPages> {
	if (cached && cached.expiresAt > Date.now()) return cached.rows
	if (inFlight) return inFlight

	inFlight = loadStore()
		.then(rows => {
			cached = { rows, expiresAt: Date.now() + STORE_TTL_MS }
			return rows
		})
		.finally(() => { inFlight = null })

	return inFlight
}

/**
 * The pages this role may open, ready to use.
 *
 * A super admin is never restricted and gets null, which every reader takes to
 * mean "everything". Anything that is not one of the three configurable roles
 * gets the code default rather than nothing, so an unexpected role never
 * arrives at a blank menu.
 */
export async function allowedPagesFor(role: string | null | undefined): Promise<string[] | null> {
	if (role === 'super_admin') return null
	if (!isManageableRole(role)) return defaultPagesFor(role)

	const rows = await storedRolePages()
	return settledPagesFor(role, rows[role])
}

/** Saves one role's choice. The caller must already have checked who is asking. */
export async function saveRolePages(
	role: ManageableRole,
	pages: string[],
	savedBy: { userId: string; name: string | null }
): Promise<{ ok: true; pages: string[] } | { ok: false; error: string; status: number }> {
	// Stored settled rather than raw, so what is read back is what was meant —
	// a locked page cannot be argued about later by editing the row.
	const settled = settledPagesFor(role, pages)

	const supabase = getSupabaseServer()
	const { error } = await supabase
		.from('lib_role_pages')
		.upsert(
			{
				role,
				pages: settled,
				updated_by: savedBy.userId,
				updated_by_name: savedBy.name,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: 'role' }
		)

	if (error) {
		if (error.code === '42P01') {
			return {
				ok: false,
				status: 503,
				error: 'Role Management is not set up on this database yet — run the 20260823_lib_role_pages migration',
			}
		}
		console.error('[role-pages] Could not save lib_role_pages:', error.message)
		return { ok: false, status: 500, error: 'Failed to save' }
	}

	invalidateRolePages()
	return { ok: true, pages: settled }
}

/** Puts one role back on the code default by removing its row. */
export async function resetRolePages(
	role: ManageableRole
): Promise<{ ok: true; pages: string[] } | { ok: false; error: string; status: number }> {
	const supabase = getSupabaseServer()
	const { error } = await supabase.from('lib_role_pages').delete().eq('role', role)

	if (error && error.code !== '42P01') {
		console.error('[role-pages] Could not reset lib_role_pages:', error.message)
		return { ok: false, status: 500, error: 'Failed to reset' }
	}

	invalidateRolePages()
	return { ok: true, pages: defaultPagesFor(role) }
}
