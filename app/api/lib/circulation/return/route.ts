import { NextResponse, after } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { loanFineStatus, fineUnpaidMessage } from '@/lib/library/late-fine'
import { notifyLoan } from '@/lib/library/myjkkn-notify'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const { institution_id, item_id, transaction_id, returned_by, return_condition } = body

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

		// The loan and this campus's fine rules are two questions that do not
		// depend on each other, so they are asked together — the rules used to
		// wait behind the loan for nothing, with the book on the counter.
		const [{ data: transactions, error: txError }, settings] = await Promise.all([
			lookup
				.order('issued_at', { ascending: false })
				.limit(1),
			getInstitutionSettings(institution_id),
		])

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

		// 2 and 3. The fine, by this campus's own rules — grace period, Sundays,
		// the per-day rate and the cap all vary by institution — and it has to
		// be cleared already.
		//
		// A late return used to go through and leave an unpaid charge behind, to
		// be chased afterwards; now the fine is marked Paid or Waived at the desk
		// first (POST /api/lib/circulation/settle) and the book comes back after.
		// No charge is written here any more: the one that settled the fine is
		// the charge, and it is what the desk shows as collected or waived.
		const fineStatus = await loanFineStatus(supabase, transaction, institution_id, settings, today)
		const overdueDays = fineStatus.fine.overdue_days

		if (fineStatus.due > 0) {
			return NextResponse.json(
				{
					error: fineUnpaidMessage(fineStatus, 'returned'),
					reason: 'fine_unpaid',
					fine: fineStatus.fine,
					due: fineStatus.due,
				},
				{ status: 400 }
			)
		}

		const chargeRecord = fineStatus.lastSettled

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

		// 6. Hand the copy to whoever is next in the queue, if anyone is.
		//
		// Once the head of the queue is known, marking their hold available and
		// putting the copy aside for them are two writes that do not need each
		// other's answer — so they go together. The log line does not need any of
		// this, so it goes alongside the whole block rather than after it.
		const item = updatedItem

		const passToNextInQueue = async () => {
			if (!item?.catalogue_record_id) return

			const { data: pendingHold } = await supabase
				.from('lib_resource_holds')
				.select('id, member_id')
				.eq('catalogue_record_id', item.catalogue_record_id)
				.eq('hold_status', 'pending')
				.order('hold_placed_at', { ascending: true })
				.limit(1)
				.maybeSingle()

			if (!pendingHold) return

			await Promise.all([
				supabase
					.from('lib_resource_holds')
					.update({
						hold_status: 'available',
						item_id: returnedItemId,
						notified_at: now.toISOString(),
						updated_at: now.toISOString(),
					})
					.eq('id', pendingHold.id),

				supabase
					.from('lib_items')
					.update({ status: 'on_hold', updated_at: now.toISOString() })
					.eq('id', returnedItemId),
			])
		}

		await Promise.all([passToNextInQueue(), logActivity(request, {
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
		})])

		// MyJKKN bell and push, after the reply — see the issue route
		after(() => notifyLoan('returned', transaction.id))

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
