/**
 * Deciding whether a book being accessioned is a new title or another copy of
 * one already on the shelf.
 *
 * The librarian never types a copy count. They enter each physical book with
 * its own accession number, exactly as the register is written, and the system
 * works out that the fifth entry of the same book is copy 5. That way the count
 * can never disagree with the shelf — it *is* the shelf.
 *
 * Order of matching:
 *   1. ISBN, when the book has one. An ISBN names an edition, so two books
 *      sharing one are the same book by definition.
 *   2. ISSN, for magazines and journals, which carry that instead.
 *   3. Title + Author + Edition + Publisher + Year + Place, for everything with
 *      neither — old books, reprints, project reports.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'

type Supabase = ReturnType<typeof getSupabaseServer>

export interface TitleIdentity {
	title: string
	author?: string | null
	edition?: string | null
	publisher_name?: string | null
	publisher_place?: string | null
	publication_year?: number | null
	isbn?: string | null
	issn?: string | null
}

export interface TitleMatch {
	id: string
	title: string
	/** Shown to the librarian so they can see why two books were treated as one. */
	matchedBy: 'ISBN' | 'ISSN' | 'title and author'
}

/** "C.K.  Kokate " and "c.k. kokate" are the same person to a human, so also to us. */
function normalise(value: unknown): string {
	return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 978-93-85790-00-1 and 9789385790001 are the same number printed two ways. */
function digitsOnly(value: string): string {
	return value.replace(/[^0-9xX]/g, '').toLowerCase()
}

/**
 * Looks for a record already carrying this standard number.
 *
 * Both the typed form and the digits-only form are tried, which covers a
 * hyphenated number being matched against a plain one. A stored hyphenated
 * number searched for with plain digits still slips through — that case falls
 * to the six-field check below, which catches it anyway, since two copies of
 * one book agree on title and author whatever the punctuation.
 */
async function findByStandardNumber(
	supabase: Supabase,
	institutionId: string,
	column: 'isbn' | 'issn',
	value: string
): Promise<{ id: string; title: string } | null> {
	const typed = value.trim()
	const plain = digitsOnly(typed)
	if (!typed) return null

	const forms = plain && plain !== typed.toLowerCase() ? [typed, plain] : [typed]

	const { data } = await supabase
		.from('lib_catalogue_records')
		.select('id, title')
		.eq('institution_id', institutionId)
		.or(forms.map(f => `${column}.ilike.${f}`).join(','))
		.limit(1)

	return data?.[0] ?? null
}

export async function findExistingTitle(
	supabase: Supabase,
	institutionId: string,
	identity: TitleIdentity
): Promise<TitleMatch | null> {
	const isbn = (identity.isbn ?? '').toString().trim()
	if (isbn) {
		const hit = await findByStandardNumber(supabase, institutionId, 'isbn', isbn)
		if (hit) return { ...hit, matchedBy: 'ISBN' }
	}

	const issn = (identity.issn ?? '').toString().trim()
	if (issn) {
		const hit = await findByStandardNumber(supabase, institutionId, 'issn', issn)
		if (hit) return { ...hit, matchedBy: 'ISSN' }
	}

	// Candidates are pulled with the spaces in the title turned into wildcards,
	// because "Old  Pharmacopoeia" typed with a double space is the same book as
	// "Old Pharmacopoeia" and an exact match would miss it. The wildcard only
	// widens the net; the real comparison happens below, normalised, in code —
	// where the remaining five fields can be read the way a person reads them
	// rather than as exact strings.
	const titlePattern = identity.title
		.trim()
		.replace(/[%_\\]/g, m => `\\${m}`)
		.replace(/\s+/g, '%')

	const { data: sameTitle } = await supabase
		.from('lib_catalogue_records')
		.select('id, title, author, edition, publisher_name, publisher_place, publication_year')
		.eq('institution_id', institutionId)
		.ilike('title', titlePattern)
		.limit(50)

	const match = (sameTitle || []).find(record =>
		normalise(record.title) === normalise(identity.title) &&
		normalise(record.author) === normalise(identity.author) &&
		normalise(record.edition) === normalise(identity.edition) &&
		normalise(record.publisher_name) === normalise(identity.publisher_name) &&
		normalise(record.publisher_place) === normalise(identity.publisher_place) &&
		normalise(record.publication_year) === normalise(identity.publication_year)
	)

	return match ? { id: match.id, title: match.title, matchedBy: 'title and author' } : null
}

/**
 * The number this copy gets. Reads the highest in use rather than counting
 * rows, so a copy that was withdrawn years ago does not hand its number to a
 * new book and leave two copies numbered the same.
 */
export async function nextCopyNumber(supabase: Supabase, catalogueRecordId: string): Promise<number> {
	const { data } = await supabase
		.from('lib_items')
		.select('copy_number')
		.eq('catalogue_record_id', catalogueRecordId)
		.order('copy_number', { ascending: false })
		.limit(1)

	return (data?.[0]?.copy_number ?? 0) + 1
}
