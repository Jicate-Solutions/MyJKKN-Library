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
			.from('lib_suppliers')
			.select('*')
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
			}
			console.error('Error fetching supplier:', error)
			return NextResponse.json({ error: 'Failed to fetch supplier' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching supplier:', error)
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
		delete body.supplier_code
		delete body.created_at

		const { data, error } = await supabase
			.from('lib_suppliers')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating supplier:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update supplier' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating supplier:', error)
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

		const { error } = await supabase.from('lib_suppliers').delete().eq('id', id)

		if (error) {
			console.error('Error deleting supplier:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — supplier is linked to procurement orders or subscriptions' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete supplier' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting supplier:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
