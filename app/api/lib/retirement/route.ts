import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const retirementStatus = searchParams.get('retirement_status')

		let query = supabase
			.from('lib_retirement_requests')
			.select(`
				*,
				item:lib_items(
					id,
					accession_number,
					barcode,
					condition,
					status,
					catalogue_record:lib_catalogue_records(id, title, isbn, call_number)
				)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (retirementStatus) query = query.eq('retirement_status', retirementStatus)

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching retirement requests:', error)
			return NextResponse.json({ error: 'Failed to fetch retirement requests' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching retirement requests:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!body.item_id) {
			return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
		}
		if (!body.reason?.trim()) {
			return NextResponse.json({ error: 'reason is required' }, { status: 400 })
		}

		// Verify item is available for retirement
		const { data: item } = await supabase
			.from('lib_items')
			.select('status')
			.eq('id', body.item_id)
			.single()

		if (!item) {
			return NextResponse.json({ error: 'Item not found' }, { status: 404 })
		}
		if (item.status === 'on_loan') {
			return NextResponse.json({ error: 'Cannot retire an item that is currently on loan' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_retirement_requests')
			.insert({
				institution_id: body.institution_id,
				item_id: body.item_id,
				reason: body.reason.trim(),
				condition_at_retirement: body.condition_at_retirement ?? null,
				recommended_by: body.recommended_by ?? null,
				retirement_status: 'pending',
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating retirement request:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check item_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create retirement request' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating retirement request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		if (!body.id) {
			return NextResponse.json({ error: 'id is required' }, { status: 400 })
		}

		const allowedStatuses = ['pending', 'approved', 'rejected', 'completed']
		if (body.retirement_status && !allowedStatuses.includes(body.retirement_status)) {
			return NextResponse.json(
				{ error: `Invalid retirement_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		if (body.retirement_status === 'rejected' && !body.rejection_reason?.trim()) {
			return NextResponse.json({ error: 'rejection_reason is required when rejecting' }, { status: 400 })
		}

		const { id, ...updateData } = body
		delete updateData.institution_id
		delete updateData.created_at

		if (body.retirement_status === 'approved' && !updateData.approval_date) {
			updateData.approval_date = new Date().toISOString().split('T')[0]
		}

		const { data, error } = await supabase
			.from('lib_retirement_requests')
			.update({ ...updateData, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating retirement request:', error)
			return NextResponse.json({ error: 'Failed to update retirement request' }, { status: 500 })
		}

		// If approved and completed, update item status to retired
		if (body.retirement_status === 'completed' && data.item_id) {
			await supabase
				.from('lib_items')
				.update({
					status: 'retired',
					is_active: false,
					updated_at: new Date().toISOString(),
				})
				.eq('id', data.item_id)
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating retirement request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
