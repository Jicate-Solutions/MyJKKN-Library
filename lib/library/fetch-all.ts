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

/**
 * How many slices are asked for together once we know there is more than one.
 *
 * Waiting for each thousand before asking for the next made a register of five
 * thousand books five round trips deep — the librarian watched a spinner for
 * the sum of them. They do not depend on each other, so after the first slice
 * comes back full they are fetched side by side and stitched together in order.
 * The result is byte for byte what walking them one at a time produced.
 */
const PARALLEL_PAGES = 4

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
	const slice = (index: number) => {
		const from = index * PAGE_SIZE
		return page({ from, to: from + PAGE_SIZE - 1 })
	}

	// The first slice on its own. Most tables here fit inside one, and those
	// must not pay for slices nobody needed — so nothing else is asked for
	// until this one comes back full.
	const first = await slice(0)
	if (first.error) return { data: [], error: first.error }

	const rows: T[] = [...(first.data ?? [])]
	if (rows.length < PAGE_SIZE) return { data: rows, error: null }

	for (let index = 1; index < MAX_PAGES; index += PARALLEL_PAGES) {
		const wanted = Math.min(PARALLEL_PAGES, MAX_PAGES - index)
		const batch = await Promise.all(
			Array.from({ length: wanted }, (_, offset) => slice(index + offset))
		)

		let done = false
		for (const result of batch) {
			// Stop at the first failure, keeping the rows already in hand, exactly
			// as walking the slices one at a time did.
			if (result.error) return { data: rows, error: result.error }

			const slicedRows = result.data ?? []
			rows.push(...slicedRows)

			// A slice that came back short is the last one — the slices asked for
			// after it in this same batch are past the end, so they are dropped
			// rather than appended.
			if (slicedRows.length < PAGE_SIZE) {
				done = true
				break
			}
		}

		if (done) break
	}

	return { data: rows, error: null }
}
