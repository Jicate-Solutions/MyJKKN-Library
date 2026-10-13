/**
 * The few things every Stock Check route agrees on.
 *
 * Kept out of the routes themselves so the scan, the progress counts and the
 * pending list cannot drift apart on the one thing that matters most: what
 * "the stock" is. If a scan counted a copy the pending list never looks at, a
 * round would finish at 101% and nobody could say which number was wrong.
 */

export const MIGRATION_MESSAGE =
	'The database has not been updated for Stock Check yet — please run migration 20261012_lib_stock_check.sql'

/** The columns the screen reads for a round. */
export const SESSION_COLUMNS =
	'id, institution_id, name, status, started_by_name, started_at, closed_at, closed_by_name'

/**
 * True when the tables or columns this page needs are not there yet.
 *
 * Migrations here are run by hand and can sit for weeks, so every route says
 * which file to run rather than answering 500 and leaving somebody guessing.
 */
export function needsMigration(code: string | undefined | null): boolean {
	return code === '42P01' || code === '42703' || code === 'PGRST205'
}

/** How many numbers one request may carry. A pasted shelf is well inside it. */
export const MAX_NUMBERS = 200

/** Accession numbers as scanned, typed or pasted — any separator, each once. */
export function numbersFrom(input: unknown): string[] {
	const text = Array.isArray(input) ? input.map(String).join('\n') : String(input ?? '')
	return [...new Set(text.split(/[\s,;]+/).map(n => n.trim()).filter(Boolean))].slice(0, MAX_NUMBERS)
}

/**
 * What a stock check counts: every copy this college holds.
 *
 * Passed to `.match()` by every query that touches the stock — the scan, the
 * two counts and the pending list — so all four are asking about the same
 * shelves. `is_active` is the only thing held back: a row switched off is not
 * stock anybody can be asked to find. A copy that is on loan, on hold or
 * already marked missing stays in, because whether it is on the shelf after all
 * is exactly the question being asked.
 *
 * lib_items.status is never read here and never written by a stock check. The
 * desk and the OPAC go on seeing what they always saw.
 */
export function stockFilter(institutionId: string): { institution_id: string; is_active: boolean } {
	return { institution_id: institutionId, is_active: true }
}
