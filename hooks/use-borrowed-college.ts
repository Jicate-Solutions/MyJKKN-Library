'use client'

/**
 * Whether the college on screen is one this person was only lent to.
 *
 * Engineering's librarian may be asked to count Pharmacy's shelves for a week.
 * They do not stop being Engineering's librarian: at Engineering they open
 * everything their role has always opened. At Pharmacy they open the Stock
 * Check page and nothing else.
 *
 * So the limit is not a property of the person — it is a property of the
 * college they are currently looking at, which is why it cannot live in
 * `useLibraryRole` beside `limitedToPages`. That one answers "is this person a
 * helper and nothing more"; this one answers "are they standing in somebody
 * else's library".
 *
 * The menu, the page guard and the Stock Check screen all read this, so the
 * three of them cannot disagree. None of it is what actually holds the line:
 * the API refuses the same requests whatever the browser believes, in
 * `outsideTheirHelperCollege`.
 */

import { useLibraryRole } from '@/hooks/use-library-role'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'

/** The one page a borrowed college opens. */
export const STOCK_CHECK_PAGES = ['/registry/stock-check']

export function useBorrowedCollege(): boolean {
	const { stockCheckInstitutionIds } = useLibraryRole()
	const { institutionId } = useInstitutionFilter()

	if (!institutionId) return false
	return stockCheckInstitutionIds.includes(institutionId)
}
