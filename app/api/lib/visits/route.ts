import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const memberId = searchParams.get('member_id')
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')

		// A big college can see more than a thousand people through the door in
		// one day, and a footfall figure that silently stopped at a thousand is
		// exactly the number inspection asks for
		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_member_visits')
				.select(`
					*,
					member:lib_members(id, member_number, display_name, member_category)
				`)

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (memberId) query = query.eq('member_id', memberId)
			if (fromDate) query = query.gte('visit_date', fromDate)
			if (toDate) query = query.lte('visit_date', toDate)

			return query.order('created_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching visits:', error)
			return NextResponse.json({ error: 'Failed to fetch visits' }, { status: 500 })
		}

		return NextResponse.json(data || [])
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
				member_id: body.member_id ?? null,
				visit_date: body.visit_date ?? new Date().toISOString().split('T')[0],
				entry_time: body.entry_time ?? null,
				exit_time: body.exit_time ?? null,
				visit_purpose: body.visit_purpose ?? null,
			})
			.select()
			.single()

		if (error) {
			console.error('Error logging visit:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check member_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to log visit' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
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
			.select()
			.single()

		if (error) {
			console.error('Error recording exit:', error)
			return NextResponse.json({ error: 'Failed to record exit' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error recording exit:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
