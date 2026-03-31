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
			.from('lib_items')
			.select(`
				*,
				catalogue_record:lib_catalogue_records(id, title, isbn, issn, call_number, resource_format, publisher_name),
				location:lib_locations(id, location_code, location_name, floor, section)
			`)
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Item not found' }, { status: 404 })
			}
			console.error('Error fetching item:', error)
			return NextResponse.json({ error: 'Failed to fetch item' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching item:', error)
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

		delete body.institution_id
		delete body.id
		delete body.accession_number
		delete body.created_at
		delete body.created_by

		const { data, error } = await supabase
			.from('lib_items')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating item:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Item not found' }, { status: 404 })
			}
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Barcode already exists' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating item:', error)
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

		const { error } = await supabase.from('lib_items').delete().eq('id', id)

		if (error) {
			console.error('Error deleting item:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — item has associated lending transactions or holds' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting item:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
