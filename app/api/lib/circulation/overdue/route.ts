import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** Named rather than `*`: the overdue screen and its reminders use these and no more. */
const OVERDUE_COLUMNS = `
	id,
	institution_id,
	member_id,
	item_id,
	issued_at,
	due_date,
	renewal_count,
	transaction_status,
	member:lib_members(id, member_number, display_name, email, phone, member_category),
	item:lib_items(
		id,
		accession_number,
		barcode,
		catalogue_record:lib_catalogue_records(id, title, isbn, call_number)
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

		const today = new Date().toISOString().split('T')[0]

		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_lending_transactions')
				.select(OVERDUE_COLUMNS)
				.lt('due_date', today)
				.in('transaction_status', ['active', 'overdue'])

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (memberId) query = query.eq('member_id', memberId)

			return query.order('due_date', { ascending: true }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching overdue transactions:', error)
			return NextResponse.json({ error: 'Failed to fetch overdue list' }, { status: 500 })
		}

		const todayMs = new Date(today).getTime()

		// Compute overdue_days and estimated_charge for each
		const enriched: Record<string, any>[] = (data || []).map((tx) => {
			const dueDateMs = new Date(tx.due_date).getTime()
			const overdueDays = Math.max(0, Math.floor((todayMs - dueDateMs) / (1000 * 60 * 60 * 24)))
			return { ...tx, overdue_days: overdueDays }
		})

		// Marks the rows overdue, but the reply does not wait for it.
		//
		// Nothing being sent back depends on this write — the days and charges
		// above are computed from `due_date`, not from the stored status — so
		// awaiting it only added a round trip to every load and every refresh.
		// A failure is logged and the next load simply tries again.
		if (enriched.length > 0) {
			const ids = enriched.map((tx) => tx.id)
			void supabase
				.from('lib_lending_transactions')
				.update({ transaction_status: 'overdue', updated_at: new Date().toISOString() })
				.in('id', ids)
				.eq('transaction_status', 'active')
				.then(({ error: syncError }) => {
					if (syncError) console.warn('[overdue] status sync not written:', syncError.message)
				})
		}

		return NextResponse.json({
			data: enriched,
			total: enriched.length,
			as_of: today,
		})
	} catch (error) {
		console.error('Unexpected error fetching overdue list:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
