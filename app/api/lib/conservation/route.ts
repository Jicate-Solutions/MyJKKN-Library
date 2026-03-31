import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const conservationStatus = searchParams.get('conservation_status')
		const conservationType = searchParams.get('conservation_type')

		let query = supabase
			.from('lib_conservation_requests')
			.select(`
				*,
				item:lib_items(
					id,
					accession_number,
					barcode,
					catalogue_record:lib_catalogue_records(id, title, isbn)
				),
				subscription:lib_periodical_subscriptions(
					id,
					catalogue_record:lib_catalogue_records(id, title, issn)
				)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (conservationStatus) query = query.eq('conservation_status', conservationStatus)
		if (conservationType) query = query.eq('conservation_type', conservationType)

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching conservation requests:', error)
			return NextResponse.json({ error: 'Failed to fetch conservation requests' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching conservation requests:', error)
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
		if (!body.conservation_type?.trim()) {
			return NextResponse.json({ error: 'conservation_type is required' }, { status: 400 })
		}
		if (!body.item_id && !body.subscription_id) {
			return NextResponse.json(
				{ error: 'Either item_id or subscription_id is required' },
				{ status: 400 }
			)
		}

		const { data, error } = await supabase
			.from('lib_conservation_requests')
			.insert({
				institution_id: body.institution_id,
				conservation_type: body.conservation_type,
				item_id: body.item_id ?? null,
				subscription_id: body.subscription_id ?? null,
				sent_to_binder: body.sent_to_binder ?? null,
				expected_return: body.expected_return ?? null,
				actual_return: body.actual_return ?? null,
				binder_name: body.binder_name ?? null,
				binder_invoice: body.binder_invoice ?? null,
				binding_cost: body.binding_cost ?? null,
				conservation_status: body.conservation_status ?? 'identified',
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating conservation request:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check item_id or subscription_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create conservation request' }, { status: 500 })
		}

		// If item is sent for conservation, update item status
		if (data.item_id && (body.conservation_status === 'sent' || body.sent_to_binder)) {
			await supabase
				.from('lib_items')
				.update({ status: 'in_conservation', updated_at: new Date().toISOString() })
				.eq('id', data.item_id)
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating conservation request:', error)
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

		const allowedStatuses = ['identified', 'sent', 'returned', 'cancelled']
		if (body.conservation_status && !allowedStatuses.includes(body.conservation_status)) {
			return NextResponse.json(
				{ error: `Invalid conservation_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		const { id, ...updateData } = body
		delete updateData.institution_id
		delete updateData.created_at

		const { data, error } = await supabase
			.from('lib_conservation_requests')
			.update({ ...updateData, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating conservation request:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Conservation request not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update conservation request' }, { status: 500 })
		}

		// If returned from conservation, restore item to available
		if (body.conservation_status === 'returned' && data.item_id) {
			await supabase
				.from('lib_items')
				.update({ status: 'available', updated_at: new Date().toISOString() })
				.eq('id', data.item_id)
				.eq('status', 'in_conservation')
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating conservation request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
