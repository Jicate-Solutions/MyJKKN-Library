import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('lib_procurement_requests')
			.select(`
				*,
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name, fiscal_year, allocated_amount, spent_amount)
			`)
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Procurement request not found' }, { status: 404 })
			}
			console.error('Error fetching procurement request:', error)
			return NextResponse.json({ error: 'Failed to fetch procurement request' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching procurement request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		// Validate status transitions
		const allowedStatuses = ['pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled']
		if (body.request_status && !allowedStatuses.includes(body.request_status)) {
			return NextResponse.json(
				{ error: `Invalid request_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		// Auto-set approval metadata
		if (body.request_status === 'approved' && !body.approved_at) {
			body.approved_at = new Date().toISOString()
		}
		if (body.request_status === 'rejected' && !body.rejection_reason?.trim()) {
			return NextResponse.json({ error: 'rejection_reason is required when rejecting a request' }, { status: 400 })
		}

		delete body.id
		delete body.institution_id
		delete body.request_number
		delete body.created_at

		const { data, error } = await supabase
			.from('lib_procurement_requests')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating procurement request:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Procurement request not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update procurement request' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating procurement request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
