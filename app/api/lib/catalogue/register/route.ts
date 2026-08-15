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
		const { data, error } = await fetchAllRows(range => {
			let query = supabase
				.from('lib_items')
				.select(`
					id, accession_number, copy_number, status, is_lendable, accession_date,
					catalogue:lib_catalogue_records(
						id, title, subtitle, author, edition, isbn, issn,
						resource_format, book_type, department, book_location,
						publisher_name, publication_year, is_reference_only
					)
				`)

			if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

			return query
				.order('accession_number', { ascending: true })
				.range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching the accession register:', error)
			return NextResponse.json({ error: 'Failed to load the register' }, { status: 500 })
		}

		// How many copies each title holds, worked out from the rows already in
		// hand rather than asked of the database again.
		const copiesByTitle = new Map<string, number>()
		for (const row of data || []) {
			const catalogue = row.catalogue as unknown as { id?: string } | null
			if (catalogue?.id) copiesByTitle.set(catalogue.id, (copiesByTitle.get(catalogue.id) ?? 0) + 1)
		}

		const rows = (data || []).map(row => {
			const catalogue = row.catalogue as unknown as {
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
			} | null

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
			}
		})

		return NextResponse.json(rows)
	} catch (error) {
		console.error('Unexpected error loading the register:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
