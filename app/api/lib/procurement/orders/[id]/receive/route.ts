import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id: orderId } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		// body.received_items = Array<{ procurement_item_id, quantity_received, location_id?, condition?, invoice_number? }>
		const { institution_id, received_items, received_by, invoice_number, date_received } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!received_items || !Array.isArray(received_items) || received_items.length === 0) {
			return NextResponse.json({ error: 'received_items array is required' }, { status: 400 })
		}

		// Fetch the order
		const { data: order, error: orderError } = await supabase
			.from('lib_procurement_orders')
			.select('*, items:lib_procurement_items(*)')
			.eq('id', orderId)
			.single()

		if (orderError || !order) {
			return NextResponse.json({ error: 'Procurement order not found' }, { status: 404 })
		}
		if (order.order_status === 'cancelled') {
			return NextResponse.json({ error: 'Cannot receive against a cancelled order' }, { status: 400 })
		}

		const createdItems: unknown[] = []
		const year = new Date().getFullYear()

		// Get current item count for accession number generation
		const { count: existingCount } = await supabase
			.from('lib_items')
			.select('*', { count: 'exact', head: true })
			.eq('institution_id', institution_id)

		let accessionCounter = (existingCount ?? 0)

		for (const receivedItem of received_items) {
			const { procurement_item_id, quantity_received, location_id, condition, catalogue_record_id } = receivedItem

			if (!procurement_item_id || !quantity_received) continue

			// Find the procurement line item
			const procItem = order.items?.find(
				(i: { id: string }) => i.id === procurement_item_id
			)
			if (!procItem) continue

			const effectiveCatalogueId = catalogue_record_id ?? procItem.catalogue_record_id

			// Create lib_items for each copy received
			for (let copy = 1; copy <= quantity_received; copy++) {
				accessionCounter++
				const seq = String(accessionCounter).padStart(5, '0')
				const accessionNumber = `ACC/${year}/${seq}`

				const { data: newItem, error: itemError } = await supabase
					.from('lib_items')
					.insert({
						institution_id,
						catalogue_record_id: effectiveCatalogueId,
						location_id: location_id ?? null,
						accession_number: accessionNumber,
						condition: condition ?? 'new',
						price: procItem.unit_price ?? null,
						invoice_cost: procItem.net_price ?? null,
						currency_code: order.currency_code ?? 'INR',
						procurement_item_id,
						supplier_id: order.supplier_id,
						date_received: date_received ?? new Date().toISOString().split('T')[0],
						invoice_number: invoice_number ?? procItem.invoice_number ?? null,
						status: 'available',
						is_lendable: true,
						is_active: true,
						accession_date: date_received ?? new Date().toISOString().split('T')[0],
						created_by: received_by ?? null,
					})
					.select()
					.single()

				if (!itemError && newItem) {
					createdItems.push(newItem)
				}
			}

			// Update procurement item quantity_received and status
			const newQtyReceived = (procItem.quantity_received ?? 0) + quantity_received
			const newItemStatus = newQtyReceived >= procItem.quantity_ordered ? 'received' : 'pending'

			await supabase
				.from('lib_procurement_items')
				.update({
					quantity_received: newQtyReceived,
					item_status: newItemStatus,
				})
				.eq('id', procurement_item_id)
		}

		// Update order status
		const { data: allItems } = await supabase
			.from('lib_procurement_items')
			.select('item_status')
			.eq('order_id', orderId)

		const allReceived = (allItems ?? []).every((i: { item_status: string }) => i.item_status === 'received')
		const anyReceived = (allItems ?? []).some((i: { item_status: string }) => i.item_status === 'received')

		const newOrderStatus = allReceived
			? 'received'
			: anyReceived
				? 'partially_received'
				: order.order_status

		// Update budget spent_amount
		if (order.budget_head_id && createdItems.length > 0) {
			const totalReceived = received_items.reduce(
				(sum: number, ri: { procurement_item_id?: string; quantity_received: number }) => {
					const procItem = order.items?.find((i: { id: string }) => i.id === ri.procurement_item_id)
					return sum + (ri.quantity_received * (procItem?.unit_price ?? 0))
				}, 0)

			const { data: budgetHead } = await supabase
				.from('lib_budget_heads')
				.select('spent_amount, committed_amount')
				.eq('id', order.budget_head_id)
				.single()

			if (budgetHead) {
				await supabase
					.from('lib_budget_heads')
					.update({
						spent_amount: (budgetHead.spent_amount ?? 0) + totalReceived,
						committed_amount: Math.max(0, (budgetHead.committed_amount ?? 0) - totalReceived),
						updated_at: new Date().toISOString(),
					})
					.eq('id', order.budget_head_id)
			}
		}

		const { data: updatedOrder } = await supabase
			.from('lib_procurement_orders')
			.update({
				order_status: newOrderStatus,
				updated_at: new Date().toISOString(),
			})
			.eq('id', orderId)
			.select()
			.single()

		return NextResponse.json({
			success: true,
			order: updatedOrder,
			items_created: createdItems.length,
			created_items: createdItems,
		})
	} catch (error) {
		console.error('Unexpected error receiving order items:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
