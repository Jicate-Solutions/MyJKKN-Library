import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		const { institution_id, item_id, returned_by, return_condition, waive_charge } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!item_id) {
			return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
		}

		// 1. Find the active lending transaction for this item
		const { data: transaction, error: txError } = await supabase
			.from('lib_lending_transactions')
			.select('*')
			.eq('item_id', item_id)
			.eq('institution_id', institution_id)
			.in('transaction_status', ['active', 'overdue'])
			.order('issued_at', { ascending: false })
			.limit(1)
			.single()

		if (txError || !transaction) {
			return NextResponse.json(
				{ error: 'No active lending transaction found for this item' },
				{ status: 404 }
			)
		}

		const now = new Date()
		const today = now.toISOString().split('T')[0]
		const dueDate = new Date(transaction.due_date)
		const returnDate = new Date(today)

		// 2. Calculate overdue days
		const overdueDays = Math.max(
			0,
			Math.floor((returnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
		)

		let chargeRecord = null

		// 3. Create late charge if overdue and not waiving upfront
		if (overdueDays > 0) {
			// Get charge rate from member category
			const { data: member } = await supabase
				.from('lib_members')
				.select('member_category')
				.eq('id', transaction.member_id)
				.single()

			const { data: categoryConfig } = await supabase
				.from('lib_member_categories')
				.select('late_charge_per_day')
				.eq('institution_id', institution_id)
				.eq('category_code', member?.member_category ?? '')
				.maybeSingle()

			const chargePerDay = categoryConfig?.late_charge_per_day ?? 1.0
			const totalCharge = overdueDays * chargePerDay
			const waiverAmount = waive_charge ? totalCharge : 0
			const netPayable = totalCharge - waiverAmount

			const { data: charge, error: chargeError } = await supabase
				.from('lib_late_charges')
				.insert({
					institution_id,
					transaction_id: transaction.id,
					member_id: transaction.member_id,
					overdue_days: overdueDays,
					charge_per_day: chargePerDay,
					total_charge: totalCharge,
					waiver_amount: waiverAmount,
					net_payable: netPayable,
					payment_status: waive_charge ? 'waived' : 'unpaid',
					waiver_reason: waive_charge ? (body.waiver_reason ?? 'Waived at return') : null,
					waiver_approved_by: waive_charge ? (returned_by ?? null) : null,
				})
				.select()
				.single()

			if (chargeError) {
				console.error('Error creating late charge:', chargeError)
			} else {
				chargeRecord = charge

				// Mark member delinquent if there is a net payable amount
				if (netPayable > 0) {
					await supabase
						.from('lib_members')
						.update({ is_delinquent: true, updated_at: new Date().toISOString() })
						.eq('id', transaction.member_id)
				}
			}
		}

		// 4. Update lending transaction — mark returned
		const { data: updatedTx, error: updateError } = await supabase
			.from('lib_lending_transactions')
			.update({
				returned_at: now.toISOString(),
				returned_by: returned_by ?? null,
				return_condition: return_condition ?? null,
				transaction_status: 'returned',
				updated_at: now.toISOString(),
			})
			.eq('id', transaction.id)
			.select()
			.single()

		if (updateError) {
			console.error('Error updating transaction on return:', updateError)
			return NextResponse.json({ error: 'Failed to record return' }, { status: 500 })
		}

		// 5. Update item status to available
		const newCondition = return_condition ?? undefined
		const { error: itemError } = await supabase
			.from('lib_items')
			.update({
				status: 'available',
				...(newCondition ? { condition: newCondition } : {}),
				updated_at: now.toISOString(),
			})
			.eq('id', item_id)

		if (itemError) {
			console.error('Error updating item status on return:', itemError)
			return NextResponse.json({ error: 'Failed to update item status' }, { status: 500 })
		}

		// 6. Check for pending holds on this catalogue record and notify
		const { data: item } = await supabase
			.from('lib_items')
			.select('catalogue_record_id')
			.eq('id', item_id)
			.single()

		if (item?.catalogue_record_id) {
			const { data: pendingHold } = await supabase
				.from('lib_resource_holds')
				.select('id, member_id')
				.eq('catalogue_record_id', item.catalogue_record_id)
				.eq('hold_status', 'pending')
				.order('hold_placed_at', { ascending: true })
				.limit(1)
				.maybeSingle()

			if (pendingHold) {
				await supabase
					.from('lib_resource_holds')
					.update({
						hold_status: 'available',
						item_id,
						notified_at: now.toISOString(),
						updated_at: now.toISOString(),
					})
					.eq('id', pendingHold.id)

				await supabase
					.from('lib_items')
					.update({ status: 'on_hold', updated_at: now.toISOString() })
					.eq('id', item_id)
			}
		}

		return NextResponse.json({
			success: true,
			transaction: updatedTx,
			overdue_days: overdueDays,
			late_charge: chargeRecord,
		})
	} catch (error) {
		console.error('Unexpected error during return:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
