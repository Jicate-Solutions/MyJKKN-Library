/**
 * The four numbers above the activity console: GET /api/lib/logs/stats
 *
 * "Today" is the library's today, not the server's. Counted from midnight in
 * Asia/Kolkata — a UTC boundary would start the day at 5:30 in the morning and
 * file every early scan under yesterday.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, hasAtLeast, resolveInstitutionScope } from '@/lib/auth/server-access'
import { istToday } from '@/lib/library/ist-clock'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** Midnight in the library, as an instant the database can compare against. */
function startOfLibraryDay(): string {
	// IST is a fixed +05:30, so the day's first moment is simply that offset
	return `${istToday()}T00:00:00+05:30`
}

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

		const supabase = getSupabaseServer()
		const since = startOfLibraryDay()

		const scoped = <T>(query: T): T => {
			if (!scope.institutionId) return query
			return (query as any).eq('institution_id', scope.institutionId)
		}

		// The three counts are counts — the database returns the figure, not the
		// rows. The fourth genuinely needs the rows, because "how many different
		// people" cannot be counted without seeing who they were, and a busy day
		// writes far more than the thousand lines a single request returns: read
		// in one go it counted the newest thousand lines' people and called that
		// the day's total.
		const [total, success, errors, people] = await Promise.all([
			scoped(supabase.from('lib_activity_log').select('*', { count: 'exact', head: true }).gte('created_at', since)),
			scoped(supabase.from('lib_activity_log').select('*', { count: 'exact', head: true }).gte('created_at', since).eq('status', 'success')),
			scoped(supabase.from('lib_activity_log').select('*', { count: 'exact', head: true }).gte('created_at', since).eq('status', 'error')),
			fetchAllRows<{ user_id: string }>(range =>
				scoped(
					supabase
						.from('lib_activity_log')
						.select('user_id')
						.gte('created_at', since)
						.not('user_id', 'is', null)
						.order('created_at', { ascending: false })
				).range(range.from, range.to)
			),
		])

		// A table that is not there yet reads as a quiet day rather than an error
		// on screen — the console still opens and says so in its empty state
		const todayTotal = total.count ?? 0
		const successCount = success.count ?? 0

		return NextResponse.json({
			today_total: todayTotal,
			// A day with nothing in it has not gone wrong: nothing failed
			success_rate: todayTotal === 0 ? 100 : Math.round((successCount / todayTotal) * 1000) / 10,
			today_errors: errors.count ?? 0,
			unique_users_today: new Set(people.data.map(r => r.user_id)).size,
		})
	} catch (error) {
		console.error('Unexpected error reading activity stats:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
