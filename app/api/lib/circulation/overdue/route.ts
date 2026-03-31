import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberId = searchParams.get('member_id')

		const today = new Date().toISOString().split('T')[0]

		let query = supabase
			.from('lib_lending_transactions')
			.select(`
				*,
				member:lib_members(id, member_number, display_name, email, phone, member_category),
				item:lib_items(
					id,
					accession_number,
					barcode,
					catalogue_record:lib_catalogue_records(id, title, isbn, call_number)
				)
			`)
			.lt('due_date', today)
			.in('transaction_status', ['active', 'overdue'])

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (memberId) query = query.eq('member_id', memberId)

		const { data, error } = await query
			.order('due_date', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching overdue transactions:', error)
			return NextResponse.json({ error: 'Failed to fetch overdue list' }, { status: 500 })
		}

		const todayMs = new Date(today).getTime()

		// Compute overdue_days and estimated_charge for each
		const enriched = (data || []).map((tx) => {
			const dueDateMs = new Date(tx.due_date).getTime()
			const overdueDays = Math.max(0, Math.floor((todayMs - dueDateMs) / (1000 * 60 * 60 * 24)))
			return { ...tx, overdue_days: overdueDays }
		})

		// Auto-update status to 'overdue' in bulk
		if (enriched.length > 0) {
			const ids = enriched.map((tx) => tx.id)
			await supabase
				.from('lib_lending_transactions')
				.update({ transaction_status: 'overdue', updated_at: new Date().toISOString() })
				.in('id', ids)
				.eq('transaction_status', 'active')
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
