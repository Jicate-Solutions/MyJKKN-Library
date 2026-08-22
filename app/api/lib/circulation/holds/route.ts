import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { personByMyjkknId } from '@/lib/library/myjkkn-directory'
import { ensureBorrower, borrowerById } from '@/lib/library/borrower'

/**
 * What the hold queue shows. The reserved copy used to be joined as well, but
 * the queue lists the title a member is waiting for, never the individual copy,
 * so that join was fetched and discarded on every load.
 */
const HOLD_COLUMNS = `
	id,
	institution_id,
	catalogue_record_id,
	member_id,
	item_id,
	hold_placed_at,
	hold_expires_at,
	notified_at,
	checked_out_at,
	hold_status,
	cancellation_reason,
	member:lib_borrowers(id, member_number, display_name, member_category),
	catalogue_record:lib_catalogue_records(id, title, isbn, call_number)
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
		const catalogueRecordId = searchParams.get('catalogue_record_id')
		const holdStatus = searchParams.get('hold_status')

		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_resource_holds')
				.select(HOLD_COLUMNS)

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (memberId) query = query.eq('member_id', memberId)
			if (catalogueRecordId) query = query.eq('catalogue_record_id', catalogueRecordId)
			if (holdStatus) query = query.eq('hold_status', holdStatus)

			return query.order('hold_placed_at', { ascending: true }).range(range.from, range.to)
		})

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
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!body.catalogue_record_id) {
			return NextResponse.json({ error: 'catalogue_record_id is required' }, { status: 400 })
		}

		const myjkknId: string | null = body.myjkkn_id ?? null
		const personKind: 'learner' | 'facilitator' | null =
			body.person_kind === 'learner' || body.person_kind === 'facilitator' ? body.person_kind : null

		if (!myjkknId && !body.member_id) {
			return NextResponse.json({ error: 'Scan the member card first' }, { status: 400 })
		}

		// Who is reserving.
		//
		// A hold is a claim on a book, so it needs the same identity a loan
		// does — which means the same borrower row. Checked against MyJKKN
		// rather than trusted from the request, exactly as issuing is, so a
		// hold cannot be placed for somebody who is not an Active member here.
		let borrower = null

		if (myjkknId && personKind) {
			const person = await personByMyjkknId(body.institution_id, personKind, myjkknId)
			if (!person) {
				return NextResponse.json(
					{ error: 'This person is not an Active member of this college in MyJKKN' },
					{ status: 404 }
				)
			}
			const resolved = await ensureBorrower(supabase, body.institution_id, person)
			if (!resolved.borrower) {
				return NextResponse.json({ error: resolved.error ?? 'Could not record who is reserving' }, { status: 500 })
			}
			borrower = resolved.borrower
		} else {
			borrower = await borrowerById(supabase, body.institution_id, body.member_id)
			if (!borrower) {
				return NextResponse.json({ error: 'Member not found' }, { status: 404 })
			}
		}

		if (borrower.is_delinquent) {
			return NextResponse.json({ error: 'Member has unpaid late charges — cannot place hold' }, { status: 400 })
		}

		// Check reservation limit
		const { data: categoryConfig } = await supabase
			.from('lib_member_categories')
			.select('reservation_limit')
			.eq('institution_id', body.institution_id)
			.eq('category_code', borrower.member_category)
			.maybeSingle()

		const reservationLimit = categoryConfig?.reservation_limit ?? 2

		const { count: activeHolds } = await supabase
			.from('lib_resource_holds')
			.select('*', { count: 'exact', head: true })
			.eq('member_id', borrower.id)
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
			.eq('member_id', borrower.id)
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
				member_id: borrower.id,
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
