/**
 * One stock check round: GET /api/lib/stock/sessions/<id>
 *
 *   ?view=progress   (default)  the counts, and the last scans
 *   ?view=pending&page=0        the copies this round has not seen yet
 *   ?view=pending&all=1         …all of them in one answer
 *   ?view=scans                 every copy this round has seen, newest first
 *   ?view=unknown               numbers scanned that are not copies here
 *
 * The counts are the thing this route exists for, and they are asked for the
 * cheap way: two indexed counts over lib_items — how many copies this college
 * has, and how many carry this round's id — rather than a difference worked out
 * against a list of every scan. Five people are refreshing this while they
 * scan, so it has to cost almost nothing.
 *
 * `is_active` aside, nothing is filtered out of the stock — see stockScope.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardRecordRow } from '@/lib/auth/api-guard'
import { MIGRATION_MESSAGE, SESSION_COLUMNS, needsMigration, stockFilter } from '@/lib/library/stock-check'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** The live list under the scan box. Long enough to see, short enough to be free. */
const RECENT_SCANS = 40

/** The pending list is read a page at a time — a college can have 26,000 copies. */
const PAGE_SIZE = 200

interface SessionRow {
	id: string
	institution_id: string | null
	name: string
	status: string
	started_by_name: string | null
	started_at: string
	closed_at: string | null
	closed_by_name: string | null
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const { searchParams } = new URL(request.url)
		const view = searchParams.get('view') ?? 'progress'

		// Another college's round answers 404, and the guard hands back the row it
		// had to read anyway, so the round costs one query rather than two.
		const guard = await guardRecordRow<SessionRow>(request, 'lib_stock_sessions', id, SESSION_COLUMNS)
		if (!guard.ok) return guard.response

		const session = guard.row
		const institutionId = session.institution_id
		if (!institutionId) {
			return NextResponse.json({ error: 'This stock check has no college' }, { status: 400 })
		}

		const supabase = getSupabaseServer()

		// The whole list in one answer — for the screen's sort, filter and "All",
		// and for the Excel report, which must be the round and not a page of it.
		// Read in slices, because a single request stops at 1,000 rows.
		if (view === 'pending' && searchParams.get('all') === '1') {
			const { data, error } = await fetchAllRows(range =>
				supabase
					.from('lib_items')
					.select('id, accession_number, status, catalogue:lib_catalogue_records(id, title, author)')
					.match(stockFilter(institutionId))
					.or(`stock_session_id.is.null,stock_session_id.neq.${id}`)
					.order('accession_number')
					.order('id')
					.range(range.from, range.to)
			)
			if (error) {
				const code = (error as { code?: string }).code ?? ''
				if (needsMigration(code)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
			return NextResponse.json({ data, total: data.length })
		}

		if (view === 'scans') {
			const { data, error } = await fetchAllRows(range =>
				supabase
					.from('lib_stock_scans')
					.select('id, accession_number, outcome, title, item_status, scanned_by_name, scanned_at')
					.eq('session_id', id)
					// Rows kept from before unknown numbers were skipped stay out of sight
					.eq('outcome', 'checked')
					.order('scanned_at', { ascending: false })
					.order('id')
					.range(range.from, range.to)
			)
			if (error) {
				const code = (error as { code?: string }).code ?? ''
				if (needsMigration(code)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
			return NextResponse.json({ data, total: data.length })
		}

		if (view === 'pending') {
			const page = Math.max(0, Number(searchParams.get('page') ?? 0) || 0)
			const from = page * PAGE_SIZE

			// Everything this round has not stamped — never seen, or last seen in an
			// earlier round. Ordered by accession number so two people reading the
			// list are looking at the same thing.
			const { data, error, count } = await supabase
				.from('lib_items')
				.select('id, accession_number, status, catalogue:lib_catalogue_records(id, title, author)', { count: 'exact' })
				.match(stockFilter(institutionId))
				.or(`stock_session_id.is.null,stock_session_id.neq.${id}`)
				.order('accession_number')
				.range(from, from + PAGE_SIZE - 1)

			if (error) {
				if (needsMigration(error.code)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}

			return NextResponse.json({
				data: data ?? [],
				page,
				page_size: PAGE_SIZE,
				total: count ?? 0,
				has_more: (count ?? 0) > from + (data?.length ?? 0),
			})
		}

		if (view === 'unknown') {
			const { data, error } = await supabase
				.from('lib_stock_scans')
				.select('id, accession_number, scanned_by_name, scanned_at')
				.eq('session_id', id)
				.eq('outcome', 'unknown')
				.order('scanned_at', { ascending: false })
				.range(0, 499)

			if (error) {
				if (needsMigration(error.code)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}

			return NextResponse.json({ data: data ?? [] })
		}

		// The default: the numbers everybody is watching, all asked for together
		// Unknown numbers are not counted: a scan that is not a copy here is
		// skipped at the shelf, and keeps nothing to count.
		const [total, checked, recent] = await Promise.all([
			supabase
				.from('lib_items')
				.select('id', { count: 'exact', head: true })
				.match(stockFilter(institutionId)),
			supabase
				.from('lib_items')
				.select('id', { count: 'exact', head: true })
				.match(stockFilter(institutionId))
				.eq('stock_session_id', id),
			supabase
				.from('lib_stock_scans')
				.select('id, accession_number, outcome, title, item_status, scanned_by_name, scanned_at')
				.eq('session_id', id)
				// Rows kept from before unknown numbers were skipped stay out of sight
				.eq('outcome', 'checked')
				.order('scanned_at', { ascending: false })
				.limit(RECENT_SCANS),
		])

		const failed = total.error ?? checked.error ?? recent.error
		if (failed) {
			if (needsMigration(failed.code)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			throw failed
		}

		const totalCount = total.count ?? 0
		const checkedCount = checked.count ?? 0

		return NextResponse.json({
			session,
			progress: {
				total: totalCount,
				checked: checkedCount,
				pending: Math.max(0, totalCount - checkedCount),
			},
			recent: recent.data ?? [],
		})
	} catch (error) {
		console.error('A stock check could not be read:', error)
		return NextResponse.json({ error: 'Could not load the stock check' }, { status: 500 })
	}
}
