import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const resourceFormat = searchParams.get('resource_format')
		const search = searchParams.get('search')
		const isActive = searchParams.get('is_active')

		// Sliced, because one request returns at most a thousand rows and a
		// college holding more titles than that would silently lose the rest.
		const { data, error } = await fetchAllRows(range => {
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

			return query
				.order('created_at', { ascending: false })
				.range(range.from, range.to)
		})

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
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

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

		// A single typed author still has to reach lib_catalogue_authors, or the
		// registry list and the author search would show nothing for books added
		// through the Pharmacy form — they read the joined table, not the column.
		if (authors.length === 0 && body.author?.trim()) {
			authors.push({ author_name: body.author.trim(), author_type: 'primary', sort_order: 0 })
		}

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
				author: body.author?.trim() || null,
				department: body.department?.trim() || null,
				book_type: body.book_type?.trim() || null,
				book_location: body.book_location?.trim() || null,
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
