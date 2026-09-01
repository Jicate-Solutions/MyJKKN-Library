/**
 * Writing a catalogue title, on a database that may not have caught up yet.
 *
 * `periodical_scope` — National or International — arrives with a migration.
 * Seven of this project's migrations have sat unapplied for weeks at a time, so
 * the code must not assume this one has been run: an insert naming a column the
 * database does not have is refused outright, and refusing it here would stop
 * every book being catalogued, not just magazines. A librarian who cannot enter
 * a book all morning is a far worse outcome than one journal missing its
 * National/International mark.
 *
 * So the write is tried as written, and only if the database says "no such
 * column" is it tried again without it. Once the migration is run the retry
 * never fires, and this file can be deleted along with its two callers' use of
 * it. It is a bridge, and it is meant to be temporary.
 *
 * `42703` is Postgres for undefined_column. Nothing else is caught: a real
 * error still reaches the caller unchanged.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'

type Supabase = ReturnType<typeof getSupabaseServer>

/** Columns added by a migration that may not have been run yet. */
const PENDING_COLUMNS = ['periodical_scope']

let warned = false

function missingColumn(error: { code?: string; message?: string } | null): string | null {
	if (!error || error.code !== '42703') return null
	const message = error.message ?? ''
	return PENDING_COLUMNS.find(column => message.includes(column)) ?? null
}

/**
 * Inserts one catalogue title and returns its id.
 *
 * Same shape as calling Supabase directly, so the caller reads as it did
 * before — the retry is invisible unless it happens, and then it is logged once.
 */
export async function insertCatalogueRecord(
	supabase: Supabase,
	values: Record<string, unknown>
): Promise<{ id: string | null; error: { code?: string; message?: string } | null }> {
	const write = (row: Record<string, unknown>) =>
		supabase.from('lib_catalogue_records').insert(row).select('id').single()

	const first = await write(values)
	if (!first.error) return { id: (first.data as { id: string }).id, error: null }

	const column = missingColumn(first.error)
	if (!column) return { id: null, error: first.error }

	if (!warned) {
		warned = true
		console.warn(
			`[catalogue] This library's database has no ${column} column yet — run the pending database update. ` +
			'Titles are being saved without it.'
		)
	}

	const { [column]: _dropped, ...rest } = values
	const second = await write(rest)

	return second.error
		? { id: null, error: second.error }
		: { id: (second.data as { id: string }).id, error: null }
}
