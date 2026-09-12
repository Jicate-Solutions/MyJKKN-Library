/**
 * What an assistant librarian may change, and what only a librarian may.
 *
 * Both roles come from MyJKKN and both open the library. The line between
 * them is drawn here, once, and read from both sides: the API guard refuses
 * the write, and the screens hide the button that would have made it — so
 * nobody taps something the server is going to turn down.
 *
 * The assistant runs the day at the counter and the door: issuing, returning
 * and renewing, gate entry, holds, the OPAC, and every list read-only. The
 * librarian alone changes what the library owns and owes: the catalogue and
 * its bulk uploads, fines collected or let off, purchases, retirement,
 * conservation, inter-campus loans, periodicals and digital resources,
 * reminders sent, and the department libraries.
 *
 * No server imports, so the client hook can read the same list.
 */

import { rankAtLeast, type LibraryRole } from './library-roles'

/** API prefixes where anything but a read needs a librarian or above. */
const LIBRARIAN_WRITE_PREFIXES = [
	'/api/lib/catalogue',
	'/api/lib/items',
	'/api/lib/charges',
	'/api/lib/procurement',
	'/api/lib/retirement',
	'/api/lib/conservation',
	'/api/lib/intercampus',
	'/api/lib/periodicals',
	'/api/lib/digital',
	'/api/lib/notifications',
	'/api/lib/departments',
	'/api/lib/members/bulk',
]

/**
 * Reads that happen to travel as POST, because their input is too long for a
 * URL. They change nothing, so an assistant may make them.
 */
const READ_BY_POST = [
	'/api/lib/charges/calculate',
	'/api/lib/members/profiles',
]

const under = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(prefix + '/')

/** True when this request is a change only a librarian may make. */
export function isLibrarianWrite(method: string, pathname: string): boolean {
	if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') return false
	if (READ_BY_POST.some(prefix => under(pathname, prefix))) return false
	return LIBRARIAN_WRITE_PREFIXES.some(prefix => under(pathname, prefix))
}

/** True when this role may make the changes listed above. */
export function canLibrarianWrite(role: LibraryRole | null | undefined): boolean {
	return !!role && rankAtLeast(role, 'librarian')
}

/** What the refused person is told. Names the role, so nobody wonders why. */
export const LIBRARIAN_ONLY_MESSAGE =
	'Only a librarian or above can make this change — an assistant librarian runs the desk and the gate'
