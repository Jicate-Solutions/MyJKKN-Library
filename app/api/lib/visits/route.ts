/**
 * The gate register: GET/POST/PUT /api/lib/visits
 *
 * Who walked in is written on the visit itself — their MyJKKN id, and the name,
 * number and category the register prints — because walking into the library is
 * not borrowing, and nobody becomes a borrower by coming through the door.
 *
 * Visits recorded before 2026-08-22 pointed at a membership row instead. The
 * database update copied their details onto the visit, so both read the same
 * way here and no join is needed for either.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** What the register shows, per visit. */
const VISIT_COLUMNS = `
	id,
	institution_id,
	member_id,
	myjkkn_id,
	person_kind,
	member_number,
	display_name,
	member_category,
	visit_date,
	entry_time,
	exit_time,
	visit_purpose,
	created_at
`

/**
 * Shapes a visit the way the gate screens read it.
 *
 * `member` is built from the visit's own columns rather than joined, and is
 * kept because that is the shape both gate screens and the footfall export
 * already render — the person moved onto the visit, the screens did not have to.
 */
function withMember(row: Record<string, any>) {
	return {
		...row,
		member: row.member_number || row.display_name
			? {
				id: row.myjkkn_id ?? row.member_id ?? null,
				member_number: row.member_number ?? '',
				display_name: row.display_name ?? null,
				member_category: row.member_category ?? '',
			}
			: null,
	}
}

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const myjkknId = searchParams.get('myjkkn_id')
		const memberId = searchParams.get('member_id')
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')

		// A big college can see more than a thousand people through the door in
		// one day, and a footfall figure that silently stopped at a thousand is
		// exactly the number inspection asks for
		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_member_visits')
				.select(VISIT_COLUMNS)

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (myjkknId) query = query.eq('myjkkn_id', myjkknId)
			if (memberId) query = query.eq('member_id', memberId)
			if (fromDate) query = query.gte('visit_date', fromDate)
			if (toDate) query = query.lte('visit_date', toDate)

			return query.order('created_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching visits:', error)
			return NextResponse.json({ error: 'Failed to fetch visits' }, { status: 500 })
		}

		return NextResponse.json((data || []).map(withMember))
	} catch (error) {
		console.error('Unexpected error fetching visits:', error)
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

		const { data, error } = await supabase
			.from('lib_member_visits')
			.insert({
				institution_id: body.institution_id,
				// A visit never creates a borrower — the person is written here
				member_id: null,
				myjkkn_id: body.myjkkn_id ?? null,
				person_kind: body.person_kind ?? null,
				member_number: body.member_number ?? null,
				display_name: body.display_name ?? null,
				member_category: body.member_category ?? null,
				visit_date: body.visit_date ?? new Date().toISOString().split('T')[0],
				entry_time: body.entry_time ?? null,
				exit_time: body.exit_time ?? null,
				visit_purpose: body.visit_purpose ?? null,
			})
			.select(VISIT_COLUMNS)
			.single()

		if (error) {
			console.error('Error logging visit:', error)
			if (error.code === '42703') {
				return NextResponse.json(
					{ error: 'This library\'s database has not been updated for the new member system yet — please run the pending database update' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to log visit' }, { status: 500 })
		}

		return NextResponse.json(withMember(data), { status: 201 })
	} catch (error) {
		console.error('Unexpected error logging visit:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

/** Records the exit on an open visit — the second scan of the same card. */
export async function PUT(request: Request) {
	try {
		const body = await request.json()
		if (!body.id) {
			return NextResponse.json({ error: 'id is required' }, { status: 400 })
		}

		const guard = await guardRecord(request, 'lib_member_visits', body.id)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_member_visits')
			.update({
				exit_time: body.exit_time ?? new Date().toISOString(),
				visit_purpose: body.visit_purpose ?? undefined,
			})
			.eq('id', body.id)
			.select(VISIT_COLUMNS)
			.single()

		if (error) {
			console.error('Error recording exit:', error)
			return NextResponse.json({ error: 'Failed to record exit' }, { status: 500 })
		}

		return NextResponse.json(withMember(data))
	} catch (error) {
		console.error('Unexpected error recording exit:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
