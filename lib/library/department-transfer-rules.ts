/**
 * Which copies can be moved between the main library and a department, and the
 * reason when one cannot.
 *
 * In a file of its own, imported by the API that refuses the move and by the
 * screen that greys out the checkbox, because those two must never disagree.
 * A screen that offers a book the server will refuse wastes somebody's trip to
 * the shelf; a screen that hides a book the server would have accepted makes
 * the library look emptier than it is.
 *
 * Every copy is LISTED whatever its status — a librarian looking for accession
 * 101 needs to see that it exists and that it is out, not an empty result that
 * reads as "no such book". Only the tick is withheld.
 *
 * Deliberately no server imports, so both sides can read it.
 */

/**
 * Statuses that stop a copy being moved, and what to say about each.
 *
 * The wording is what appears on the row, so it is written for the person at
 * the desk rather than as a status code.
 */
export const CANNOT_MOVE: Record<string, string> = {
	on_loan: 'Out with a member',
	retired: 'Retired from the collection',
	lost: 'Recorded as lost',
	in_conservation: 'Away for repair',
}

/**
 * Why this copy cannot be moved, or null when it can.
 *
 * A status nobody has listed here is allowed through — the same way the rest of
 * this project treats an unknown value as ordinary rather than suspect.
 */
export function blockedReason(status: string | null | undefined): string | null {
	if (!status) return null
	return CANNOT_MOVE[status] ?? null
}

/** True when this copy is free to go. */
export function canMove(status: string | null | undefined): boolean {
	return blockedReason(status) === null
}
