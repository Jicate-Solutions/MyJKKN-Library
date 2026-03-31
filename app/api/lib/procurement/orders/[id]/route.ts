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
			.from('lib_procurement_orders')
			.select(`
				*,
				supplier:lib_suppliers(id, supplier_code, supplier_name, contact_person, email, phone),
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name, fiscal_year, allocated_amount, spent_amount, committed_amount),
				items:lib_procurement_items(
					id,
					title,
					isbn,
					quantity_ordered,
					quantity_received,
					unit_price,
					discount_percent,
					net_price,
					total_price,
					item_status,
					catalogue_record_id
				)
			`)
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Procurement order not found' }, { status: 404 })
			}
			console.error('Error fetching procurement order:', error)
			return NextResponse.json({ error: 'Failed to fetch procurement order' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching procurement order:', error)
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

		const allowedStatuses = ['draft', 'placed', 'acknowledged', 'partially_received', 'received', 'cancelled', 'claimed']
		if (body.order_status && !allowedStatuses.includes(body.order_status)) {
			return NextResponse.json(
				{ error: `Invalid order_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		delete body.id
		delete body.institution_id
		delete body.order_number
		delete body.created_at
		delete body.created_by
		delete body.items

		const { data, error } = await supabase
			.from('lib_procurement_orders')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating procurement order:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Procurement order not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update procurement order' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating procurement order:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
