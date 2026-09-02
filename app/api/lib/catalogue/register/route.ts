/**
 * The accession register: GET /api/lib/catalogue/register
 *
 * One row per physical book, not per title — because that is what the register
 * on the librarian's desk is. Five copies of one book are five lines in that
 * book, each with its own accession number, and everything else repeated.
 *
 * The catalogue list route stays as it is, one row per title, for the campuses
 * that read it that way.
 *
 * Answered as two lists — the titles once, the copies as small rows pointing
 * at a title by id — rather than one flat row per copy. Flat, every copy
 * carried its title's fifteen fields again, so Engineering's 4,007 titles
 * crossed the wire 27,996 times. The browser pairs them up with
 * `registerRowsFrom`, which is also where the shape is described.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'
import type { RegisterPayload, RegisterTitle, RegisterCopy } from '@/lib/library/register-rows'

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

		// Sent as they were read. The pairing of copy to title, the copy counts
		// and the supplier names all happen in the browser, once, from these
		// three lists — see registerRowsFrom.
		const payload: RegisterPayload = {
			titles: (records.data || []) as RegisterTitle[],
			copies: (items.data || []) as RegisterCopy[],
			suppliers: (suppliers.data || []) as Array<{ id: string; supplier_name: string }>,
		}

		return NextResponse.json(payload)
	} catch (error) {
		console.error('Unexpected error loading the register:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
