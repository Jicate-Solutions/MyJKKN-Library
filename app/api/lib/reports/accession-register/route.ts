import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')
		const resourceFormat = searchParams.get('resource_format')
		const search = searchParams.get('search')

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		let query = supabase
			.from('lib_items')
			.select(`
				id,
				accession_number,
				accession_date,
				barcode,
				copy_number,
				condition,
				price,
				invoice_cost,
				invoice_number,
				date_received,
				status,
				is_active,
				catalogue_record:lib_catalogue_records(
					id,
					title,
					isbn,
					issn,
					edition,
					publication_year,
					resource_format,
					classification_number,
					call_number,
					publisher_name,
					publisher_place,
					authors:lib_catalogue_authors(author_name, author_type, sort_order)
				),
				location:lib_locations(location_code, location_name),
				supplier_id
			`)
			.eq('institution_id', institutionId)

		if (fromDate) query = query.gte('accession_date', fromDate)
		if (toDate) query = query.lte('accession_date', toDate)
		if (resourceFormat) {
			// Filter via catalogue_record — apply post-fetch
		}
		if (search) {
			query = query.or(`accession_number.ilike.%${search}%,barcode.ilike.%${search}%`)
		}

		const { data, error } = await query
			.order('accession_number', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching accession register:', error)
			return NextResponse.json({ error: 'Failed to fetch accession register' }, { status: 500 })
		}

		let result = data || []

		// Apply resource_format filter post-join
		if (resourceFormat) {
			result = result.filter(
				(item) =>
					(item.catalogue_record as { resource_format?: string } | null)?.resource_format === resourceFormat
			)
		}

		// Format accession register entries
		const formatted = result.map((item, idx) => {
			const cat = item.catalogue_record as {
				id?: string
				title?: string
				isbn?: string
				issn?: string
				edition?: string
				publication_year?: number
				resource_format?: string
				classification_number?: string
				call_number?: string
				publisher_name?: string
				publisher_place?: string
				authors?: Array<{ author_name: string; author_type: string; sort_order: number }>
			} | null
			const authors = (cat?.authors ?? [])
				.sort((a, b) => a.sort_order - b.sort_order)
				.map((a) => a.author_name)
				.join('; ')

			return {
				serial_no: idx + 1,
				accession_number: item.accession_number,
				accession_date: item.accession_date,
				title: cat?.title,
				author: authors,
				isbn_issn: cat?.isbn ?? cat?.issn,
				edition: cat?.edition,
				publication_year: cat?.publication_year,
				publisher: cat?.publisher_name,
				place_of_publication: cat?.publisher_place,
				classification_number: cat?.classification_number,
				call_number: cat?.call_number,
				resource_format: cat?.resource_format,
				price: item.invoice_cost ?? item.price,
				invoice_number: item.invoice_number,
				date_received: item.date_received,
				copy_number: item.copy_number,
				condition: item.condition,
				status: item.status,
				location: item.location,
			}
		})

		return NextResponse.json({
			data: formatted,
			total: formatted.length,
			institution_id: institutionId,
			from_date: fromDate,
			to_date: toDate,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		console.error('Unexpected error generating accession register:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
