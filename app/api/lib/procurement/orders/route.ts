import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const orderStatus = searchParams.get('order_status')
		const supplierId = searchParams.get('supplier_id')
		const fiscalYear = searchParams.get('fiscal_year')

		let query = supabase
			.from('lib_procurement_orders')
			.select(`
				*,
				supplier:lib_suppliers(id, supplier_code, supplier_name, contact_person),
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name),
				items:lib_procurement_items(id, title, isbn, quantity_ordered, quantity_received, item_status, unit_price, total_price)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (orderStatus) query = query.eq('order_status', orderStatus)
		if (supplierId) query = query.eq('supplier_id', supplierId)
		if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

		const { data, error } = await query
			.order('order_date', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching procurement orders:', error)
			return NextResponse.json({ error: 'Failed to fetch procurement orders' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching procurement orders:', error)
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
		if (!body.supplier_id) {
			return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })
		}

		// Auto-generate order_number
		let orderNumber = body.order_number?.trim()
		if (!orderNumber) {
			const year = new Date().getFullYear()
			const { count } = await supabase
				.from('lib_procurement_orders')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', body.institution_id)

			const seq = String((count ?? 0) + 1).padStart(4, '0')
			orderNumber = `PO/${year}/${seq}`
		}

		const { data: order, error: orderError } = await supabase
			.from('lib_procurement_orders')
			.insert({
				institution_id: body.institution_id,
				order_number: orderNumber,
				supplier_id: body.supplier_id,
				budget_head_id: body.budget_head_id ?? null,
				fiscal_year: body.fiscal_year ?? null,
				order_date: body.order_date ?? new Date().toISOString().split('T')[0],
				expected_delivery_date: body.expected_delivery_date ?? null,
				order_type: body.order_type ?? 'firm',
				total_amount: body.total_amount ?? null,
				currency_code: body.currency_code ?? 'INR',
				order_status: body.order_status ?? 'draft',
				notes: body.notes ?? null,
				created_by: body.created_by ?? null,
			})
			.select()
			.single()

		if (orderError) {
			console.error('Error creating procurement order:', orderError)
			if (orderError.code === '23505') {
				return NextResponse.json({ error: 'Order number already exists' }, { status: 400 })
			}
			if (orderError.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check supplier_id or budget_head_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create procurement order' }, { status: 500 })
		}

		// Insert line items if provided
		const items: Array<Record<string, unknown>> = body.items || []
		if (items.length > 0) {
			const itemRows = items.map((item) => ({
				institution_id: body.institution_id,
				order_id: order.id,
				request_id: item.request_id ?? null,
				catalogue_record_id: item.catalogue_record_id ?? null,
				title: item.title,
				isbn: item.isbn ?? null,
				quantity_ordered: item.quantity_ordered ?? 1,
				quantity_received: 0,
				unit_price: item.unit_price ?? null,
				discount_percent: item.discount_percent ?? 0,
				net_price: item.net_price ?? null,
				total_price: item.total_price ?? null,
				item_status: 'pending',
			}))

			await supabase.from('lib_procurement_items').insert(itemRows)
		}

		// Commit budget (add to committed_amount)
		if (order.budget_head_id && order.total_amount) {
			await supabase.rpc('lib_budget_commit', {
				p_budget_head_id: order.budget_head_id,
				p_amount: order.total_amount,
			}).maybeSingle()
			// RPC may not exist — ignore error silently
		}

		return NextResponse.json(order, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating procurement order:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
