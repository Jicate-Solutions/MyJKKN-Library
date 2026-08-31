/**
 * The next number in a college's magazine and journal series: JM1, JM2, JM3…
 *
 * A book is accessioned with the number written inside it, so the librarian
 * types it. A magazine is not — nobody writes an accession number on the cover
 * of an issue — so the register allots one here instead of asking for something
 * that does not exist.
 *
 * The series is deliberately separate from the book series. A college holding
 * 12,000 books would otherwise see the next magazine take 12,001 and the next
 * real book 12,002, leaving periodicals scattered through the one register a
 * library is audited on. And it is per college, like every accession number:
 * `lib_items` is unique on (institution_id, accession_number), so each of the
 * seven libraries has its own JM1 and none can collide with another's.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'
import { fetchAllRows } from './fetch-all'
import { PERIODICAL_ACCESSION_PREFIX } from './catalogue-options'

type Supabase = ReturnType<typeof getSupabaseServer>

/** JM7 counts. JM7A, JM-7 and a book's plain 7 do not. */
const NUMBERED = new RegExp(`^${PERIODICAL_ACCESSION_PREFIX}(\\d+)$`, 'i')

/**
 * The highest JM number this college has used, plus one.
 *
 * Every JM row is read rather than just the last one, because the column is
 * text: ordering it puts JM9 after JM10, so "the last row" is the wrong row as
 * soon as the college passes nine issues. Reading them all and taking the
 * largest number is the only answer that stays right, and it is one short
 * column — a college with a thousand periodicals sends about ten kilobytes.
 *
 * Returns null when the read itself failed, so the caller can say so rather
 * than allotting JM1 to a library that already holds forty.
 */
export async function nextPeriodicalAccession(
	supabase: Supabase,
	institutionId: string
): Promise<string | null> {
	const { data, error } = await fetchAllRows<{ accession_number: string | null }>(range =>
		supabase
			.from('lib_items')
			.select('accession_number')
			.eq('institution_id', institutionId)
			.ilike('accession_number', `${PERIODICAL_ACCESSION_PREFIX}%`)
			.range(range.from, range.to)
	)

	if (error) {
		console.error('Could not read the magazine accession series:', error)
		return null
	}

	let highest = 0
	for (const row of data) {
		const match = NUMBERED.exec((row.accession_number ?? '').trim())
		if (!match) continue
		const used = Number(match[1])
		if (Number.isFinite(used) && used > highest) highest = used
	}

	return `${PERIODICAL_ACCESSION_PREFIX}${highest + 1}`
}
