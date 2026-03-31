import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberId = searchParams.get('member_id')
		const catalogueRecordId = searchParams.get('catalogue_record_id')
		const holdStatus = searchParams.get('hold_status')

		let query = supabase
			.from('lib_resource_holds')
			.select(`
				*,
				member:lib_members(id, member_number, display_name, member_category),
				catalogue_record:lib_catalogue_records(id, title, isbn, call_number),
				item:lib_items(id, accession_number, barcode, status)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (memberId) query = query.eq('member_id', memberId)
		if (catalogueRecordId) query = query.eq('catalogue_record_id', catalogueRecordId)
		if (holdStatus) query = query.eq('hold_status', holdStatus)

		const { data, error } = await query
			.order('hold_placed_at', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching holds:', error)
			return NextResponse.json({ error: 'Failed to fetch holds' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching holds:', error)
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
		if (!body.catalogue_record_id) {
			return NextResponse.json({ error: 'catalogue_record_id is required' }, { status: 400 })
		}
		if (!body.member_id) {
			return NextResponse.json({ error: 'member_id is required' }, { status: 400 })
		}

		// Check member is active and not delinquent
		const { data: member } = await supabase
			.from('lib_members')
			.select('is_active, is_delinquent, member_category')
			.eq('id', body.member_id)
			.single()

		if (!member?.is_active) {
			return NextResponse.json({ error: 'Member account is inactive' }, { status: 400 })
		}
		if (member?.is_delinquent) {
			return NextResponse.json({ error: 'Member has unpaid late charges — cannot place hold' }, { status: 400 })
		}

		// Check reservation limit
		const { data: categoryConfig } = await supabase
			.from('lib_member_categories')
			.select('reservation_limit')
			.eq('institution_id', body.institution_id)
			.eq('category_code', member.member_category)
			.maybeSingle()

		const reservationLimit = categoryConfig?.reservation_limit ?? 2

		const { count: activeHolds } = await supabase
			.from('lib_resource_holds')
			.select('*', { count: 'exact', head: true })
			.eq('member_id', body.member_id)
			.in('hold_status', ['pending', 'available'])

		if ((activeHolds ?? 0) >= reservationLimit) {
			return NextResponse.json(
				{ error: `Member has reached their hold limit of ${reservationLimit}` },
				{ status: 400 }
			)
		}

		// Check no duplicate active hold by this member for this catalogue record
		const { count: existingHold } = await supabase
			.from('lib_resource_holds')
			.select('*', { count: 'exact', head: true })
			.eq('member_id', body.member_id)
			.eq('catalogue_record_id', body.catalogue_record_id)
			.in('hold_status', ['pending', 'available'])

		if ((existingHold ?? 0) > 0) {
			return NextResponse.json(
				{ error: 'Member already has an active hold on this resource' },
				{ status: 400 }
			)
		}

		// Default hold_expires_at = 7 days from today
		const expiresAt = body.hold_expires_at ?? (() => {
			const d = new Date()
			d.setDate(d.getDate() + 7)
			return d.toISOString().split('T')[0]
		})()

		const { data, error } = await supabase
			.from('lib_resource_holds')
			.insert({
				institution_id: body.institution_id,
				catalogue_record_id: body.catalogue_record_id,
				member_id: body.member_id,
				item_id: body.item_id ?? null,
				hold_placed_at: new Date().toISOString(),
				hold_expires_at: expiresAt,
				hold_status: 'pending',
				placed_by: body.placed_by ?? null,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating hold:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check member_id or catalogue_record_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create hold' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating hold:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
