/**
 * Taking back what the desk just did: POST /api/lib/circulation/undo
 *
 * Body: { institution_id, transaction_id, action: 'issue' | 'return' | 'renew', previous_due_date? }
 *
 * The wrong book gets scanned for the learner still standing at the counter,
 * and the honest fix is to make it as if it had not happened — not a return
 * that leaves a loan of thirty seconds on their record, and not a fine for a
 * book that never left. So:
 *
 *   * An issue is deleted, not returned. The copy goes back to available (or
 *     back on hold, if this issue had fulfilled one), and no loan remains.
 *   * A return is reopened. The loan is active again, the copy is on loan
 *     again, the charge the return raised is removed, and a hold the return
 *     passed the copy to goes back to waiting.
 *   * A renewal is rolled back to the due date it had before.
 *
 * Only within a short window of the action itself, only on a loan that has
 * not moved on since, and only within the caller's own college. An issue that
 * already has a return against it, a return whose copy has since gone out
 * again, or a charge somebody has already paid, is refused with the reason.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { setDelinquent } from '@/lib/library/borrower'

/**
 * A little longer than the two minutes the desk offers, so a click at the end
 * of the window is not refused for the time the request took to arrive.
 */
const SERVER_WINDOW_MS = 3 * 60 * 1000

/** Writes made by the same action land within this of each other. */
const SAME_ACTION_SLACK_MS = 10 * 1000

const isoBefore = (iso: string, ms: number) => new Date(new Date(iso).getTime() - ms).toISOString()

