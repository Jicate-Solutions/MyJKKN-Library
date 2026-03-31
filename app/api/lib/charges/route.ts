import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberId = searchParams.get('member_id')
		const paymentStatus = searchParams.get('payment_status')

		let query = supabase
			.from('lib_late_charges')
			.select(`
				*,
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
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (memberId) query = query.eq('member_id', memberId)
		if (paymentStatus) query = query.eq('payment_status', paymentStatus)

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

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
