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

/**
 * How long one campus's dropdown contents are reused.
 *
 * Filling these two lists means scanning up to twenty thousand rows, and it ran
 * on every visit to the page and every switch of college — for a pair of lists
 * that gains an entry perhaps twice a year, when a new kind of action is first
 * written. Ten minutes keeps the scan rare while still picking up a new action
 * the same session it appears.
 *
 * Kept per institution, like every other cache here: one college's list is
 * never handed to another. The key for "all seven" is separate again.
 */
const FILTERS_TTL_MS = 10 * 60 * 1000

interface FilterOptions {
	actions: string[]
	resource_types: string[]
}

const filtersCache = new Map<string, { options: FilterOptions; expiresAt: number }>()

export async function GET(request: Request) {
	try {
		const { caller, error, status } = await getCaller(request)
		if (!caller) {
			return NextResponse.json({ error: error ?? 'Not signed in' }, { status: status ?? 401 })
		}
		if (!hasAtLeast(caller, 'library_admin')) {
			return NextResponse.json({ error: 'Only an admin can read the activity log' }, { status: 403 })
		}

		const { searchParams } = new URL(request.url)
		const scope = resolveInstitutionScope(caller, searchParams.get('institution_id'))
		if (scope.error) {
			return NextResponse.json({ error: scope.error }, { status: scope.status ?? 403 })
		}

		const cacheKey = scope.institutionId ?? 'all'
		const cached = filtersCache.get(cacheKey)
		if (cached && cached.expiresAt > Date.now()) {
			return NextResponse.json(cached.options)
		}

		const supabase = getSupabaseServer()
		let query = supabase
			.from('lib_activity_log')
			.select('action, resource_type')
			.order('created_at', { ascending: false })

		if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)

		const { data, error: readError } = await query.range(0, SCAN_ROWS - 1)
		if (readError) {
			// Nothing to offer yet is a perfectly good answer — and it is not
			// remembered, so the dropdowns fill as soon as the log does
			return NextResponse.json({ actions: [], resource_types: [] })
		}

		const actions = new Set<string>()
		const resources = new Set<string>()
		for (const row of data ?? []) {
			if (row.action) actions.add(row.action)
			if (row.resource_type) resources.add(row.resource_type)
		}

		const options: FilterOptions = {
			actions: [...actions].sort(),
			resource_types: [...resources].sort(),
		}

		filtersCache.set(cacheKey, { options, expiresAt: Date.now() + FILTERS_TTL_MS })

		return NextResponse.json(options)
	} catch (error) {
		console.error('Unexpected error reading activity filters:', error)
		return NextResponse.json({ actions: [], resource_types: [] })
	}
}
