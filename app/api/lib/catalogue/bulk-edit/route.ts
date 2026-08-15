/**
 * Bulk edit of books already on the shelf.
 *
 *   GET  /api/lib/catalogue/bulk-edit  — the whole register as sheet rows, each
 *                                        carrying the Book ID it was saved with
 *   PUT  /api/lib/catalogue/bulk-edit  — those rows back, changed
 *
 * The Book ID is the whole idea. Bulk upload reads a sheet as new books and has
 * no way to be told "this line is a correction, not a book" — so a librarian
 * fixing one misspelt author had to open twenty books one at a time. Here every
 * line names the copy it belongs to, so any field on it can be retyped,
 * including the accession number.
 *
 * Both directions are pinned to one college by the guard, never by the request,
 * so a librarian downloads their own register and can only write back into it.
 *
 * Changing a title or an author does not rename the book everyone else's copies
 * are filed under. It takes that one copy out of the group — the old book's
 * count drops by one — and files it under the title and author now typed,
 * joining a book already held by that name or starting a new one.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite } from '@/lib/auth/api-guard'
import {
	TEMPLATE_COLUMNS,
	EDIT_ID_COLUMN,
	isValidDepartment,
	formatForBookType,
	isReferenceOnlyFromLabel,
	isbnRequiredFor,
} from '@/lib/library/catalogue-options'
import { findExistingTitle, nextCopyNumber } from '@/lib/library/copy-grouping'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** How many books are changed at once. Same reasoning as the upload route. */
const CONCURRENCY = 8

interface IncomingRow {
	[key: string]: string | number | null | undefined
}

interface RowFailure {
	/** 1-based row number as it appears in Excel, header included. */
	row: number
	book_id: string
	accession_number: string
	error: string
}

const text = (value: unknown): string => (value ?? '').toString().trim()

/** "C.K.  Kokate " and "c.k. kokate" are one person, here as in copy-grouping. */
const soft = (value: unknown): string => text(value).toLowerCase().replace(/\s+/g, ' ')

/** What the shelf calls this copy: a title and an author, nothing else. */
const bookKey = (title: unknown, author: unknown): string => `${soft(title)}|${soft(author)}`

interface ItemOnShelf {
	id: string
	accession_number: string
	catalogue_record_id: string
	title: string
	author: string | null
}

/**
 * Checks one row against the rules the form and the upload sheet use.
 * Returns the error message, or null when the row is good.
 */
function validateRow(row: IncomingRow, institutionCode: string | null): string | null {
	for (const column of TEMPLATE_COLUMNS) {
		if (column.required && !text(row[column.key])) {
			return `${column.header} is empty`
		}
	}

	const year = text(row.publication_year)
	if (!/^\d{4}$/.test(year)) return 'Year must be four digits'

	const price = text(row.price)
	if (isNaN(Number(price)) || Number(price) < 0) return 'Price must be a number'

	const pages = text(row.pages)
	if (isNaN(Number(pages)) || Number(pages) <= 0) return 'Total Pages must be a number'

	const date = text(row.accession_date)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date of Adding must look like 2026-08-12'
	if (isNaN(new Date(date).getTime())) return 'Date of Adding is not a real date'

	if (isbnRequiredFor(text(row.book_type)) && !text(row.isbn)) {
		return 'ISBN is empty — books must have one'
	}

	const lendable = text(row.reference_only).toLowerCase()
	if (lendable !== 'lendable' && lendable !== 'non-lendable') {
		return 'Reference Only must be Lendable or Non-lendable'
	}

	const department = text(row.department)
	if (!isValidDepartment(institutionCode, department)) {
		return `Department "${department}" is not in your college's list`
	}

	return null
}

/**
 * The register as a sheet: one row per physical copy, each with its Book ID.
 */
