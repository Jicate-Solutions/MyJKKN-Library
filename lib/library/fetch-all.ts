/**
 * Reading a whole table when the database will only hand over part of it.
 *
 * Supabase caps a single request at 1,000 rows. Asking for `.range(0, 9999)`
 * does not lift the cap — it is silently trimmed, and the reply looks exactly
 * like a complete one. A college with 1,935 books therefore saw 1,000, its
 * title count computed from that thousand, and copy numbers reading "copy 5 of
 * 4" because the other copies were never in hand to be counted.
 *
 * So the caller hands over a way to build the query for a given slice, and this
 * walks the slices until a short page says there is no more. The cap stays; the
 * data stops being cut off by it.
 *
 * Usage — note the query is *built inside* the callback, because a Supabase
 * query can only be ranged and run once:
 *
 *   const { data, error } = await fetchAllRows(range =>
 *     supabase.from('lib_items').select('*').eq('institution_id', id).order('accession_number').range(range.from, range.to)
 *   )
 */

/** What one request may return. Set by the database, not by us. */
const PAGE_SIZE = 1000

/**
 * A safety stop, so a query that somehow never returns a short page cannot loop
 * forever. Far above any single college's shelf.
 */
const MAX_PAGES = 200

export interface RowRange {
	from: number
	to: number
}

interface PageResult<T> {
	data: T[] | null
	error: unknown
}

export async function fetchAllRows<T>(
	page: (range: RowRange) => PromiseLike<PageResult<T>>
): Promise<{ data: T[]; error: unknown }> {
	const rows: T[] = []

	for (let index = 0; index < MAX_PAGES; index++) {
		const from = index * PAGE_SIZE
		const { data, error } = await page({ from, to: from + PAGE_SIZE - 1 })

		if (error) return { data: rows, error }

		const batch = data ?? []
		rows.push(...batch)

		// A page that came back short is the last one. An exactly-full page might
		// be the last too, in which case the next request simply returns nothing.
		if (batch.length < PAGE_SIZE) break
	}

	return { data: rows, error: null }
}
