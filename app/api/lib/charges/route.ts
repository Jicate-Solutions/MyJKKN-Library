import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { syncBilledForScope, billedChargeIds, billingReady } from '@/lib/library/myjkkn-billing'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** The fields the charges screen and its collect/waive sheet read. */
const CHARGE_COLUMNS = `
	id,
	institution_id,
	transaction_id,
	member_id,
	overdue_days,
	charge_per_day,
	total_charge,
	waiver_amount,
	net_payable,
	payment_status,
	payment_date,
	payment_reference,
	waiver_reason,
	created_at,
	member:lib_borrowers(id, member_number, display_name, member_category),
	transaction:lib_lending_transactions(
		id,
		issued_at,
		due_date,
		returned_at,
		item:lib_items(
			id,
			accession_number,
			catalogue_record:lib_catalogue_records(id, title, isbn)
		)
	)
`

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const memberId = searchParams.get('member_id')
		const paymentStatus = searchParams.get('payment_status')

		// A fine on a MyJKKN bill is paid in MyJKKN, and nothing tells this
		// database. So the bills are checked before the list is read, and a fine
		// the learner has paid shows as Paid here rather than still owing. It
		// does nothing while no fine is on a bill.
		await syncBilledForScope(supabase, { institutionId, memberId })

		// Settled charges are never purged, so this table is the likeliest in the
		// system to cross the 1,000-row ceiling a single request is capped at.
		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_late_charges')
				.select(CHARGE_COLUMNS)

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (memberId) query = query.eq('member_id', memberId)
			if (paymentStatus) query = query.eq('payment_status', paymentStatus)

			return query.order('created_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching charges:', error)
			return NextResponse.json({ error: 'Failed to fetch charges' }, { status: 500 })
		}

		// Which of these could go on a MyJKKN bill, and which already have.
		//
		// The page cannot work either out for itself: whether this server has
		// billing at all is a server question, and whether a fine is already
		// billed is a column the list does not carry. Both are answered here, so
		// the menu offers Add to bill exactly where pressing it would work — a
		// learner, billing switched on, and not already billed.
		const [canBill, billed] = await Promise.all([
			billingReady(),
			billedChargeIds(supabase, { institutionId, memberId }),
		])

		const charges = (data || []).map(row => {
			const member = row.member as { member_category?: string } | null
			const onBill = billed.has(String(row.id))
			return {
				...row,
				on_myjkkn_bill: onBill,
				can_bill: canBill && !onBill && member?.member_category === 'learner',
			}
		})

		return NextResponse.json(charges)
	} catch (error) {
		console.error('Unexpected error fetching charges:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
