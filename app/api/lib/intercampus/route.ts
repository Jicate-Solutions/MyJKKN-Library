import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const requestStatus = searchParams.get('request_status')
		const memberId = searchParams.get('member_id')

		let query = supabase
			.from('lib_intercampus_requests')
			.select(`
				*,
				member:lib_members(id, member_number, display_name, member_category),
				catalogue_record:lib_catalogue_records(id, title, isbn, call_number),
				item:lib_items(id, accession_number, barcode, status)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (requestStatus) query = query.eq('request_status', requestStatus)
		if (memberId) query = query.eq('member_id', memberId)

		const { data, error } = await query
			.order('request_date', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching intercampus requests:', error)
			return NextResponse.json({ error: 'Failed to fetch intercampus requests' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching intercampus requests:', error)
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
		if (!body.member_id) {
			return NextResponse.json({ error: 'member_id is required' }, { status: 400 })
		}
		if (!body.title?.trim()) {
			return NextResponse.json({ error: 'title is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_intercampus_requests')
			.insert({
				institution_id: body.institution_id,
				providing_institution_id: body.providing_institution_id ?? null,
				member_id: body.member_id,
				catalogue_record_id: body.catalogue_record_id ?? null,
				title: body.title.trim(),
				author: body.author ?? null,
				isbn: body.isbn ?? null,
				request_date: new Date().toISOString(),
				due_date: body.due_date ?? null,
				request_status: 'pending',
				item_id: null,
				request_note: body.request_note ?? null,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating intercampus request:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check member_id or institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create intercampus request' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating intercampus request:', error)
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

		const allowedStatuses = ['pending', 'approved', 'dispatched', 'received', 'returned', 'rejected', 'lost']
		if (body.request_status && !allowedStatuses.includes(body.request_status)) {
			return NextResponse.json(
				{ error: `Invalid request_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		const { id, ...updateData } = body
		delete updateData.institution_id
		delete updateData.created_at
		delete updateData.request_date

		const { data, error } = await supabase
			.from('lib_intercampus_requests')
			.update({ ...updateData, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating intercampus request:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Intercampus request not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update intercampus request' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating intercampus request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
