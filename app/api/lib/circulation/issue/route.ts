import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		const { institution_id, item_id, member_id, issued_by } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!item_id) {
			return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
		}
		if (!member_id) {
			return NextResponse.json({ error: 'member_id is required' }, { status: 400 })
		}

		// 1. Check item exists and is available
		const { data: item, error: itemError } = await supabase
			.from('lib_items')
			.select('id, status, is_lendable, institution_id, catalogue_record_id')
			.eq('id', item_id)
			.single()

		if (itemError || !item) {
			return NextResponse.json({ error: 'Item not found' }, { status: 404 })
		}
		if (item.institution_id !== institution_id) {
			return NextResponse.json({ error: 'Item does not belong to this institution' }, { status: 400 })
		}
		if (item.status !== 'available') {
			return NextResponse.json(
				{ error: `Item is not available for lending — current status: ${item.status}` },
				{ status: 400 }
			)
		}
		if (!item.is_lendable) {
			return NextResponse.json({ error: 'Item is marked as non-lendable (reference only)' }, { status: 400 })
		}

		// 2. Check member is active and not delinquent
		const { data: member, error: memberError } = await supabase
			.from('lib_members')
			.select('id, is_active, is_delinquent, member_category, institution_id')
			.eq('id', member_id)
			.single()

		if (memberError || !member) {
			return NextResponse.json({ error: 'Member not found' }, { status: 404 })
		}
		if (member.institution_id !== institution_id) {
			return NextResponse.json({ error: 'Member does not belong to this institution' }, { status: 400 })
		}
		if (!member.is_active) {
			return NextResponse.json({ error: 'Member account is inactive' }, { status: 400 })
		}
		if (member.is_delinquent) {
			return NextResponse.json(
				{ error: 'Member has unpaid late charges — please clear outstanding charges before lending' },
				{ status: 400 }
			)
		}

		// 3. Get loan_period_days from member category config
		const { data: categoryConfig } = await supabase
			.from('lib_member_categories')
			.select('loan_period_days, max_items_allowed')
			.eq('institution_id', institution_id)
			.eq('category_code', member.member_category)
			.maybeSingle()

		const loanPeriodDays = body.loan_period_days ?? categoryConfig?.loan_period_days ?? 14
		const maxItemsAllowed = categoryConfig?.max_items_allowed ?? 3

		// 4. Check member hasn't exceeded their lending limit
		const { count: activeLoans } = await supabase
			.from('lib_lending_transactions')
			.select('*', { count: 'exact', head: true })
			.eq('member_id', member_id)
			.eq('transaction_status', 'active')

		if ((activeLoans ?? 0) >= maxItemsAllowed) {
			return NextResponse.json(
				{ error: `Member has reached their maximum lending limit of ${maxItemsAllowed} items` },
				{ status: 400 }
			)
		}

		// 5. Compute due_date
		const today = new Date()
		const dueDate = new Date(today)
		dueDate.setDate(today.getDate() + loanPeriodDays)
		const dueDateStr = dueDate.toISOString().split('T')[0]

		// 6. Create lending transaction
		const { data: transaction, error: txError } = await supabase
			.from('lib_lending_transactions')
			.insert({
				institution_id,
				item_id,
				member_id,
				issued_at: new Date().toISOString(),
				due_date: dueDateStr,
				issued_by: issued_by ?? null,
				renewal_count: 0,
				transaction_status: 'active',
			})
			.select()
			.single()

		if (txError) {
			console.error('Error creating lending transaction:', txError)
			return NextResponse.json({ error: 'Failed to create lending transaction' }, { status: 500 })
		}

		// 7. Update item status to on_loan
		const { error: itemUpdateError } = await supabase
			.from('lib_items')
			.update({ status: 'on_loan', updated_at: new Date().toISOString() })
			.eq('id', item_id)

		if (itemUpdateError) {
			console.error('Error updating item status:', itemUpdateError)
			// Attempt to rollback the transaction record
			await supabase.from('lib_lending_transactions').delete().eq('id', transaction.id)
			return NextResponse.json({ error: 'Failed to update item status — transaction rolled back' }, { status: 500 })
		}

		// 8. Fulfil any pending hold for this member+catalogue combination
		await supabase
			.from('lib_resource_holds')
			.update({
				hold_status: 'fulfilled',
				checked_out_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.eq('member_id', member_id)
			.eq('item_id', item_id)
			.eq('hold_status', 'available')

		return NextResponse.json(
			{
				success: true,
				transaction,
				due_date: dueDateStr,
				loan_period_days: loanPeriodDays,
			},
			{ status: 201 }
		)
	} catch (error) {
		console.error('Unexpected error during issue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
