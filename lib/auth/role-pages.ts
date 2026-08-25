/**
 * Which pages each role may open.
 *
 * MyJKKN says what somebody is — librarian, library admin — and that part is
 * not ours to change. What a role is allowed to *see inside this library* is
 * ours, and this is where that decision lives: a super admin ticks the pages a
 * role gets on the Role Management screen, and the choice is stored per role in
 * `lib_role_pages`.
 *
 * Deliberately a file of its own with no server imports, so the menu, the page
 * guard and the API all decide from the same list and cannot drift apart. The
 * sidebar keeps its own copy of the menu because it also carries icons; this
 * catalogue carries only what a permission needs — a title and a path.
 *
 * Two things are NOT decided here, on purpose:
 *
 *   * Whether somebody may open the library at all. That is `library-roles.ts`,
 *     and it is still MyJKKN's answer.
 *   * Which college's rows they see. That is `resolveInstitutionScope`, and a
 *     page being ticked never widens it.
 *
 * A page can also be locked — fixed on or fixed off for a role, with no tick to
 * change it. That is not decoration: the Activity Log's API refuses anyone
 * below library_admin on its own, so offering a librarian a tick that could not
 * work would be a lie. Locks keep this screen honest about what it can deliver.
 */

/** The roles a super admin can configure. Their own is not among them. */
export const MANAGEABLE_ROLES = ['library_admin', 'librarian', 'assistant_librarian'] as const

export type ManageableRole = (typeof MANAGEABLE_ROLES)[number]

export interface CataloguePage {
	title: string
	/** The path the menu links to, and the key the choice is stored under. */
	url: string
	/**
	 * Other paths that belong to this page. The Dashboard is linked as `/` but
	 * actually lives at `/dashboard`, so without this the guard would not know
	 * the two are the same page.
	 */
	matches?: string[]
}

export interface CatalogueGroup {
	label: string
	pages: CataloguePage[]
}

/**
 * Every page in the menu, in menu order.
 *
 * Kept in step with `navGroups` in `components/layout/lib-sidebar.tsx` by hand.
 * A page added there but forgotten here is not a lockout — an unknown path is
 * allowed rather than refused (see `canOpenPath`) — it simply cannot be
 * configured until it is listed.
 *
 * Staff Access is the one entry with no menu item behind it, on purpose. It was
 * taken out of the sidebar and is now reached by typing `/access`, but it stays
 * listed here because that is what holds its lock: drop it from the catalogue
 * and `canOpenPath` would find no page for the path, let anyone through the
 * guard, and leave the API as the only thing refusing them.
 */
export const PAGE_CATALOGUE: CatalogueGroup[] = [
	{
		label: 'Overview',
		pages: [
			{ title: 'Dashboard', url: '/', matches: ['/dashboard'] },
		],
	},
	{
		label: 'Knowledge Registry',
		pages: [
			{ title: 'Catalogue', url: '/registry' },
			{ title: 'Members', url: '/members' },
		],
	},
	{
		label: 'Circulation',
		pages: [
			{ title: 'Circulation Desk', url: '/circulation' },
			{ title: 'Gate Entry', url: '/visits' },
			{ title: 'Holds', url: '/circulation/holds' },
			{ title: 'Overdue', url: '/circulation/overdue' },
			{ title: 'Late Charges', url: '/circulation/charges' },
		],
	},
	{
		label: 'Acquisition',
		pages: [
			{ title: 'Purchase Requests', url: '/acquisition/requests' },
			{ title: 'Orders', url: '/acquisition/orders' },
			{ title: 'Suppliers', url: '/acquisition/suppliers' },
			{ title: 'Budget', url: '/acquisition/budget' },
		],
	},
	{
		label: 'Periodicals',
		pages: [
			{ title: 'Subscriptions', url: '/periodicals' },
			{ title: 'Digital Resources', url: '/digital' },
		],
	},
	{
		label: 'Other',
		pages: [
			{ title: 'Retirement', url: '/retirement' },
			{ title: 'Inter-Campus', url: '/intercampus' },
			{ title: 'Conservation', url: '/conservation' },
			{ title: 'OPAC Search', url: '/opac' },
		],
	},
	{
		label: 'Reports',
		pages: [
			{ title: 'Reports Dashboard', url: '/reports' },
			{ title: 'Library Rules', url: '/settings' },
			{ title: 'Shelf Locations', url: '/settings/locations' },
			{ title: 'Activity Log', url: '/activity-log' },
			{ title: 'Staff Access', url: '/access' },
			{ title: 'Role Management', url: '/roles' },
		],
	},
]