export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'Select a college first' }, { status: 400 })
		}

		const supabase = getSupabaseServer()

		// Sliced: one request returns at most a thousand rows, and a sheet that
		// quietly stopped at the thousandth book would be edited as if the rest
		// of the library did not exist.
		const { data, error } = await fetchAllRows(range =>
			supabase
				.from('lib_items')
				.select(`
					id, accession_number, accession_date, price, is_lendable,
					catalogue:lib_catalogue_records(
						title, subtitle, author, edition, publisher_name, publisher_place,
						publication_year, book_type, isbn, issn, language, pages, price,
						call_number, classification_number, department, book_location
					)
				`)
				.eq('institution_id', institutionId)
				.order('accession_number', { ascending: true })
				.range(range.from, range.to)
		)

		if (error) {
			console.error('Error loading the register for bulk edit:', error)
			return NextResponse.json({ error: 'Failed to load the books' }, { status: 500 })
		}

		const rows = (data || []).map(item => {
			const catalogue = (item.catalogue ?? {}) as unknown as Record<string, unknown>
			return {
				id: item.id,
				accession_number: item.accession_number ?? '',
				title: text(catalogue.title),
				subtitle: text(catalogue.subtitle),
				author: text(catalogue.author),
				edition: text(catalogue.edition),
				publisher_name: text(catalogue.publisher_name),
				publisher_place: text(catalogue.publisher_place),
				publication_year: text(catalogue.publication_year),
				// The copy's own price, falling back to what the title was bought at
				price: text(item.price ?? catalogue.price),
				book_type: text(catalogue.book_type),
				isbn: text(catalogue.isbn),
				issn: text(catalogue.issn),
				language: text(catalogue.language),
				pages: text(catalogue.pages),
				call_number: text(catalogue.call_number),
				classification_number: text(catalogue.classification_number),
				// Read from the copy, which is what the desk actually lends
				reference_only: item.is_lendable ? 'Lendable' : 'Non-lendable',
				accession_date: text(item.accession_date),
				department: text(catalogue.department),
				book_location: text(catalogue.book_location),
			}
		})

		return NextResponse.json({ rows, total: rows.length })
	} catch (error) {
		console.error('Unexpected error building the bulk edit sheet:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
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
		// No ceiling here either: the sheet that came down carries the whole
		// library, so the one going back up must be allowed to carry it too.

		const supabase = getSupabaseServer()

		const { data: institution } = await supabase
			.from('institutions')
			.select('institution_code')
			.eq('id', institutionId)
			.maybeSingle()

		const institutionCode: string | null = institution?.institution_code ?? null

		const failures: RowFailure[] = []
		const valid: Array<{ row: number; data: IncomingRow }> = []
		const seenId = new Map<string, number>()
		const seenAccession = new Map<string, number>()

		// A long sheet arrives in batches so the screen can show how far it has
		// got. Each batch says how many rows came before it, so a failure is
		// still reported by the row number the librarian sees in Excel.
		const rowOffset = Number(body.row_offset) > 0 ? Number(body.row_offset) : 0

		rows.forEach((row, index) => {
			// +2: the header is row 1, so the first data row is row 2 in Excel
			const rowNumber = index + 2 + rowOffset
			const bookId = text(row[EDIT_ID_COLUMN.key])
			const accession = text(row.accession_number)

			const fail = (error: string) =>
				failures.push({ row: rowNumber, book_id: bookId, accession_number: accession, error })

			if (!bookId) {
				fail('Book ID is empty — that column tells the edit which book this line is')
				return
			}

			const earlierId = seenId.get(bookId.toLowerCase())
			if (earlierId) {
				fail(`This Book ID also appears on row ${earlierId} of this sheet`)
				return
			}
			seenId.set(bookId.toLowerCase(), rowNumber)

			const earlierAccession = seenAccession.get(accession.toLowerCase())
			if (earlierAccession) {
				fail(`Accession number repeats row ${earlierAccession} of this sheet`)
				return
			}
			seenAccession.set(accession.toLowerCase(), rowNumber)

			const problem = validateRow(row, institutionCode)
			if (problem) fail(problem)
			else valid.push({ row: rowNumber, data: row })
		})

		// The books these rows claim to be, read from this college only. A Book ID
		// belonging to another campus simply is not found here, so a sheet passed
		// between colleges can edit nothing.
		const onShelf = new Map<string, ItemOnShelf>()

		if (valid.length > 0) {
			const ids = valid.map(v => text(v.data[EDIT_ID_COLUMN.key]))
			const { data: items } = await supabase
				.from('lib_items')
				.select('id, accession_number, catalogue_record_id, catalogue:lib_catalogue_records(title, author)')
				.eq('institution_id', institutionId)
				.in('id', ids)

			for (const item of items || []) {
				const catalogue = (item.catalogue ?? {}) as unknown as { title?: string; author?: string | null }
				onShelf.set(item.id, {
					id: item.id,
					accession_number: item.accession_number,
					catalogue_record_id: item.catalogue_record_id,
					title: catalogue.title ?? '',
					author: catalogue.author ?? null,
				})
			}

			for (let i = valid.length - 1; i >= 0; i--) {
				const bookId = text(valid[i].data[EDIT_ID_COLUMN.key])
				if (!onShelf.has(bookId)) {
					failures.push({
						row: valid[i].row,
						book_id: bookId,
						accession_number: text(valid[i].data.accession_number),
						error: 'No book in this library has that Book ID',
					})
					valid.splice(i, 1)
				}
			}
		}

		// An accession number moved onto a book that is not in this sheet would
		// collide with the book already holding it. Caught here so the row is
		// reported by number rather than failing later as a database error.
		if (valid.length > 0) {
			const numbers = valid.map(v => text(v.data.accession_number))
			const { data: existing } = await supabase
				.from('lib_items')
				.select('id, accession_number')
				.eq('institution_id', institutionId)
				.in('accession_number', numbers)

			const holderByNumber = new Map(
				(existing || []).map(e => [e.accession_number.toLowerCase(), e.id])
			)

			for (let i = valid.length - 1; i >= 0; i--) {
				const bookId = text(valid[i].data[EDIT_ID_COLUMN.key])
				const accession = text(valid[i].data.accession_number)
				const holder = holderByNumber.get(accession.toLowerCase())
				if (holder && holder !== bookId) {
					failures.push({
						row: valid[i].row,
						book_id: bookId,
						accession_number: accession,
						error: 'Accession number already used by another book in this library',
					})
					valid.splice(i, 1)
				}
			}
		}

		let updated = 0
		let movedOut = 0

		// Rows landing on the same title are chained and run one after the other,
		// for the same reason the upload route chains them: two rows both asking
		// "does this title exist yet?" at the same moment would both be told no
		// and create the title twice.
		const chains = new Map<string, typeof valid>()
		for (const entry of valid) {
			const key = bookKey(entry.data.title, entry.data.author)
			const chain = chains.get(key)
			if (chain) chain.push(entry)
			else chains.set(key, [entry])
		}

		const work = [...chains.values()]

		for (let start = 0; start < work.length; start += CONCURRENCY) {
			const batch = work.slice(start, start + CONCURRENCY)

			const results = await Promise.all(batch.map(async chain => {
				const outcomes: Array<RowFailure | 'updated' | 'moved'> = []

				for (const { row, data } of chain) {
					const bookId = text(data[EDIT_ID_COLUMN.key])
					const item = onShelf.get(bookId) as ItemOnShelf
					const accession = text(data.accession_number)
					const bookType = text(data.book_type)
					const referenceOnly = isReferenceOnlyFromLabel(text(data.reference_only))
					const price = Number(text(data.price))

					const identity = {
						title: text(data.title),
						author: text(data.author),
						edition: text(data.edition),
						publisher_name: text(data.publisher_name),
						publisher_place: text(data.publisher_place),
						publication_year: Number(text(data.publication_year)),
						isbn: text(data.isbn),
						issn: text(data.issn),
					}

					// Everything about the book itself, as opposed to this one copy.
					const bookFields = {
						title: identity.title,
						subtitle: text(data.subtitle) || null,
						resource_format: formatForBookType(bookType),
						book_type: bookType,
						author: identity.author,
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
						department: text(data.department),
						book_location: text(data.book_location) || null,
						is_reference_only: referenceOnly,
					}

					const sameBook = bookKey(item.title, item.author) === bookKey(identity.title, identity.author)

					let targetRecordId = item.catalogue_record_id
					let moved = false

					if (sameBook) {
						// Still the same book, so the rest of the line is a correction to
						// it — and to every copy of it, which is what a shared record means.
						const { error: updateError } = await supabase
							.from('lib_catalogue_records')
							.update(bookFields)
							.eq('id', item.catalogue_record_id)
							.eq('institution_id', institutionId)

						if (updateError) {
							outcomes.push({ row, book_id: bookId, accession_number: accession, error: updateError.message })
							continue
						}
					} else {
						// A different title or author means this copy is no longer part of
						// that group. It leaves — the old book's count drops by one — and
						// joins whatever is held under the name now typed.
						const existing = await findExistingTitle(supabase, institutionId, identity)

						if (existing && existing.id !== item.catalogue_record_id) {
							targetRecordId = existing.id
						} else {
							const { data: record, error: recordError } = await supabase
								.from('lib_catalogue_records')
								.insert({
									institution_id: institutionId,
									...bookFields,
									currency_code: 'INR',
									is_active: true,
								})
								.select('id')
								.single()

							if (recordError || !record) {
								outcomes.push({
									row,
									book_id: bookId,
									accession_number: accession,
									error: recordError?.message ?? 'Could not save the book under its new title',
								})
								continue
							}

							targetRecordId = record.id

							// The registry list and author search read the joined table
							if (identity.author) {
								await supabase.from('lib_catalogue_authors').insert({
									catalogue_record_id: targetRecordId,
									institution_id: institutionId,
									author_name: identity.author,
									author_type: 'primary',
									sort_order: 0,
								})
							}
						}

						moved = true
					}

					const copyFields: Record<string, unknown> = {
						accession_number: accession,
						accession_date: text(data.accession_date),
						price,
						is_lendable: !referenceOnly,
					}

					if (moved) {
						copyFields.catalogue_record_id = targetRecordId
						copyFields.copy_number = await nextCopyNumber(supabase, targetRecordId)
					}

					const { error: itemError } = await supabase
						.from('lib_items')
						.update(copyFields)
						.eq('id', item.id)
						.eq('institution_id', institutionId)

					if (itemError) {
						outcomes.push({
							row,
							book_id: bookId,
							accession_number: accession,
							error: itemError.code === '23505'
								? 'Accession number already used by another book in this library'
								: itemError.message,
						})
						continue
					}

					// The copy it left behind is now one fewer; the shelf and the count
					// stay in step because the count is read from the copies themselves.
					outcomes.push(moved ? 'moved' : 'updated')
				}

				return outcomes
			}))

			for (const outcomes of results) {
				for (const outcome of outcomes) {
					if (outcome === 'moved') { updated++; movedOut++ }
					else if (outcome === 'updated') updated++
					else failures.push(outcome)
				}
			}
		}

		failures.sort((a, b) => a.row - b.row)

		return NextResponse.json({
			updated,
			moved: movedOut,
			failed: failures.length,
			total: rows.length,
			failures,
		})
	} catch (error) {
		console.error('Unexpected error in bulk catalogue edit:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
