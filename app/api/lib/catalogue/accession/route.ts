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
import { formatForBookType, isbnRequiredFor } from '@/lib/library/catalogue-options'
import { istToday } from '@/lib/library/ist-clock'

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

		const identity = {
			title,
			author: text(body.author),
			edition: text(body.edition),
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
					price: body.price ?? null,
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

		const copyNumber = await nextCopyNumber(supabase, recordId as string)

		const { data: item, error: itemError } = await supabase
			.from('lib_items')
			.insert({
				institution_id: institutionId,
				catalogue_record_id: recordId,
				accession_number: accession,
				copy_number: copyNumber,
				condition: 'new',
				price: body.price ?? null,
				currency_code: 'INR',
				status: 'available',
				is_lendable: !(body.is_reference_only ?? false),
				is_active: true,
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

		return NextResponse.json({
			catalogue_record_id: recordId,
			title,
			copy_number: item.copy_number,
			accession_number: item.accession_number,
			// null when this is the first copy — the desk shows a different message
			matched_by: existing?.matchedBy ?? null,
			matched_title: existing?.title ?? null,
		}, { status: 201 })
	} catch (error) {
		console.error('Unexpected error accessioning a book:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
