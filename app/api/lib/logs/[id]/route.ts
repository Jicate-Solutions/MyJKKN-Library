/**
 * One line of the activity log, in full: GET /api/lib/logs/[id]
 *
 * The console's list deliberately leaves out the three JSON columns — the
 * record before, the record after, and the extra detail — because they can each
 * be arbitrarily large and no page of the table shows them. They are read here
 * instead, for the single line whose detail sheet was opened.
 *
 * The same rule as the list: admin only, and only a line from their own library
 * unless they run all seven. A line belonging to another college answers 404
 * rather than 403, so an id cannot be used to find out which colleges hold what.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, hasAtLeast, resolveInstitutionScope } from '@/lib/auth/server-access'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
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

		const { id } = await params
		const supabase = getSupabaseServer()

		const { data: row, error: readError } = await supabase
			.from('lib_activity_log')
			.select('id, institution_id, old_values, new_values, metadata, user_agent')
			.eq('id', id)
			.maybeSingle()

		if (readError) {
			console.error('Error reading an activity log line:', readError)
			return NextResponse.json({ error: 'Could not read that line' }, { status: 500 })
		}

		if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

		// A college's admin reads their own library; a super admin — and the
		// admin who oversees every college — reads any of them. The list is
		// filtered the same way, so this only refuses an id typed by hand.
		const scope = resolveInstitutionScope(caller, row.institution_id)
		const readsEveryCollege = caller.isSuperAdmin || (caller.role === 'admin' && !caller.institutionId)
		if (scope.error || (!readsEveryCollege && row.institution_id !== caller.institutionId)) {
			return NextResponse.json({ error: 'Not found' }, { status: 404 })
		}

		return NextResponse.json(row)
	} catch (error) {
		console.error('Unexpected error reading an activity log line:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
