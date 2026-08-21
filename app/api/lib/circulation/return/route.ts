import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { getInstitutionSettings, chargeableLateDays, capFine } from '@/lib/library/institution-settings'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const { institution_id, item_id, transaction_id, returned_by, return_condition, waive_charge } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		// A return is identified either by the book scanned at the desk or by the
		// loan picked from the member's list. Both name the same loan, so accept
		// either — the desk sends the loan id, the scanner sends the item.
		if (!item_id && !transaction_id) {
			return NextResponse.json(
				{ error: 'Scan the book, or pick the loan to return' },
				{ status: 400 }
			)
		}

		// 1. Find the open loan
		let lookup = supabase
			.from('lib_lending_transactions')
			.select('*')
			.eq('institution_id', institution_id)
			.in('transaction_status', ['active', 'overdue'])

		lookup = transaction_id
			? lookup.eq('id', transaction_id)
			: lookup.eq('item_id', item_id)

		const { data: transactions, error: txError } = await lookup
			.order('issued_at', { ascending: false })
			.limit(1)

		const transaction = transactions?.[0]

		if (txError || !transaction) {
			return NextResponse.json(
				{ error: 'This copy is not on loan — nothing to return' },
				{ status: 404 }
			)
		}

		// Take the copy from the loan, not from the request: when the desk sends
		// a transaction_id there is no item_id in the body at all.
		const returnedItemId: string = transaction.item_id

		const now = new Date()
		const today = now.toISOString().split('T')[0]

		// 2. Calculate chargeable days using this campus's own rules — grace
		// period and whether Sundays count both vary by institution.
		const settings = await getInstitutionSettings(institution_id)
		const overdueDays = chargeableLateDays(transaction.due_date, today, settings)

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
			// A librarian can override the amount by hand — college holidays we
			// have no calendar for are exactly why that is needed.
			const computed = capFine(overdueDays * chargePerDay, settings)
			const totalCharge = body.override_charge !== undefined
				? Math.max(0, Number(body.override_charge))
				: computed
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

		// 4 and 5. Mark the loan returned and the copy available.
		//
		// Neither update needs the other's answer — both are writing values
		// already in hand — so they go together rather than one after the other.
		// The item update asks for `catalogue_record_id` back, which is the value
		// step 6 used to fetch in a third round trip of its own.
		const newCondition = return_condition ?? undefined
		const [
			{ data: updatedTx, error: updateError },
			{ data: updatedItem, error: itemError },
		] = await Promise.all([
			supabase
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
				.single(),
			supabase
				.from('lib_items')
				.update({
					status: 'available',
					...(newCondition ? { condition: newCondition } : {}),
					updated_at: now.toISOString(),
				})
				.eq('id', returnedItemId)
				.select('catalogue_record_id')
				.single(),
		])

		if (updateError) {
			console.error('Error updating transaction on return:', updateError)
			return NextResponse.json({ error: 'Failed to record return' }, { status: 500 })
		}

		if (itemError) {
			console.error('Error updating item status on return:', itemError)
			return NextResponse.json({ error: 'Failed to update item status' }, { status: 500 })
		}

		// 6. Check for pending holds on this catalogue record and notify
		const item = updatedItem

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
						item_id: returnedItemId,
						notified_at: now.toISOString(),
						updated_at: now.toISOString(),
					})
					.eq('id', pendingHold.id)

				await supabase
					.from('lib_items')
					.update({ status: 'on_hold', updated_at: now.toISOString() })
					.eq('id', returnedItemId)
			}
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'loan',
			resource_id: '/circulation',
			institution_id,
			new_values: updatedTx,
			metadata: {
				returned: true,
				transaction_id: updatedTx?.id ?? transaction_id ?? null,
				overdue_days: overdueDays,
				late_charge: chargeRecord?.charge_amount ?? 0,
			},
		})

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
