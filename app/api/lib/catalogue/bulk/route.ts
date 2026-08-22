/**
 * Bulk book entry: POST /api/lib/catalogue/bulk
 *
 * Takes the rows of the filled template and creates, for each one, a catalogue
 * title plus its first physical copy — the same pair the Add Title form creates,
 * so a book entered by sheet is indistinguishable from one typed by hand.
 *
 * Nothing is all-or-nothing. A sheet of 200 books with 3 bad rows saves 197 and
 * reports the 3 by row number, because the alternative — refusing the whole
 * sheet over one missing ISBN — means the librarian re-uploads all 200 to fix
 * three, and does that repeatedly.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import {
	templateColumnsForBookType,
	isValidDepartment,
	formatForBookType,
	isReferenceOnlyFromLabel,
	isbnRequiredFor,
	departmentRequiredFor,
	usesBookOnlyFields,
} from '@/lib/library/catalogue-options'
import { findExistingTitle, nextCopyNumber } from '@/lib/library/copy-grouping'
import { toSheetDate } from '@/lib/library/sheet-date'
import { supplierLookupFor } from '@/lib/library/supplier-by-name'
import { logActivity } from '@/lib/library/activity-log'

/** How many books are in flight at once. Enough to be quick, few enough to be kind to the connection pool. */
const CONCURRENCY = 8

interface IncomingRow {
	[key: string]: string | number | null | undefined
}

interface RowFailure {
	/** 1-based row number as it appears in Excel, header included — what the librarian sees. */
	row: number
	accession_number: string
	error: string
}

const text = (value: unknown): string => (value ?? '').toString().trim()

/**
 * Which rows of this sheet describe the same book.
 *
 * Uses the same rule `findExistingTitle` uses — title and author, read past
 * capitals and extra spaces — so rows the database would group are grouped here
 * too, before any of them is written. ISBN takes no part: two rows sharing one
 * while naming different books are two books.
 */
function identityKey(row: IncomingRow): string {
	const soft = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, ' ')
	return `${soft(row.title)}|${soft(row.author)}`
}

/**
 * Checks one row against the same rules the form uses.
 * Returns the error message, or null when the row is good.
 */
