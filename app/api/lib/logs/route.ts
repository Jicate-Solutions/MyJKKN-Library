/**
 * The activity log: POST /api/lib/logs · GET /api/lib/logs
 *
 * POST is how the screens report what a person did — a page opened, a menu
 * clicked, a sheet exported. Anyone signed in may write; nobody may say who
 * they are, because the identity is taken from their session token here.
 *
 * GET is the console's read, and it is the dangerous half: these rows carry
 * IP addresses, email addresses and whole records. Only an admin sees them,
 * and only for their own library unless they run all seven.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, hasAtLeast, resolveInstitutionScope } from '@/lib/auth/server-access'
import { logActivity, type ActivityAction } from '@/lib/library/activity-log'

/** One page of the console. Capped so a single request can never pull the table. */
const MAX_LIMIT = 500
const DEFAULT_LIMIT = 50

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const action = (body.action ?? '').toString().trim()
		if (!action) {
			return NextResponse.json({ error: 'Action is required' }, { status: 400 })
		}

		// Who they are is never read from the body — logActivity resolves it
		await logActivity(request, {
			action: action as ActivityAction,
			resource_type: body.resource_type ?? null,
			resource_id: body.resource_id ?? null,
			institution_id: body.institution_id ?? null,
			old_values: body.old_values ?? null,
			new_values: body.new_values ?? null,
			status: body.status ?? 'success',
			error_message: body.error_message ?? null,
			metadata: body.metadata ?? {},
		})

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error writing an activity log entry:', error)
		// Even here the caller is told nothing is wrong: a screen must not show
		// an error because its telemetry failed
		return NextResponse.json({ success: false }, { status: 200 })
	}
}

export async function GET(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) {
			return NextResponse.json({ error: error ?? 'Not signed in' }, { status: status ?? 401 })
		}
		if (!hasAtLeast(caller, 'admin')) {
			return NextResponse.json(
				{ error: 'Only an admin can read the activity log' },
				{ status: 403 }
			)
		}

		const { searchParams } = new URL(request.url)

		// A super admin may look at one college or at all of them; anyone else is
		// pinned to their own, whatever the request asks for
		const scope = resolveInstitutionScope(caller, searchParams.get('institution_id'))
		if (scope.error) {
			return NextResponse.json({ error: scope.error }, { status: scope.status ?? 403 })
		}

		const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
		const limit = Math.min(
			Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
			MAX_LIMIT
		)
		const from = (page - 1) * limit

		const supabase = getSupabaseServer()
		let query = supabase
			.from('lib_activity_log')
			.select('*', { count: 'exact' })
			.order('created_at', { ascending: false })

		if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)

		const action = searchParams.get('action')
		const resourceType = searchParams.get('resource_type')
		const rowStatus = searchParams.get('status')
		const userId = searchParams.get('user_id')
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')
		const search = searchParams.get('q')?.trim()

		if (action) query = query.eq('action', action)
		if (resourceType) query = query.eq('resource_type', resourceType)
		if (rowStatus) query = query.eq('status', rowStatus)
		if (userId) query = query.eq('user_id', userId)
		if (fromDate) query = query.gte('created_at', fromDate)
		if (toDate) query = query.lte('created_at', toDate)

		// Free text searches the whole table rather than the page on screen —
		// looking for a person and being shown nothing because they acted on
		// page 3 is worse than no search at all
		if (search) {
			const like = `%${search.replace(/[%_\\]/g, m => `\\${m}`)}%`
			query = query.or(
				`action.ilike.${like},resource_type.ilike.${like},resource_id.ilike.${like},error_message.ilike.${like},metadata->>user_email.ilike.${like}`
			)
		}

		const { data, error: readError, count } = await query.range(from, from + limit - 1)

		if (readError) {
			console.error('Error reading the activity log:', readError)
			return NextResponse.json(
				{ error: 'Could not read the activity log — has the table been created?' },
				{ status: 500 }
			)
		}

		const rows = data ?? []

		// Names are resolved now rather than joined: the log deliberately holds no
		// foreign key, so it survives a user being deleted
		const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))] as string[]
		const byUser = new Map<string, { id: string; email: string; full_name: string | null }>()

		if (userIds.length > 0) {
			const { data: users } = await supabase
				.from('users')
				.select('id, email, full_name')
				.in('id', userIds)
			for (const user of users ?? []) byUser.set(user.id, user)
		}

		const total = count ?? 0

		return NextResponse.json({
			data: rows.map(row => ({ ...row, users: row.user_id ? byUser.get(row.user_id) ?? null : null })),
			pagination: {
				page,
				limit,
				total,
				total_pages: Math.max(1, Math.ceil(total / limit)),
			},
		})
	} catch (error) {
		console.error('Unexpected error reading the activity log:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
