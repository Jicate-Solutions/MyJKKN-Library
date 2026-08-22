/**
 * Accessioning one book: POST /api/lib/catalogue/accession
 *
 * The librarian enters a physical book with the number written inside it. This
 * decides whether that book is a new title or another copy of one already held,
 * creates whichever is needed, and reports back which it was — so the desk sees
 * "copy 3 of Textbook of Pharmacognosy" and can stop if that looks wrong.
 *
 * The copy count is never typed. It is however many accession numbers point at
 * the title, which is the only count that cannot drift from the shelf.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { findExistingTitle, nextCopyNumber } from '@/lib/library/copy-grouping'
import { formatForBookType, isbnRequiredFor, usesBookOnlyFields } from '@/lib/library/catalogue-options'
import { istToday } from '@/lib/library/ist-clock'
import { supplierLookupFor } from '@/lib/library/supplier-by-name'

const text = (value: unknown): string => (value ?? '').toString().trim()

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const accession = text(body.accession_number)
		const title = text(body.title)
		const bookType = text(body.book_type)

		if (!accession) {
			return NextResponse.json(
				{ error: 'Accession number is required — enter the number written in the book' },
				{ status: 400 }
			)
		}
		if (!title) {
			return NextResponse.json({ error: 'Title is required' }, { status: 400 })
		}
		if (isbnRequiredFor(bookType) && !text(body.isbn)) {
			return NextResponse.json({ error: 'ISBN is required for books' }, { status: 400 })
		}

		const supabase = getSupabaseServer()

		// Checked before anything is written, so a repeated number never leaves a
		// half-made title behind.
		const { data: clash } = await supabase
			.from('lib_items')
			.select('id, accession_number')
			.eq('institution_id', institutionId)
			.ilike('accession_number', accession)
			.maybeSingle()

		if (clash) {
			return NextResponse.json(
				{ error: `Accession number ${clash.accession_number} is already used by another book` },
				{ status: 409 }
			)
		}

		// Author, issue number and price are a book's. The form does not ask a
		// magazine or journal for them, and the server does not take them either
		// — so a hand-made request cannot put an issue number on a title that
		// will go on to hold a hundred of them.
		const bookOnly = usesBookOnlyFields(bookType)

		const identity = {
			title,
			author: bookOnly ? text(body.author) : '',
			edition: bookOnly ? text(body.edition) : '',
			publisher_name: text(body.publisher_name),
			publisher_place: text(body.publisher_place),
			publication_year: body.publication_year ?? null,
			isbn: text(body.isbn),
			issn: text(body.issn),
		}

		const existing = await findExistingTitle(supabase, institutionId, identity)
		let recordId = existing?.id ?? null
		let createdTitle = false

		if (!recordId) {
			const { data: record, error: recordError } = await supabase
				.from('lib_catalogue_records')
				.insert({
					institution_id: institutionId,
					title,
					subtitle: text(body.subtitle) || null,
					resource_format: formatForBookType(bookType),
					book_type: bookType || null,
					author: identity.author || null,
					isbn: identity.isbn || null,
					issn: identity.issn || null,
					edition: identity.edition || null,
					publication_year: body.publication_year ?? null,
					language: text(body.language) || 'English',
					classification_number: text(body.classification_number) || null,
					call_number: text(body.call_number) || null,
					publisher_name: identity.publisher_name || null,
					publisher_place: identity.publisher_place || null,
					pages: body.pages ?? null,
					price: bookOnly ? (body.price ?? null) : null,
					currency_code: 'INR',
					department: text(body.department) || null,
					book_location: text(body.book_location) || null,
					is_reference_only: body.is_reference_only ?? false,
					is_active: true,
				})
				.select('id')
				.single()

			if (recordError || !record) {
				console.error('Error creating catalogue record:', recordError)
				return NextResponse.json({ error: 'Could not save the book' }, { status: 500 })
			}

			recordId = record.id
			createdTitle = true

			// The registry list and the author search read the joined table
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

		// The vendor is typed rather than chosen — Acquisition → Suppliers is not
		// in use yet — so the name is turned into this college's supplier row,
		// created the first time that name is seen.
		//
		// Only asked when a name was actually sent: a book carries no supplier
		// here, and reading the whole vendor list to answer "none" would put a
		// query in front of every book entered.
		const supplierName = text(body.supplier_name)
		let supplierId: string | null = null
		if (supplierName) {
			const suppliers = await supplierLookupFor(supabase, institutionId)
			supplierId = await suppliers.resolve(supplierName)
		}

		const copyNumber = await nextCopyNumber(supabase, recordId as string)

		const { data: item, error: itemError } = await supabase
			.from('lib_items')
			.insert({
				institution_id: institutionId,
				catalogue_record_id: recordId,
				accession_number: accession,
				copy_number: copyNumber,
				condition: 'new',
				price: bookOnly ? (body.price ?? null) : null,
				currency_code: 'INR',
				status: 'available',
				is_lendable: !(body.is_reference_only ?? false),
				is_active: true,
				// Who this copy came from. Only magazines and journals send one.
				supplier_id: supplierId,
				accession_date: text(body.accession_date) || istToday(),
			})
			.select('id, accession_number, copy_number')
			.single()

		if (itemError || !item) {
			console.error('Error creating item:', itemError)
			// Only roll back a title this request made. An existing title with
			// other copies on the shelf must survive a failed accession.
			if (createdTitle && recordId) {
				await supabase.from('lib_catalogue_records').delete().eq('id', recordId)
			}
			return NextResponse.json(
				{
					error: itemError?.code === '23505'
						? 'That accession number is already used by another book'
						: 'Could not save the copy',
				},
				{ status: itemError?.code === '23505' ? 409 : 500 }
			)
		}

		// The finished register line for the book just entered.
		//
		// Without it the page had no way to show the new row except by reading
		// the whole register again — 27,996 copies and 4,007 titles re-read to
		// display one line. Two small lookups by id cost almost nothing, and the
		// title is read back rather than taken from the form because a copy
		// added to an existing book carries that book's details, not the ones
		// just typed.
		const [{ data: catalogue }, { count: totalCopies }] = await Promise.all([
			supabase
				.from('lib_catalogue_records')
				.select(`
					id, title, subtitle, author, edition, isbn, issn,
					resource_format, book_type, department, book_location,
					publisher_name, publication_year, is_reference_only
				`)
				.eq('id', recordId as string)
				.maybeSingle(),
			supabase
				.from('lib_items')
				.select('id', { count: 'exact', head: true })
				.eq('catalogue_record_id', recordId as string),
		])

		return NextResponse.json({
			catalogue_record_id: recordId,
			title,
			copy_number: item.copy_number,
			accession_number: item.accession_number,
			// null when this is the first copy — the desk shows a different message
			matched_by: existing?.matchedBy ?? null,
			matched_title: existing?.title ?? null,
			register_row: {
				item_id: item.id,
				accession_number: item.accession_number,
				copy_number: item.copy_number,
				status: 'available',
				is_lendable: !(body.is_reference_only ?? false),
				accession_date: text(body.accession_date) || istToday(),
				catalogue_record_id: catalogue?.id ?? null,
				title: catalogue?.title ?? title,
				subtitle: catalogue?.subtitle ?? null,
				author: catalogue?.author ?? null,
				edition: catalogue?.edition ?? null,
				isbn: catalogue?.isbn ?? null,
				issn: catalogue?.issn ?? null,
				resource_format: catalogue?.resource_format ?? 'other',
				book_type: catalogue?.book_type ?? null,
				department: catalogue?.department ?? null,
				book_location: catalogue?.book_location ?? null,
				publisher_name: catalogue?.publisher_name ?? null,
				publication_year: catalogue?.publication_year ?? null,
				is_reference_only: catalogue?.is_reference_only ?? false,
				total_copies: totalCopies ?? item.copy_number,
			},
		}, { status: 201 })
	} catch (error) {
		console.error('Unexpected error accessioning a book:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