function validateRow(
	row: IncomingRow,
	seen: Map<string, number>,
	rowNumber: number,
	institutionCode: string | null
): string | null {
	const bookType = text(row.book_type)

	// Judged by what the row says it is, not by which sheet it arrived on. A
	// magazine typed into the Books sheet is still a magazine, and is not asked
	// for an ISBN or a department it does not have.
	for (const column of templateColumnsForBookType(bookType)) {
		if (column.required && !text(row[column.key])) {
			return `${column.header} is empty`
		}
	}

	const year = text(row.publication_year)
	if (!/^\d{4}$/.test(year)) return 'Year must be four digits'

	// A magazine or journal has no price column on its sheet — what the library
	// pays is a year's subscription, recorded against that subscription
	if (usesBookOnlyFields(bookType)) {
		const price = text(row.price)
		if (isNaN(Number(price)) || Number(price) < 0) return 'Price must be a number'
	}

	const pages = text(row.pages)
	if (isNaN(Number(pages)) || Number(pages) <= 0) return 'Total Pages must be a number'

	// Any way a date is ordinarily written is read; only something that is not
	// a date at all is refused
	if (!toSheetDate(row.accession_date)) {
		return 'Date of Adding is not a date — write it as 2026-08-12 or 12-08-2026'
	}

	// Only books carry an ISBN. Magazines, journals, project reports and
	// whatever lands under Others were never issued one.
	if (isbnRequiredFor(bookType) && !text(row.isbn)) {
		return 'ISBN is empty — books must have one'
	}

	// The supplier is not checked against a list. Acquisition → Suppliers is not
	// in use yet, so there is no list to check against — a name that is new to
	// this college is added to it rather than refused, exactly as the Add Title
	// form now does.

	const lendable = text(row.reference_only).toLowerCase()
	if (lendable !== 'lendable' && lendable !== 'non-lendable') {
		return 'Reference Only must be Lendable or Non-lendable'
	}

	// Each college has its own department list; one that has not given us a list
	// yet accepts whatever is typed rather than rejecting every row.
	// A magazine or journal may leave it blank; anything filled in is still
	// checked, so a misspelt department is caught either way.
	const department = text(row.department)
	if ((departmentRequiredFor(bookType) || department) && !isValidDepartment(institutionCode, department)) {
		return `Department "${department}" is not in your college's list`
	}

	// Two rows of the same sheet claiming one number — caught here rather than
	// letting the first win silently and the second fail with a confusing
	// "already used by another copy" pointing at a book from the same upload.
	const accession = text(row.accession_number).toLowerCase()
	const earlier = seen.get(accession)
	if (earlier) return `Accession number repeats row ${earlier} of this sheet`
	seen.set(accession, rowNumber)

	return null
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const rows: IncomingRow[] = Array.isArray(body.rows) ? body.rows : []
		if (rows.length === 0) {
			return NextResponse.json({ error: 'The sheet has no rows to read' }, { status: 400 })
		}
		// No ceiling on how many books one upload may carry. A college arriving
		// with its whole register — several thousand books in one file — must be
		// able to send it as it is; the screen sends it in batches and shows how
		// far it has got, so a long sheet costs time, not a rejection.

		const supabase = getSupabaseServer()

		// Which college is uploading, so the department column is checked against
		// that college's list. Read from the database rather than trusted from the
		// request — the caller could otherwise name a college whose list is looser.
		const { data: institution } = await supabase
			.from('institutions')
			.select('institution_code')
			.eq('id', institutionId)
			.maybeSingle()

		const institutionCode: string | null = institution?.institution_code ?? null

		// This college's vendors, read once for the whole batch rather than once
		// per row. Both the name and the code are accepted, because a librarian
		// filling a sheet writes whichever is in front of them — and a name that
		// is new to the college is added rather than refused.
		const suppliers = await supplierLookupFor(supabase, institutionId)

		const failures: RowFailure[] = []
		const seen = new Map<string, number>()
		const valid: Array<{ row: number; data: IncomingRow }> = []

		// A long sheet arrives in batches so the screen can show how far it has
		// got. Each batch says how many rows came before it, so a failure is
		// still reported by the row number the librarian sees in Excel.
		const rowOffset = Number(body.row_offset) > 0 ? Number(body.row_offset) : 0

		rows.forEach((row, index) => {
			// +2: the header is row 1, so the first data row is row 2 in Excel
			const rowNumber = index + 2 + rowOffset
			const problem = validateRow(row, seen, rowNumber, institutionCode)
			if (problem) {
				failures.push({ row: rowNumber, accession_number: text(row.accession_number), error: problem })
			} else {
				valid.push({ row: rowNumber, data: row })
			}
		})

		// Numbers already on the shelf, checked in one query rather than one per
		// row. Scoped to this institution: another college's Accession 101 is a
		// different book and must not block this one.
		if (valid.length > 0) {
			const numbers = valid.map(v => text(v.data.accession_number))
			const { data: existing } = await supabase
				.from('lib_items')
				.select('accession_number')
				.eq('institution_id', institutionId)
				.in('accession_number', numbers)

			const taken = new Set((existing || []).map(e => e.accession_number.toLowerCase()))
			if (taken.size > 0) {
				for (let i = valid.length - 1; i >= 0; i--) {
					const accession = text(valid[i].data.accession_number)
					if (taken.has(accession.toLowerCase())) {
						failures.push({
							row: valid[i].row,
							accession_number: accession,
							error: 'Accession number already used by a book in this library',
						})
						valid.splice(i, 1)
					}
				}
			}
		}

		let created = 0
		let newTitles = 0

		// Rows describing the same book are chained together and run one after
		// the other, while different books run side by side. Five copies of one
		// title uploaded together would otherwise all ask "does this title exist
		// yet?" at the same moment, all be told no, and create five duplicate
		// titles holding one copy each.
		const chains = new Map<string, typeof valid>()
		for (const entry of valid) {
			const key = identityKey(entry.data)
			const chain = chains.get(key)
			if (chain) chain.push(entry)
			else chains.set(key, [entry])
		}

		const work = [...chains.values()]

		for (let start = 0; start < work.length; start += CONCURRENCY) {
			const batch = work.slice(start, start + CONCURRENCY)

			const results = await Promise.all(batch.map(async chain => {
				const outcomes: Array<RowFailure | 'new-title' | 'copy'> = []

				for (const { row, data } of chain) {
					const accession = text(data.accession_number)
					const bookType = text(data.book_type)
					const referenceOnly = isReferenceOnlyFromLabel(text(data.reference_only))

					// Author, issue number and price are a book's. A magazine or
					// journal sheet does not carry them, and a blank left as 0 or ''
					// would read later as "somebody skipped it" rather than "this
					// does not apply".
					const bookOnly = usesBookOnlyFields(bookType)
					const price = bookOnly && text(data.price) ? Number(text(data.price)) : null

					const identity = {
						title: text(data.title),
						author: bookOnly ? text(data.author) : '',
						edition: bookOnly ? text(data.edition) : '',
						publisher_name: text(data.publisher_name),
						publisher_place: text(data.publisher_place),
						publication_year: Number(text(data.publication_year)),
						isbn: text(data.isbn),
						issn: text(data.issn),
					}

					// Already on the shelf? Then this row is another copy of it.
					const existing = await findExistingTitle(supabase, institutionId, identity)
					let recordId = existing?.id ?? null
					let createdTitle = false

					if (!recordId) {
						const { data: record, error: recordError } = await supabase
							.from('lib_catalogue_records')
							.insert({
								institution_id: institutionId,
								title: identity.title,
								subtitle: text(data.subtitle) || null,
								resource_format: formatForBookType(bookType),
								book_type: bookType,
								author: identity.author || null,
								isbn: identity.isbn || null,
								issn: identity.issn || null,
								edition: identity.edition || null,
								publication_year: identity.publication_year,
								language: text(data.language) || 'English',
								classification_number: text(data.classification_number) || null,
								call_number: text(data.call_number) || null,
								publisher_name: identity.publisher_name || null,
								publisher_place: identity.publisher_place || null,
								pages: Number(text(data.pages)),
								price,
								currency_code: 'INR',
								department: text(data.department) || null,
								book_location: text(data.book_location) || null,
								is_reference_only: referenceOnly,
								is_active: true,
							})
							.select('id')
							.single()

						if (recordError || !record) {
							outcomes.push({ row, accession_number: accession, error: recordError?.message ?? 'Could not save the title' })
							continue
						}

						recordId = record.id
						createdTitle = true

						// The registry list and author search read the joined table, so
						// the name has to land there too.
						if (identity.author) {
							await supabase.from('lib_catalogue_authors').insert({
								catalogue_record_id: recordId,
								institution_id: institutionId,
								author_name: identity.author,
								author_type: 'primary',
								sort_order: 0,
							})
						}
					}

					const copyNumber = await nextCopyNumber(supabase, recordId as string)

					// The vendor named in the sheet, added to this college's list the
					// first time it appears. Blank on a book, which carries none here.
					const supplierId = await suppliers.resolve(data.supplier)

					const { error: itemError } = await supabase
						.from('lib_items')
						.insert({
							institution_id: institutionId,
							catalogue_record_id: recordId,
							accession_number: accession,
							copy_number: copyNumber,
							condition: 'new',
							price,
							currency_code: 'INR',
							status: 'available',
							is_lendable: !referenceOnly,
							is_active: true,
							supplier_id: supplierId,
							// Whatever form it was written in, stored the one way
							accession_date: toSheetDate(data.accession_date),
						})

					if (itemError) {
						// Only undo a title this row just made. One that already held
						// copies has to survive a failed row.
						if (createdTitle && recordId) {
							await supabase.from('lib_catalogue_records').delete().eq('id', recordId)
						}
						outcomes.push({
							row,
							accession_number: accession,
							error: itemError.code === '23505'
								? 'Accession number already used by a book in this library'
								: itemError.message,
						})
						continue
					}

					outcomes.push(createdTitle ? 'new-title' : 'copy')
				}

				return outcomes
			}))

			for (const outcomes of results) {
				for (const outcome of outcomes) {
					if (outcome === 'new-title') { created++; newTitles++ }
					else if (outcome === 'copy') created++
					else failures.push(outcome)
				}
			}
		}

		failures.sort((a, b) => a.row - b.row)

		// One line per batch the screen sends, so a 2000-row sheet reads as a
		// handful of uploads rather than two thousand identical entries
		await logActivity(request, {
			action: 'file_import',
			resource_type: 'catalogue_record',
			resource_id: '/registry',
			institution_id: institutionId,
			status: failures.length > 0 ? 'error' : 'success',
			error_message: failures.length > 0 ? `${failures.length} row(s) were not added` : null,
			metadata: {
				records_count: created,
				error_count: failures.length,
				new_titles: newTitles,
				rows_sent: rows.length,
				first_row: rowOffset + 2,
			},
		})

		return NextResponse.json({
			created,
			new_titles: newTitles,
			copies_added: created - newTitles,
			failed: failures.length,
			total: rows.length,
			failures,
		})
	} catch (error) {
		console.error('Unexpected error in bulk catalogue upload:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
