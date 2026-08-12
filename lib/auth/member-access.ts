/**
 * What a `member` may reach.
 *
 * A member is a borrower, not staff: they may look at the Circulation screens
 * and search the public catalogue, and nothing else. This file holds the policy
 * on its own — no server imports — so the API guard and the sidebar both decide
 * from the same list and cannot drift apart.
 *
 * Read-only is enforced by method, not by route: every write verb is refused,
 * so a member can never issue, return, renew, cancel a hold or waive a charge
 * even on a page they are allowed to see.
 */

/** API path prefixes a member may GET. */
const MEMBER_READABLE_API: string[] = [
	'/api/lib/circulation',
	'/api/lib/charges',
	'/api/lib/catalogue',
	'/api/lib/items',
	// Only the barcode lookup — never the full member list
	'/api/lib/members/lookup',
	// Needed by the institution context on every page
	'/api/lib/institutions',
]

/** Pages a member may open. */
const MEMBER_VIEWABLE_PAGES: string[] = [
	'/circulation',
	'/opac',
]

/** Where a member lands when they aim at anything else. */
export const MEMBER_HOME = '/circulation'

/** True when `pathname` is `prefix` or sits underneath it. */
function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * May a member call this API route?
 *
 * Anything other than GET is refused outright — that is what keeps the
 * Circulation screens view-only for them.
 */
export function isMemberAllowedApi(pathname: string, method: string): boolean {
	if (method.toUpperCase() !== 'GET') return false
	return MEMBER_READABLE_API.some(prefix => isUnder(pathname, prefix))
}

/** May a member open this page? */
export function isMemberAllowedPage(pathname: string): boolean {
	return MEMBER_VIEWABLE_PAGES.some(prefix => isUnder(pathname, prefix))
}
