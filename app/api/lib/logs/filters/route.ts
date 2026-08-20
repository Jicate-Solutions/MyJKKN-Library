/**
 * What the console's dropdowns offer: GET /api/lib/logs/filters
 *
 * Built from the log itself rather than from a hard-coded list, so a kind of
 * action added next year is filterable the day it first appears.
 *
 * Read from a wide recent window rather than a page of results: filling the
 * dropdown from the newest fifty rows would hide every action that happened to
 * be quiet this morning.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, hasAtLeast, resolveInstitutionScope } from '@/lib/auth/server-access'

/** Deep enough to have seen every kind of action; shallow enough to stay quick. */
const SCAN_ROWS = 20000

export async function GET(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) {
			return NextResponse.json({ error: error ?? 'Not signed in' }, { status: status ?? 401 })
		}
		if (!hasAtLeast(caller, 'admin')) {
			return NextResponse.json({ error: 'Only an admin can read the activity log' }, { status: 403 })
		}

		const { searchParams } = new URL(request.url)
		const scope = resolveInstitutionScope(caller, searchParams.get('institution_id'))
		if (scope.error) {
			return NextResponse.json({ error: scope.error }, { status: scope.status ?? 403 })
		}

		const supabase = getSupabaseServer()
		let query = supabase
			.from('lib_activity_log')
			.select('action, resource_type')
			.order('created_at', { ascending: false })

		if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)

		const { data, error: readError } = await query.range(0, SCAN_ROWS - 1)
		if (readError) {
			// Nothing to offer yet is a perfectly good answer
			return NextResponse.json({ actions: [], resource_types: [] })
		}

		const actions = new Set<string>()
		const resources = new Set<string>()
		for (const row of data ?? []) {
			if (row.action) actions.add(row.action)
			if (row.resource_type) resources.add(row.resource_type)
		}

		return NextResponse.json({
			actions: [...actions].sort(),
			resource_types: [...resources].sort(),
		})
	} catch (error) {
		console.error('Unexpected error reading activity filters:', error)
		return NextResponse.json({ actions: [], resource_types: [] })
	}
}
