import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('lib_catalogue_records')
			.select(`
				*,
				authors:lib_catalogue_authors(id, author_name, author_type, sort_order)
			`)
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Catalogue record not found' }, { status: 404 })
			}
			console.error('Error fetching catalogue record:', error)
			return NextResponse.json({ error: 'Failed to fetch catalogue record' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching catalogue record:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		const authors: Array<{
			author_name: string
			author_type?: string
			sort_order?: number
		}> | undefined = body.authors

		delete body.institution_id
		delete body.id
		delete body.authors
		delete body.created_at
		delete body.created_by

		const { data, error } = await supabase
			.from('lib_catalogue_records')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating catalogue record:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Catalogue record not found' }, { status: 404 })
			}
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Catalogue record already exists' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to update catalogue record' }, { status: 500 })
		}

		// If authors array provided, replace all authors for this record
		if (authors !== undefined) {
			await supabase
				.from('lib_catalogue_authors')
				.delete()
				.eq('catalogue_record_id', id)

			if (authors.length > 0) {
				const authorRows = authors.map((a, idx) => ({
					catalogue_record_id: id,
					institution_id: data.institution_id,
					author_name: a.author_name,
					author_type: a.author_type ?? 'primary',
					sort_order: a.sort_order ?? idx,
				}))
				await supabase.from('lib_catalogue_authors').insert(authorRows)
			}
		}

		// Return record with current authors
		const { data: full } = await supabase
			.from('lib_catalogue_records')
			.select('*, authors:lib_catalogue_authors(id, author_name, author_type, sort_order)')
			.eq('id', id)
			.single()

		return NextResponse.json(full ?? data)
	} catch (error) {
		console.error('Unexpected error updating catalogue record:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		const { error } = await supabase
			.from('lib_catalogue_records')
			.delete()
			.eq('id', id)

		if (error) {
			console.error('Error deleting catalogue record:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — catalogue record has associated items or orders' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete catalogue record' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting catalogue record:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
