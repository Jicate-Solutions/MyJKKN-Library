/**
 * The accession register: GET /api/lib/catalogue/register
 *
 * One row per physical book, not per title — because that is what the register
 * on the librarian's desk is. Five copies of one book are five lines in that
 * book, each with its own accession number, and everything else repeated.
 *
 * The catalogue list route stays as it is, one row per title, for the campuses
 * that read it that way.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()

		// Read in slices rather than one go: the database hands back at most a
		// thousand rows per request, and a college with more books than that was
		// seeing its register cut off at the thousandth line — copy counts
		// included, since they are worked out from the rows in hand.
		//
		// The titles are read separately rather than hung off each copy. Asking
		// for them through the copy meant the database assembling the same title
		// over and over — Engineering has 27,996 copies of 4,007 titles, so each
		// title was built roughly seven times, and the join cost four times what
		// the plain rows cost. Read apart and paired up here, the same register
		// comes back in under half the time.
		const [items, records, suppliers] = await Promise.all([
			fetchAllRows(range => {
				let query = supabase
					.from('lib_items')
					.select('id, accession_number, copy_number, status, is_lendable, accession_date, catalogue_record_id, supplier_id')

				if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

				return query
					.order('accession_number', { ascending: true })
					.range(range.from, range.to)
			}),
			fetchAllRows(range => {
				let query = supabase
					.from('lib_catalogue_records')
					.select(`
						id, title, subtitle, author, edition, isbn, issn,
						resource_format, book_type, department, book_location,
						publisher_name, publication_year, is_reference_only
					`)

				if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

				return query.range(range.from, range.to)
			}),
			// A college's whole supplier list — a handful of rows, read once and
			// paired up here for the same reason the titles are: joining it onto
			// every copy would have the database rebuild one vendor thousands of
			// times over. The register shows this in place of Author when the
			// filter is Magazine or Journals, where a supplier is what a librarian
			// is actually looking for.
			fetchAllRows(range => {
				let query = supabase
					.from('lib_suppliers')
					.select('id, supplier_name')

				if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

				return query.range(range.from, range.to)
			}),
		])

		const error = items.error ?? records.error ?? suppliers.error
		if (error) {
			console.error('Error fetching the accession register:', error)
			return NextResponse.json({ error: 'Failed to load the register' }, { status: 500 })
		}

		const data = items.data

		interface CatalogueRow {
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

		const titlesById = new Map<string, CatalogueRow>()
		for (const record of (records.data || []) as CatalogueRow[]) {
			titlesById.set(record.id, record)
		}

		const supplierNames = new Map<string, string>()
		for (const supplier of (suppliers.data || []) as Array<{ id: string; supplier_name: string }>) {
			supplierNames.set(supplier.id, supplier.supplier_name)
		}

		// How many copies each title holds, worked out from the rows already in
		// hand rather than asked of the database again.
		const copiesByTitle = new Map<string, number>()
		for (const row of data || []) {
			const id = row.catalogue_record_id
			if (id) copiesByTitle.set(id, (copiesByTitle.get(id) ?? 0) + 1)
		}

		const rows = (data || []).map(row => {
			const catalogue = row.catalogue_record_id
				? titlesById.get(row.catalogue_record_id) ?? null
				: null

			return {
				item_id: row.id,
				accession_number: row.accession_number,
				copy_number: row.copy_number,
				status: row.status,
				is_lendable: row.is_lendable,
				accession_date: row.accession_date,
				catalogue_record_id: catalogue?.id ?? null,
				title: catalogue?.title ?? 'Unknown title',
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
				total_copies: catalogue?.id ? copiesByTitle.get(catalogue.id) ?? 1 : 1,
				// Belongs to this copy, not to the title: two copies of a journal
				// can come from two vendors, and the register is a list of copies.
				supplier_id: row.supplier_id ?? null,
				supplier_name: row.supplier_id ? supplierNames.get(row.supplier_id) ?? null : null,
			}
		})

		return NextResponse.json(rows)
	} catch (error) {
		console.error('Unexpected error loading the register:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
