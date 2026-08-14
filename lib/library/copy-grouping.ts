/**
 * Deciding whether a book being accessioned is a new title or another copy of
 * one already on the shelf.
 *
 * The librarian never types a copy count. They enter each physical book with
 * its own accession number, exactly as the register is written, and the system
 * works out that the fifth entry of the same book is copy 5. That way the count
 * can never disagree with the shelf — it *is* the shelf.
 *
 * What makes two entries the same book: the title and the author, and nothing
 * else. Capitals and extra spaces are ignored on both, so "PHARMACOGNOSY" by
 * "C.K.  Kokate" is the book already held under "Pharmacognosy / C.K. Kokate".
 * If either the title or the author differs by so much as a word, it is a
 * different book and gets its own record.
 *
 * ISBN and ISSN are stored like any other detail and take no part in this. Two
 * rows carrying one ISBN but naming different books are two books — the sheet
 * is trusted over the number, because a copied-down ISBN is the ordinary
 * mistake and it used to file the second book under the first one's title.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'

type Supabase = ReturnType<typeof getSupabaseServer>

export interface TitleIdentity {
	title: string
	author?: string | null
	/**
	 * The rest travel with the identity because the caller saves them on a new
	 * record, but none of them decides whether this is a copy.
	 */
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
	matchedBy: 'title and author'
}

/** "C.K.  Kokate " and "c.k. kokate" are the same person to a human, so also to us. */
function normalise(value: unknown): string {
	return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function findExistingTitle(
	supabase: Supabase,
	institutionId: string,
	identity: TitleIdentity
): Promise<TitleMatch | null> {
	if (!identity.title.trim()) return null

	// Candidates are pulled with the spaces in the title turned into wildcards,
	// because "Old  Pharmacopoeia" typed with a double space is the same book as
	// "Old Pharmacopoeia" and an exact match would miss it. The wildcard only
	// widens the net; the real comparison happens below, normalised, in code —
	// where title and author are read the way a person reads them rather than as
	// exact strings.
	const titlePattern = identity.title
		.trim()
		.replace(/[%_\\]/g, m => `\\${m}`)
		.replace(/\s+/g, '%')

	const { data: sameTitle } = await supabase
		.from('lib_catalogue_records')
		.select('id, title, author')
		.eq('institution_id', institutionId)
		.ilike('title', titlePattern)
		.limit(200)

	const match = (sameTitle || []).find(record =>
		normalise(record.title) === normalise(identity.title) &&
		normalise(record.author) === normalise(identity.author)
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
