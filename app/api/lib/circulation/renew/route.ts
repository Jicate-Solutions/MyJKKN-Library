import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const { institution_id, transaction_id, item_id, member_id } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		// Find transaction by id, item_id, or member+item combo
		let transactionQuery = supabase
			.from('lib_lending_transactions')
			.select('*')
			.eq('institution_id', institution_id)
			.in('transaction_status', ['active', 'overdue'])

		if (transaction_id) {
			transactionQuery = transactionQuery.eq('id', transaction_id)
		} else if (item_id && member_id) {
			transactionQuery = transactionQuery.eq('item_id', item_id).eq('member_id', member_id)
		} else if (item_id) {
			transactionQuery = transactionQuery.eq('item_id', item_id)
		} else {
			return NextResponse.json(
				{ error: 'Provide transaction_id, or item_id (+ optional member_id)' },
				{ status: 400 }
			)
		}

		const { data: transaction, error: txError } = await transactionQuery
			.order('issued_at', { ascending: false })
			.limit(1)
			.single()

		if (txError || !transaction) {
			return NextResponse.json({ error: 'Active transaction not found' }, { status: 404 })
		}

		// Who borrowed it and which copy it is: both hang off the loan and
		// neither waits on the other, so they are read together rather than one
		// after the other with the desk watching.
		const [{ data: member }, { data: item }] = await Promise.all([
			supabase
				.from('lib_borrowers')
				.select('member_category, is_delinquent')
				.eq('id', transaction.member_id)
				.single(),
			supabase
				.from('lib_items')
				.select('catalogue_record_id')
				.eq('id', transaction.item_id)
				.single(),
		])

		if (member?.is_delinquent) {
			return NextResponse.json(
				{ error: 'Renewal denied — member has unpaid late charges' },
				{ status: 400 }
			)
		}

		// The renewal allowance and the queue for this title are likewise
		// independent of each other, so they go together too. Whether the
		// allowance or the queue is the reason for a refusal is decided below,
		// in the same order as before.
		const [{ data: categoryConfig }, { count: holdCount }] = await Promise.all([
			supabase
				.from('lib_member_categories')
				.select('renewal_limit, renewal_period_days')
				.eq('institution_id', institution_id)
				.eq('category_code', member?.member_category ?? '')
				.maybeSingle(),
			item?.catalogue_record_id
				? supabase
						.from('lib_resource_holds')
						.select('*', { count: 'exact', head: true })
						.eq('catalogue_record_id', item.catalogue_record_id)
						.eq('hold_status', 'pending')
				: Promise.resolve({ count: 0 }),
		])

		const renewalLimit = categoryConfig?.renewal_limit ?? 2
		const renewalPeriodDays = body.renewal_period_days ?? categoryConfig?.renewal_period_days ?? 7

		if (transaction.renewal_count >= renewalLimit) {
			return NextResponse.json(
				{ error: `Renewal limit of ${renewalLimit} reached for this item` },
				{ status: 400 }
			)
		}

		// Others waiting for this title? Then it cannot be renewed. Counted above.
		if ((holdCount ?? 0) > 0) {
			return NextResponse.json(
				{ error: 'Cannot renew — other members are waiting for this resource' },
				{ status: 400 }
			)
		}

		// Compute new due_date from current due_date or today, whichever is later
		const baseDateStr = transaction.due_date
		const baseDate = new Date(baseDateStr) > new Date()
			? new Date(baseDateStr)
			: new Date()

		const newDueDate = new Date(baseDate)
		newDueDate.setDate(baseDate.getDate() + renewalPeriodDays)
		const newDueDateStr = newDueDate.toISOString().split('T')[0]

		const { data: updated, error: updateError } = await supabase
			.from('lib_lending_transactions')
			.update({
				due_date: newDueDateStr,
				renewal_count: transaction.renewal_count + 1,
				last_renewed_at: new Date().toISOString(),
				transaction_status: 'active',
				updated_at: new Date().toISOString(),
			})
			.eq('id', transaction.id)
			.select()
			.single()

		if (updateError) {
			console.error('Error renewing transaction:', updateError)
			return NextResponse.json({ error: 'Failed to renew' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'loan',
			resource_id: '/circulation',
			institution_id,
			new_values: updated,
			metadata: {
				renewed: true,
				transaction_id: updated?.id ?? transaction_id ?? null,
				new_due_date: newDueDateStr,
				renewal_count: updated?.renewal_count,
			},
		})

		return NextResponse.json({
			success: true,
			transaction: updated,
			new_due_date: newDueDateStr,
			// What it was due before, which is what taking the renewal back restores
			previous_due_date: transaction.due_date,
			renewals_remaining: renewalLimit - updated.renewal_count,
		})
	} catch (error) {
		console.error('Unexpected error during renewal:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
