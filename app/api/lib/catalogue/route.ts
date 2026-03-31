import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const resourceFormat = searchParams.get('resource_format')
		const search = searchParams.get('search')
		const isActive = searchParams.get('is_active')

		let query = supabase
			.from('lib_catalogue_records')
			.select(`
				*,
				authors:lib_catalogue_authors(id, author_name, author_type, sort_order)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (resourceFormat) query = query.eq('resource_format', resourceFormat)
		if (isActive !== null) query = query.eq('is_active', isActive === 'true')
		if (search) {
			query = query.or(
				`title.ilike.%${search}%,isbn.ilike.%${search}%,issn.ilike.%${search}%,publisher_name.ilike.%${search}%,call_number.ilike.%${search}%`
			)
		}

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching catalogue records:', error)
			return NextResponse.json({ error: 'Failed to fetch catalogue records' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching catalogue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!body.title?.trim()) {
			return NextResponse.json({ error: 'title is required' }, { status: 400 })
		}
		if (!body.resource_format?.trim()) {
			return NextResponse.json({ error: 'resource_format is required' }, { status: 400 })
		}

		const authors: Array<{
			author_name: string
			author_type?: string
			sort_order?: number
		}> = body.authors || []

		// Insert the catalogue record first
		const { data: record, error: recordError } = await supabase
			.from('lib_catalogue_records')
			.insert({
				institution_id: body.institution_id,
				title: body.title.trim(),
				subtitle: body.subtitle ?? null,
				resource_format: body.resource_format,
				isbn: body.isbn ?? null,
				issn: body.issn ?? null,
				edition: body.edition ?? null,
				volume_number: body.volume_number ?? null,
				publication_year: body.publication_year ?? null,
				language: body.language ?? 'English',
				classification_number: body.classification_number ?? null,
				call_number: body.call_number ?? null,
				subject_headings: body.subject_headings ?? null,
				publisher_name: body.publisher_name ?? null,
				publisher_place: body.publisher_place ?? null,
				series_title: body.series_title ?? null,
				pages: body.pages ?? null,
				price: body.price ?? null,
				currency_code: body.currency_code ?? 'INR',
				marc_data: body.marc_data ?? null,
				default_loan_days: body.default_loan_days ?? null,
				is_reference_only: body.is_reference_only ?? false,
				is_active: body.is_active ?? true,
				created_by: body.created_by ?? null,
			})
			.select()
			.single()

		if (recordError) {
			console.error('Error creating catalogue record:', recordError)
			if (recordError.code === '23505') {
				return NextResponse.json({ error: 'Catalogue record already exists' }, { status: 400 })
			}
			if (recordError.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create catalogue record' }, { status: 500 })
		}

		// Insert authors if provided
		if (authors.length > 0) {
			const authorRows = authors.map((a, idx) => ({
				catalogue_record_id: record.id,
				institution_id: body.institution_id,
				author_name: a.author_name,
				author_type: a.author_type ?? 'primary',
				sort_order: a.sort_order ?? idx,
			}))

			const { error: authorsError } = await supabase
				.from('lib_catalogue_authors')
				.insert(authorRows)

			if (authorsError) {
				console.error('Error inserting authors:', authorsError)
				// Non-fatal — record was created; return it with warning
				return NextResponse.json(
					{ ...record, authors: [], warning: 'Record created but authors failed to save' },
					{ status: 201 }
				)
			}
		}

		// Return record with authors
		const { data: full } = await supabase
			.from('lib_catalogue_records')
			.select('*, authors:lib_catalogue_authors(id, author_name, author_type, sort_order)')
			.eq('id', record.id)
			.single()

		return NextResponse.json(full ?? record, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating catalogue record:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
