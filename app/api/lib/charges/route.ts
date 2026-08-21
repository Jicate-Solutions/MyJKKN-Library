import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
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
	member:lib_members(id, member_number, display_name, member_category),
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

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching charges:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
