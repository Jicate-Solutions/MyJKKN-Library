/**
 * One stock check round: GET /api/lib/stock/sessions/<id>
 *
 *   ?view=progress   (default)  the counts, and the last scans
 *   ?view=pending&page=0        the copies this round has not seen yet
 *   ?view=pending&all=1         …all of them in one answer
 *   ?view=scans                 every copy this round has seen, newest first
 *   ?view=mine                  the scans of whoever is asking, newest first
 *   ?view=index                 every copy, compact, for the phone to answer scans instantly
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

/**
 * Answers shared between the phones of one round, for a few seconds.
 *
 * A stock check day puts a hundred and more phones on one round. The college's
 * copy count does not move while it runs, and the two whole lists are a dozen
 * reads of a thousand rows each — fifty people opening Still to find in the
 * same minute must not each send the database those dozen reads. Requests that
 * arrive while one read is under way wait for it rather than starting their own.
 */
const shared = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>()

function sharedRead<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
	const now = Date.now()
	const held = shared.get(key)
	if (held && now - held.at < held.ttl) return held.value as Promise<T>

	if (shared.size > 200) {
		for (const [k, entry] of shared) if (now - entry.at >= entry.ttl) shared.delete(k)
	}
	// A failed read is not kept, so the next request tries again
	const value = read().catch(error => {
		shared.delete(key)
		throw error
	})
	shared.set(key, { at: now, ttl: ttlMs, value })
	return value
}

/** How long each answer is shared. The total cannot change mid-round. */
const TOTAL_MS = 60_000
const PENDING_MS = 15_000
const SCANS_MS = 10_000
const INDEX_MS = 30_000

/** A read's error, carried out of `sharedRead` with its Postgres code intact. */
function throwIfFailed(error: unknown) {
	if (error) throw error
}

const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? ''

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
			try {
				const data = await sharedRead(`pending:${id}`, PENDING_MS, async () => {
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
					throwIfFailed(error)
					return data
				})
				return NextResponse.json({ data, total: data.length })
			} catch (error) {
				if (needsMigration(codeOf(error))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
		}

		// Every copy of the college, as small as it can be sent, for the phone to
		// answer a scan the moment the camera reads it: counted, already counted,
		// or not in this library. The server still has the last word on each
		// scan; this is only what lets the person hear it without waiting.
		// [accession number, barcode, title, seen in this round (1/0)]
		if (view === 'index') {
			try {
				const items = await sharedRead(`index:${id}`, INDEX_MS, async () => {
					const { data, error } = await fetchAllRows(range =>
						supabase
							.from('lib_items')
							.select('accession_number, barcode, stock_session_id, catalogue:lib_catalogue_records(title)')
							.match(stockFilter(institutionId))
							.order('id')
							.range(range.from, range.to)
					)
					throwIfFailed(error)
					return data
						.filter(row => row.accession_number)
						.map(row => {
							// A one-to-one join, which Supabase may hand back as a list
							const catalogue = Array.isArray(row.catalogue) ? row.catalogue[0] : row.catalogue
							return [
								row.accession_number,
								row.barcode || null,
								(catalogue as { title?: string | null } | null)?.title ?? null,
								row.stock_session_id === id ? 1 : 0,
							]
						})
				})
				return NextResponse.json({ items })
			} catch (error) {
				if (needsMigration(codeOf(error))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
		}

		// What the person asking has counted in this round.
		//
		// Everyone's tab answers "what has the round seen"; this answers "how far
		// have I got", which is the question somebody halfway down a shelf
		// actually has. It is read back from the round rather than kept on the
		// phone, so a reload, a flat battery or carrying on from another phone
		// does not take somebody's afternoon off the screen — and because the
		// filter is who scanned it, two people sharing one phone each see only
		// their own.
		if (view === 'mine') {
			const me = guard.caller.userId
			if (!me) return NextResponse.json({ data: [], total: 0 })
			try {
				const data = await sharedRead(`mine:${id}:${me}`, SCANS_MS, async () => {
					const { data, error } = await fetchAllRows(range =>
						supabase
							.from('lib_stock_scans')
							.select('id, accession_number, outcome, title, item_status, scanned_by_name, scanned_at')
							.eq('session_id', id)
							.eq('scanned_by', me)
							// Every outcome, the same as Everyone's: a number that is not a copy
							// here is kept for the library to look into, and the person who read
							// it is the one who can say what was on that shelf.
							.order('scanned_at', { ascending: false })
							.order('id')
							.range(range.from, range.to)
					)
					throwIfFailed(error)
					return data
				})
				return NextResponse.json({ data, total: data.length })
			} catch (error) {
				if (needsMigration(codeOf(error))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
		}

		if (view === 'scans') {
			try {
				const data = await sharedRead(`scans:${id}`, SCANS_MS, async () => {
					const { data, error } = await fetchAllRows(range =>
						supabase
							.from('lib_stock_scans')
							.select('id, accession_number, outcome, title, item_status, scanned_by_name, scanned_at')
							.eq('session_id', id)
							.order('scanned_at', { ascending: false })
							.order('id')
							.range(range.from, range.to)
					)
					throwIfFailed(error)
					return data
				})
				return NextResponse.json({ data, total: data.length })
			} catch (error) {
				if (needsMigration(codeOf(error))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
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
		// The latest scans only when the screen shows them (Everyone's tab)
		const wantRecent = searchParams.get('recent') === '1'

		let reads
		try {
			reads = await Promise.all([
				// Every copy the college holds: the same all round, so read once a
				// minute and shared, rather than counted on every phone's refresh
				sharedRead(`total:${institutionId}`, TOTAL_MS, async () => {
					const { count, error } = await supabase
						.from('lib_items')
						.select('id', { count: 'exact', head: true })
						.match(stockFilter(institutionId))
					throwIfFailed(error)
					return count ?? 0
				}),
				supabase
					.from('lib_items')
					.select('id', { count: 'exact', head: true })
					.match(stockFilter(institutionId))
					.eq('stock_session_id', id),
				wantRecent
					? supabase
						.from('lib_stock_scans')
						.select('id, accession_number, outcome, title, item_status, scanned_by_name, scanned_at')
						.eq('session_id', id)
						.order('scanned_at', { ascending: false })
						.limit(RECENT_SCANS)
					: Promise.resolve({ data: null, error: null }),
				// Numbers scanned that are not copies here: books on the shelf the
				// catalogue does not know, kept for the library to look into
				supabase
					.from('lib_stock_scans')
					.select('id', { count: 'exact', head: true })
					.eq('session_id', id)
					.eq('outcome', 'unknown'),
			])
		} catch (error) {
			if (needsMigration(codeOf(error))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			throw error
		}
		const [totalCount, checked, recent, unknown] = reads

		const failed = checked.error ?? recent.error ?? unknown.error
		if (failed) {
			if (needsMigration(codeOf(failed))) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			throw failed
		}

		const checkedCount = checked.count ?? 0

		return NextResponse.json({
			session,
			progress: {
				total: totalCount,
				checked: checkedCount,
				pending: Math.max(0, totalCount - checkedCount),
				unknown: unknown.count ?? 0,
			},
			...(wantRecent ? { recent: recent.data ?? [] } : {}),
		})
	} catch (error) {
		console.error('A stock check could not be read:', error)
		return NextResponse.json({ error: 'Could not load the stock check' }, { status: 500 })
	}
}
