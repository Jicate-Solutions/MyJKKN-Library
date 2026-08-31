/**
 * What a MyJKKN role is permitted to do in this application, as
 * `resource:action` names.
 *
 * Read from this project's `role_permissions` → `permissions` — the mapping of
 * a role name onto screens, not an assignment of a role onto a person. People
 * get their role from MyJKKN; this only answers what that role may do here.
 *
 * Used to fill `hasPermission()` in the browser. Every `/api/lib/*` route still
 * checks the role itself server-side, so a tampered list gains nothing.
 * Super Admin never consults this list: they have full access.
 */

import { getSupabaseServer } from '@/lib/supabase-server'

const PERMISSIONS_TTL_MS = 60_000

const permissionCache = new Map<string, { names: string[]; expiresAt: number }>()

const text = (value: unknown): string => (value ?? '').toString().trim()

/** Drops cached permission lists after a change on the roles screen. */
export function invalidatePermissions(): void {
	permissionCache.clear()
}

export async function permissionsForRoles(roleNames: readonly string[]): Promise<string[]> {
	const wanted = [...new Set(roleNames.map(r => text(r).toLowerCase()).filter(Boolean))].sort()
	if (wanted.length === 0) return []

	const key = wanted.join(',')
	const cached = permissionCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.names

	const supabase = getSupabaseServer()
	const { data, error } = await supabase
		.from('roles')
		.select('name, role_permissions ( permissions ( name, is_active ) )')
		.in('name', wanted)
		.eq('is_active', true)

	if (error) {
		console.error('[role-permissions] Could not read role permissions:', error.message)
		return []
	}

	const names = new Set<string>()
	for (const role of data ?? []) {
		const links = Array.isArray((role as { role_permissions?: unknown }).role_permissions)
			? (role as { role_permissions: unknown[] }).role_permissions
			: []
		for (const link of links) {
			const row = link as { permissions?: unknown }
			const permissions = Array.isArray(row?.permissions)
				? row.permissions
				: row?.permissions
					? [row.permissions]
					: []
			for (const permission of permissions) {
				const item = permission as { name?: unknown; is_active?: boolean }
				if (!item || item.is_active === false) continue
				const name = text(item.name)
				if (name) names.add(name)
			}
		}
	}

	const list = [...names].sort()
	permissionCache.set(key, { names: list, expiresAt: Date.now() + PERMISSIONS_TTL_MS })
	return list
}
