import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberId = searchParams.get('member_id')
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')

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

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

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
