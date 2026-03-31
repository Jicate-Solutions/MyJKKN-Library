import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

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

		// Check renewal limit from member category config
		const { data: member } = await supabase
			.from('lib_members')
			.select('member_category, is_delinquent')
			.eq('id', transaction.member_id)
			.single()

		if (member?.is_delinquent) {
			return NextResponse.json(
				{ error: 'Renewal denied — member has unpaid late charges' },
				{ status: 400 }
			)
		}

		const { data: categoryConfig } = await supabase
			.from('lib_member_categories')
			.select('renewal_limit, renewal_period_days')
			.eq('institution_id', institution_id)
			.eq('category_code', member?.member_category ?? '')
			.maybeSingle()

		const renewalLimit = categoryConfig?.renewal_limit ?? 2
		const renewalPeriodDays = body.renewal_period_days ?? categoryConfig?.renewal_period_days ?? 7

		if (transaction.renewal_count >= renewalLimit) {
			return NextResponse.json(
				{ error: `Renewal limit of ${renewalLimit} reached for this item` },
				{ status: 400 }
			)
		}

		// Check if there is a pending hold on this catalogue record — cannot renew if others are waiting
		const { data: item } = await supabase
			.from('lib_items')
			.select('catalogue_record_id')
			.eq('id', transaction.item_id)
			.single()

		if (item?.catalogue_record_id) {
			const { count: holdCount } = await supabase
				.from('lib_resource_holds')
				.select('*', { count: 'exact', head: true })
				.eq('catalogue_record_id', item.catalogue_record_id)
				.eq('hold_status', 'pending')

			if ((holdCount ?? 0) > 0) {
				return NextResponse.json(
					{ error: 'Cannot renew — other members are waiting for this resource' },
					{ status: 400 }
				)
			}
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

		return NextResponse.json({
			success: true,
			transaction: updated,
			new_due_date: newDueDateStr,
			renewals_remaining: renewalLimit - updated.renewal_count,
		})
	} catch (error) {
		console.error('Unexpected error during renewal:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
