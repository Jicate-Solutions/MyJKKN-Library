import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const q = searchParams.get('q')?.trim()
		const resourceFormat = searchParams.get('resource_format')
		const classification = searchParams.get('classification')

		if (!q) {
			return NextResponse.json({ error: 'q (search query) is required' }, { status: 400 })
		}

		// Build tsquery — join words with & for AND matching
		const tsquery = q
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => `${w}:*`)
			.join(' & ')

		let query = supabase
			.from('lib_catalogue_records')
			.select(`
				*,
				authors:lib_catalogue_authors(id, author_name, author_type, sort_order),
				items_count:lib_items(count)
			`)
			.textSearch('title', tsquery, { type: 'websearch', config: 'english' })
			.eq('is_active', true)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (resourceFormat) query = query.eq('resource_format', resourceFormat)
		if (classification) query = query.ilike('classification_number', `${classification}%`)

		const { data, error } = await query
			.order('title', { ascending: true })
			.range(0, 199)

		if (error) {
			console.error('Error during catalogue full-text search:', error)
			// Fall back to ILIKE search if full-text fails
			let fallbackQuery = supabase
				.from('lib_catalogue_records')
				.select(`
					*,
					authors:lib_catalogue_authors(id, author_name, author_type, sort_order)
				`)
				.ilike('title', `%${q}%`)
				.eq('is_active', true)

			if (institutionId) fallbackQuery = fallbackQuery.eq('institution_id', institutionId)
			if (resourceFormat) fallbackQuery = fallbackQuery.eq('resource_format', resourceFormat)

			const { data: fallback, error: fallbackError } = await fallbackQuery
				.order('title', { ascending: true })
				.range(0, 199)

			if (fallbackError) {
				return NextResponse.json({ error: 'Search failed' }, { status: 500 })
			}

			return NextResponse.json({
				data: fallback || [],
				total: (fallback || []).length,
				query: q,
				search_mode: 'fallback',
			})
		}

		return NextResponse.json({
			data: data || [],
			total: (data || []).length,
			query: q,
			search_mode: 'fulltext',
		})
	} catch (error) {
		console.error('Unexpected error during catalogue search:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