/** Every configurable path, flattened. */
export const ALL_PAGE_URLS: string[] = PAGE_CATALOGUE.flatMap(group => group.pages.map(p => p.url))

/** Pages that decide who may do what. A super admin's alone. */
const SUPER_ADMIN_ONLY = ['/access', '/roles']

/** Where everybody lands after signing in, so it can never be taken away. */
const ALWAYS_OPEN = ['/', '/dashboard']

export interface PageLock {
	state: 'on' | 'off'
	reason: string
}

/**
 * Is this page's answer fixed for this role?
 *
 * Returns null when the super admin may decide. Otherwise the answer, and why —
 * the screen shows the reason rather than a tick that does nothing.
 */
export function lockFor(role: string | null | undefined, url: string): PageLock | null {
	if (ALWAYS_OPEN.includes(url)) {
		return { state: 'on', reason: 'Where everyone lands after signing in' }
	}

	if (SUPER_ADMIN_ONLY.includes(url)) {
		return { state: 'off', reason: 'Super admin only' }
	}

	// The activity log carries names, borrowing history and whole records, and
	// its own API refuses anyone below library_admin. A tick here could not
	// change that, so it is not offered.
	if (url === '/activity-log') {
		return role === 'library_admin'
			? { state: 'on', reason: 'Always open to a library admin' }
			: { state: 'off', reason: 'Library admin and above only' }
	}

	return null
}

/** True when this is a role the Role Management screen can configure. */
export function isManageableRole(value: unknown): value is ManageableRole {
	return (MANAGEABLE_ROLES as readonly string[]).includes(String(value))
}

/**
 * What a role gets when nobody has configured it.
 *
 * Everything it can see today — so the very first person to open Role
 * Management finds the system exactly as it already behaves, and nothing
 * changes until they change it.
 */
export function defaultPagesFor(role: string | null | undefined): string[] {
	return ALL_PAGE_URLS.filter(url => lockFor(role, url)?.state !== 'off')
}

/**
 * Applies the locks to a stored choice.
 *
 * A stored list is never trusted as-is: a page locked on is put back, a page
 * locked off is stripped, and anything not in the catalogue is dropped. So a
 * row edited straight in the database cannot hand out a page the code refuses
 * to give.
 */
export function settledPagesFor(role: string | null | undefined, stored: string[] | null): string[] {
	const chosen = new Set(stored ?? defaultPagesFor(role))

	for (const url of ALL_PAGE_URLS) {
		const lock = lockFor(role, url)
		if (lock?.state === 'on') chosen.add(url)
		if (lock?.state === 'off') chosen.delete(url)
	}

	return ALL_PAGE_URLS.filter(url => chosen.has(url))
}

/** True when `pathname` is `prefix` or sits underneath it. */
function isUnder(pathname: string, prefix: string): boolean {
	// '/' is the prefix of everything, so it only ever matches itself
	if (prefix === '/') return pathname === '/'
	return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * Which catalogue page a path belongs to.
 *
 * The longest match wins, so `/circulation/holds` is Holds and not the
 * Circulation Desk that sits above it, and `/registry/123` is the Catalogue.
 */
export function pageForPath(pathname: string): CataloguePage | null {
	let best: { page: CataloguePage; length: number } | null = null

	for (const group of PAGE_CATALOGUE) {
		for (const page of group.pages) {
			for (const candidate of [page.url, ...(page.matches ?? [])]) {
				if (isUnder(pathname, candidate) && (!best || candidate.length > best.length)) {
					best = { page, length: candidate.length }
				}
			}
		}
	}

	return best?.page ?? null
}

/**
 * May this role open this path?
 *
 * `allowedPages` is what the server settled on for them — null means a super
 * admin, who is never restricted. A path outside the catalogue is allowed: a
 * page added to the application but not yet listed here should appear as it
 * always did, not disappear.
 */
export function canOpenPath(
	role: string | null | undefined,
	pathname: string,
	allowedPages: string[] | null
): boolean {
	if (role === 'super_admin') return true

	const page = pageForPath(pathname)
	if (!page) return true

	const lock = lockFor(role, page.url)
	if (lock) return lock.state === 'on'

	// Still being worked out — show the menu as it was rather than blank it
	if (!allowedPages) return defaultPagesFor(role).includes(page.url)

	return allowedPages.includes(page.url)
}
