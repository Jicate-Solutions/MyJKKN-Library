/**
 * The accession register as it travels, and as it is read.
 *
 * It travels as two lists — the titles once, and the copies as small rows that
 * point at a title by id — because the register is a list of copies and a
 * college holds many more copies than titles: Nursing has 6,216 copies of
 * 2,449 titles, Engineering 27,996 of 4,007. Sent flat, every copy carried its
 * title's fifteen fields again, so the same title crossed the wire seven times
 * for Engineering. Sent apart and paired up here, the register is a fraction
 * of the size and the browser does the pairing in a few milliseconds.
 *
 * It is read as one flat row per copy, exactly as the register on the desk is
 * written: the accession number first, then the book's details repeated on
 * every copy's line. That is the shape the table, the search index and the
 * Excel download all work from, and the shape one newly entered book comes
 * back in from the accession route — so nothing on screen has to know the
 * register arrived in two pieces.
 */

import type { LibItemStatus } from '@/types/lib'

/** A title, sent once however many copies it has. */
export interface RegisterTitle {
	id: string
	title: string
	subtitle: string | null
	author: string | null
	edition: string | null
	isbn: string | null
	issn: string | null
	resource_format: string
	book_type: string | null
	department: string | null
	book_location: string | null
	publisher_name: string | null
	publication_year: number | null
	is_reference_only: boolean
}

/** One physical book: the copy's own fields and the id of its title. */
export interface RegisterCopy {
	id: string
	accession_number: string
	copy_number: number
	status: LibItemStatus
	is_lendable: boolean
	accession_date: string | null
	catalogue_record_id: string | null
	supplier_id: string | null
}

/** What GET /api/lib/catalogue/register answers with. */
export interface RegisterPayload {
	titles: RegisterTitle[]
	copies: RegisterCopy[]
	/** This college's vendors — a handful of rows, named on the copy that came from each. */
	suppliers: Array<{ id: string; supplier_name: string }>
}

/** One line of the register: a copy with its title's details laid beside it. */
export interface RegisterRow {
	item_id: string
	accession_number: string
	copy_number: number
	status: LibItemStatus
	accession_date: string | null
	catalogue_record_id: string | null
	title: string
	subtitle: string | null
	author: string | null
	edition: string | null
	isbn: string | null
	issn: string | null
	book_type: string | null
	department: string | null
	book_location: string | null
	is_reference_only: boolean
	total_copies: number
	/**
	 * The vendor this copy came from. Per copy, not per title: two copies of the
	 * same journal can arrive from two suppliers. Shown in place of Author when
	 * the register is filtered to Magazine or Journals.
	 */
	supplier_id: string | null
	supplier_name: string | null
}

/** Whether what came back is the two-list register and not an error body or an older shape. */
export function isRegisterPayload(value: unknown): value is RegisterPayload {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Record<string, unknown>
	return Array.isArray(candidate.titles) && Array.isArray(candidate.copies) && Array.isArray(candidate.suppliers)
}

/**
 * Lays the register out flat, one line per copy, in the order the copies came.
 *
 * A copy whose title is missing — a record deleted from under it — is still a
 * line, headed "Unknown title", because the accession number exists on a
 * shelf somewhere and hiding it would make the register disagree with the
 * shelf.
 */
export function registerRowsFrom(payload: RegisterPayload): RegisterRow[] {
	const titlesById = new Map<string, RegisterTitle>()
	for (const title of payload.titles) titlesById.set(title.id, title)

	const supplierNames = new Map<string, string>()
	for (const supplier of payload.suppliers) supplierNames.set(supplier.id, supplier.supplier_name)

	// How many copies each title holds, counted from the rows in hand.
	const copiesByTitle = new Map<string, number>()
	for (const copy of payload.copies) {
		if (copy.catalogue_record_id) {
			copiesByTitle.set(copy.catalogue_record_id, (copiesByTitle.get(copy.catalogue_record_id) ?? 0) + 1)
		}
	}

	return payload.copies.map(copy => {
		const title = copy.catalogue_record_id ? titlesById.get(copy.catalogue_record_id) ?? null : null
		return {
			item_id: copy.id,
			accession_number: copy.accession_number,
			copy_number: copy.copy_number,
			status: copy.status,
			accession_date: copy.accession_date ?? null,
			catalogue_record_id: title?.id ?? null,
			title: title?.title ?? 'Unknown title',
			subtitle: title?.subtitle ?? null,
			author: title?.author ?? null,
			edition: title?.edition ?? null,
			isbn: title?.isbn ?? null,
			issn: title?.issn ?? null,
			book_type: title?.book_type ?? null,
			department: title?.department ?? null,
			book_location: title?.book_location ?? null,
			is_reference_only: title?.is_reference_only ?? false,
			total_copies: title ? copiesByTitle.get(title.id) ?? 1 : 1,
			supplier_id: copy.supplier_id ?? null,
			supplier_name: copy.supplier_id ? supplierNames.get(copy.supplier_id) ?? null : null,
		}
	})
}