const withinWindow = (iso: string | null | undefined) =>
	!!iso && Date.now() - new Date(iso).getTime() <= SERVER_WINDOW_MS

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		const transactionId: string = body.transaction_id ?? ''
		const action: string = body.action ?? ''

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!transactionId) {
			return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 })
		}
		if (action !== 'issue' && action !== 'return' && action !== 'renew') {
			return NextResponse.json({ error: "action must be 'issue', 'return' or 'renew'" }, { status: 400 })
		}

		const { data: transaction } = await supabase
			.from('lib_lending_transactions')
			.select('*')
			.eq('id', transactionId)
			.eq('institution_id', institutionId)
			.maybeSingle()

		if (!transaction) {
			return NextResponse.json({ error: 'That loan is not in this library' }, { status: 404 })
		}

		const now = new Date().toISOString()
		const open = transaction.transaction_status === 'active' || transaction.transaction_status === 'overdue'

		// ── Issue ───────────────────────────────────────────────────────────
		if (action === 'issue') {
			if (!open || transaction.returned_at) {
				return NextResponse.json({ error: 'This loan has already been returned — nothing to take back' }, { status: 400 })
			}
			if ((transaction.renewal_count ?? 0) > 0) {
				return NextResponse.json({ error: 'This loan has been renewed since — it is no longer a fresh issue' }, { status: 400 })
			}
			if (!withinWindow(transaction.issued_at)) {
				return NextResponse.json({ error: 'Too late to take this issue back — return the book instead' }, { status: 400 })
			}

			// A hold this issue fulfilled goes back to waiting for collection, and
			// the copy back to being held for them; otherwise the copy is free.
			const { data: fulfilled } = await supabase
				.from('lib_resource_holds')
				.select('id')
				.eq('member_id', transaction.member_id)
				.eq('item_id', transaction.item_id)
				.eq('hold_status', 'fulfilled')
				.gte('checked_out_at', isoBefore(transaction.issued_at, SAME_ACTION_SLACK_MS))
				.order('checked_out_at', { ascending: false })
				.limit(1)
				.maybeSingle()

			const { error: deleteError } = await supabase
				.from('lib_lending_transactions')
				.delete()
				.eq('id', transaction.id)

			if (deleteError) {
				console.error('Error deleting loan on undo:', deleteError)
				return NextResponse.json({ error: 'Could not take the issue back' }, { status: 500 })
			}

			await Promise.all([
				supabase
					.from('lib_items')
					.update({ status: fulfilled ? 'on_hold' : 'available', updated_at: now })
					.eq('id', transaction.item_id),
				fulfilled
					? supabase
						.from('lib_resource_holds')
						.update({ hold_status: 'available', checked_out_at: null, updated_at: now })
						.eq('id', fulfilled.id)
					: Promise.resolve(),
				logActivity(request, {
					action: 'delete',
					resource_type: 'loan',
					resource_id: '/circulation',
					institution_id: institutionId,
					old_values: transaction,
					metadata: { undo: 'issue', transaction_id: transaction.id, item_id: transaction.item_id, member_id: transaction.member_id },
				}),
			])

			return NextResponse.json({ success: true, action, transaction: null })
		}

		// ── Return ──────────────────────────────────────────────────────────
		if (action === 'return') {
			if (transaction.transaction_status !== 'returned' || !transaction.returned_at) {
				return NextResponse.json({ error: 'This loan is still open — there is no return to take back' }, { status: 400 })
			}
			if (!withinWindow(transaction.returned_at)) {
				return NextResponse.json({ error: 'Too late to take this return back — issue the book again instead' }, { status: 400 })
			}

			// Since the return: has the copy gone out again, and did the return
			// raise a charge that somebody has already paid? Both are asked
			// together — neither depends on the other.
			const [{ data: laterLoan }, { data: charges }] = await Promise.all([
				supabase
					.from('lib_lending_transactions')
					.select('id')
					.eq('item_id', transaction.item_id)
					.in('transaction_status', ['active', 'overdue'])
					.gt('issued_at', transaction.returned_at)
					.limit(1)
					.maybeSingle(),
				supabase
					.from('lib_late_charges')
					.select('id, payment_status, net_payable')
					.eq('transaction_id', transaction.id)
					.gte('created_at', isoBefore(transaction.returned_at, SAME_ACTION_SLACK_MS)),
			])

			if (laterLoan) {
				return NextResponse.json({ error: 'This copy has already been issued again — the return stands' }, { status: 400 })
			}
			const paid = (charges ?? []).find(c => c.payment_status === 'paid' || c.payment_status === 'partial')
			if (paid) {
				return NextResponse.json({ error: 'Money has already been collected on this return — settle it from Late Charges instead' }, { status: 400 })
			}

			const overdue = transaction.due_date < now.slice(0, 10)

			const { data: reopened, error: reopenError } = await supabase
				.from('lib_lending_transactions')
				.update({
					transaction_status: overdue ? 'overdue' : 'active',
					returned_at: null,
					returned_by: null,
					return_condition: null,
					updated_at: now,
				})
				.eq('id', transaction.id)
				.select()
				.single()

			if (reopenError) {
				console.error('Error reopening loan on undo:', reopenError)
				return NextResponse.json({ error: 'Could not take the return back' }, { status: 500 })
			}

			const chargeIds = (charges ?? []).map(c => c.id)

			await Promise.all([
				supabase
					.from('lib_items')
					.update({ status: 'on_loan', updated_at: now })
					.eq('id', transaction.item_id),
				// A hold the return handed this copy to goes back to the queue
				supabase
					.from('lib_resource_holds')
					.update({ hold_status: 'pending', item_id: null, notified_at: null, updated_at: now })
					.eq('item_id', transaction.item_id)
					.eq('hold_status', 'available')
					.gte('notified_at', isoBefore(transaction.returned_at, SAME_ACTION_SLACK_MS)),
				chargeIds.length > 0
					? supabase.from('lib_late_charges').delete().in('id', chargeIds)
					: Promise.resolve(),
			])

			// With the charge gone, the member may owe nothing any more
			if (chargeIds.length > 0) {
				const { count } = await supabase
					.from('lib_late_charges')
					.select('*', { count: 'exact', head: true })
					.eq('member_id', transaction.member_id)
					.in('payment_status', ['unpaid', 'partial'])
				if ((count ?? 0) === 0) await setDelinquent(supabase, transaction.member_id, false)
			}

			await logActivity(request, {
				action: 'update',
				resource_type: 'loan',
				resource_id: '/circulation',
				institution_id: institutionId,
				old_values: transaction,
				new_values: reopened,
				metadata: { undo: 'return', transaction_id: transaction.id, charges_removed: chargeIds.length },
			})

			return NextResponse.json({ success: true, action, transaction: reopened })
		}

		// ── Renew ───────────────────────────────────────────────────────────
		if (!open) {
			return NextResponse.json({ error: 'This loan has been returned — there is no renewal to take back' }, { status: 400 })
		}
		if ((transaction.renewal_count ?? 0) < 1 || !withinWindow(transaction.last_renewed_at)) {
			return NextResponse.json({ error: 'Too late to take this renewal back' }, { status: 400 })
		}

		// The due date before the renewal is not kept on the row, so the desk
		// sends back what the loan said before it pressed Renew. It is checked
		// rather than trusted: a real earlier date, no later than the one now.
		const previous = String(body.previous_due_date ?? '').slice(0, 10)
		if (!/^\d{4}-\d{2}-\d{2}$/.test(previous) || Number.isNaN(new Date(previous).getTime())) {
			return NextResponse.json({ error: 'previous_due_date is required to take a renewal back' }, { status: 400 })
		}
		if (previous > transaction.due_date) {
			return NextResponse.json({ error: 'previous_due_date cannot be after the current due date' }, { status: 400 })
		}

		const { data: rolledBack, error: rollbackError } = await supabase
			.from('lib_lending_transactions')
			.update({
				due_date: previous,
				renewal_count: transaction.renewal_count - 1,
				last_renewed_at: transaction.renewal_count - 1 === 0 ? null : transaction.last_renewed_at,
				updated_at: now,
			})
			.eq('id', transaction.id)
			.select()
			.single()

		if (rollbackError) {
			console.error('Error rolling back renewal on undo:', rollbackError)
			return NextResponse.json({ error: 'Could not take the renewal back' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'loan',
			resource_id: '/circulation',
			institution_id: institutionId,
			old_values: transaction,
			new_values: rolledBack,
			metadata: { undo: 'renew', transaction_id: transaction.id, due_date: previous },
		})

		return NextResponse.json({ success: true, action, transaction: rolledBack })
	} catch (error) {
		console.error('Unexpected error taking a desk action back:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
