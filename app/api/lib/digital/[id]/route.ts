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
			.from('lib_digital_resources')
			.select('*')
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Digital resource not found' }, { status: 404 })
			}
			console.error('Error fetching digital resource:', error)
			return NextResponse.json({ error: 'Failed to fetch digital resource' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching digital resource:', error)
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

		delete body.id
		delete body.institution_id
		delete body.created_at

		const { data, error } = await supabase
			.from('lib_digital_resources')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating digital resource:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Digital resource not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update digital resource' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating digital resource:', error)
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

		const { error } = await supabase.from('lib_digital_resources').delete().eq('id', id)

		if (error) {
			console.error('Error deleting digital resource:', error)
			return NextResponse.json({ error: 'Failed to delete digital resource' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting digital resource:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
