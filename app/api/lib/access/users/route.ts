/**
 * Staff access management — who may sign in and what they may do.
 *
 * GET  /api/lib/access/users            list staff accounts with their role
 * POST /api/lib/access/users            assign a role  { user_id, role }
 *
 * super_admin only. Handing out roles is not something an admin does, so the
 * page, its sidebar link and these handlers all stop at the same rule.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import {
	getCaller,
	canAssignRole,
	resolveInstitutionScope,
	invalidateCaller,
	ASSIGNABLE_ROLES,
	type LibraryRole,
} from '@/lib/auth/server-access'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) return NextResponse.json({ error }, { status: status ?? 401 })

		// Granting library roles is a super admin job. An admin runs a library —
		// or all of them — but does not decide who else may.
		if (!caller.isSuperAdmin) {
			return NextResponse.json({ error: 'Only a super admin can view staff access' }, { status: 403 })
		}

		const { searchParams } = new URL(request.url)
		const scope = resolveInstitutionScope(caller, searchParams.get('institution_id'))
		if (scope.error) return NextResponse.json({ error: scope.error }, { status: scope.status ?? 403 })

		const supabase = getSupabaseServer()

		const { data: users, error: usersError } = await fetchAllRows<{ id: string; [field: string]: any }>(range => {
			let query = supabase
				.from('users')
				.select('id, email, full_name, role, is_super_admin, is_active, institution_id, last_login')
				.order('full_name', { ascending: true })

			if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)

			return query.range(range.from, range.to)
		})
		if (usersError) {
			console.error('Error listing staff accounts:', usersError)
			return NextResponse.json({ error: 'Failed to load staff accounts' }, { status: 500 })
		}

		// Attach assigned roles in one round-trip rather than per user
		const ids = (users || []).map(u => u.id)
		const rolesByUser = new Map<string, string[]>()

		if (ids.length > 0) {
			const { data: assignments } = await supabase
				.from('user_roles')
				.select('user_id, roles(name)')
				.in('user_id', ids)
				.eq('is_active', true)

			for (const row of assignments || []) {
				const name = (row.roles as any)?.name
				if (!name) continue
				const list = rolesByUser.get(row.user_id) ?? []
				list.push(name)
				rolesByUser.set(row.user_id, list)
			}
		}

		const data = (users || []).map(u => ({
			...u,
			assigned_roles: rolesByUser.get(u.id) ?? [],
			// What the app will actually treat them as
			effective_role: u.is_super_admin
				? 'super_admin'
				: (rolesByUser.get(u.id)?.[0] ?? u.role ?? 'member'),
		}))

		return NextResponse.json({
			data,
			caller: { role: caller.role, institution_id: caller.institutionId },
			assignable_roles: ASSIGNABLE_ROLES.filter(r => canAssignRole(caller, r).allowed),
		})
	} catch (error) {
		console.error('Unexpected error listing staff access:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) return NextResponse.json({ error }, { status: status ?? 401 })

		if (!caller.isSuperAdmin) {
			return NextResponse.json({ error: 'Only a super admin can assign roles' }, { status: 403 })
		}

		const body = await request.json()
		const targetUserId: string | undefined = body.user_id
		const targetRole: LibraryRole | undefined = body.role

		if (!targetUserId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
		if (!targetRole || !ASSIGNABLE_ROLES.includes(targetRole)) {
			return NextResponse.json(
				{ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
				{ status: 400 }
			)
		}

		// The escalation guard: an admin cannot mint a super_admin or another admin
		const permission = canAssignRole(caller, targetRole)
		if (!permission.allowed) {
			return NextResponse.json({ error: permission.reason }, { status: 403 })
		}

		const supabase = getSupabaseServer()

		// Who is being changed, and which role they are being given. Independent
		// questions, so they are asked together. The checks below still run in
		// their old order, so the same refusal comes back first as before.
		const [{ data: target }, { data: roleRow }] = await Promise.all([
			supabase
				.from('users')
				.select('id, email, full_name, institution_id, is_super_admin, role')
				.eq('id', targetUserId)
				.maybeSingle(),
			supabase
				.from('roles')
				.select('id, name')
				.eq('name', targetRole)
				.maybeSingle(),
		])

		if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

		// An admin may only touch accounts inside their own institution
		if (!caller.isSuperAdmin && target.institution_id !== caller.institutionId) {
			return NextResponse.json(
				{ error: 'You can only manage accounts in your own institution' },
				{ status: 403 }
			)
		}

		// An admin must not be able to demote or alter an existing super admin
		if (!caller.isSuperAdmin && target.is_super_admin) {
			return NextResponse.json(
				{ error: 'Only a super admin can change another super admin' },
				{ status: 403 }
			)
		}

		if (!roleRow) {
			return NextResponse.json({ error: `Role "${targetRole}" does not exist` }, { status: 400 })
		}

		// One effective role per person — retire the old assignments first
		await supabase
			.from('user_roles')
			.update({ is_active: false, updated_at: new Date().toISOString() })
			.eq('user_id', targetUserId)
			.eq('is_active', true)

		const { error: assignError } = await supabase
			.from('user_roles')
			.upsert(
				{
					user_id: targetUserId,
					role_id: roleRow.id,
					is_active: true,
					assigned_by: caller.userId,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: 'user_id,role_id' }
			)

		if (assignError) {
			console.error('Error assigning role:', assignError)
			return NextResponse.json({ error: 'Failed to assign role' }, { status: 500 })
		}

		// Keep the legacy column in step so older code paths agree
		await supabase
			.from('users')
			.update({
				role: targetRole,
				is_super_admin: targetRole === 'super_admin',
				updated_at: new Date().toISOString(),
			})
			.eq('id', targetUserId)

		// Callers are held briefly to save re-validating a token on every
		// request; drop this person from that so their new role is in force on
		// their very next click rather than up to a minute later.
		invalidateCaller(targetUserId)

		return NextResponse.json({
			success: true,
			user_id: targetUserId,
			role: targetRole,
			message: `${target.full_name ?? target.email} is now ${targetRole.replace('_', ' ')}`,
		})
	} catch (error) {
		console.error('Unexpected error assigning role:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
