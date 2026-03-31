import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		// Disallow changing core identifiers
		delete body.id
		delete body.institution_id
		delete body.member_id
		delete body.catalogue_record_id
		delete body.created_at
		delete body.hold_placed_at

		// Validate status transitions
		const allowedStatuses = ['pending', 'available', 'fulfilled', 'cancelled', 'expired']
		if (body.hold_status && !allowedStatuses.includes(body.hold_status)) {
			return NextResponse.json(
				{ error: `Invalid hold_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		// If cancelling, require reason
		if (body.hold_status === 'cancelled' && !body.cancellation_reason?.trim()) {
			return NextResponse.json({ error: 'cancellation_reason is required when cancelling a hold' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_resource_holds')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating hold:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Hold not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update hold' }, { status: 500 })
		}

		// If hold cancelled or expired, free item status if it was on_hold for this hold
		if (
			(body.hold_status === 'cancelled' || body.hold_status === 'expired') &&
			data.item_id
		) {
			// Check no other active holds on same item
			const { count: otherHolds } = await supabase
				.from('lib_resource_holds')
				.select('*', { count: 'exact', head: true })
				.eq('item_id', data.item_id)
				.in('hold_status', ['pending', 'available'])

			if ((otherHolds ?? 0) === 0) {
				await supabase
					.from('lib_items')
					.update({ status: 'available', updated_at: new Date().toISOString() })
					.eq('id', data.item_id)
					.eq('status', 'on_hold')
			}
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating hold:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
