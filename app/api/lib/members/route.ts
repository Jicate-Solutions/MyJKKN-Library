import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberCategory = searchParams.get('member_category')
		const isActive = searchParams.get('is_active')
		const search = searchParams.get('search')

		let query = supabase.from('lib_members').select('*')

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (memberCategory) query = query.eq('member_category', memberCategory)
		if (isActive !== null) query = query.eq('is_active', isActive === 'true')
		if (search) {
			query = query.or(
				`member_number.ilike.%${search}%,display_name.ilike.%${search}%,email.ilike.%${search}%`
			)
		}

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching members:', error)
			return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching members:', error)
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
		if (!body.member_category?.trim()) {
			return NextResponse.json({ error: 'member_category is required' }, { status: 400 })
		}
		if (!body.membership_start_date) {
			return NextResponse.json({ error: 'membership_start_date is required' }, { status: 400 })
		}

		// Auto-generate member_number if not provided
		let memberNumber = body.member_number?.trim()
		if (!memberNumber) {
			const year = new Date().getFullYear()
			const { count } = await supabase
				.from('lib_members')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', body.institution_id)

			const seq = String((count ?? 0) + 1).padStart(4, '0')
			memberNumber = `LIB-${year}-${seq}`
		}

		const { data, error } = await supabase
			.from('lib_members')
			.insert({
				institution_id: body.institution_id,
				member_number: memberNumber,
				member_category: body.member_category,
				learner_id: body.learner_id ?? null,
				facilitator_id: body.facilitator_id ?? null,
				team_member_id: body.team_member_id ?? null,
				display_name: body.display_name ?? null,
				email: body.email ?? null,
				phone: body.phone ?? null,
				membership_start_date: body.membership_start_date,
				membership_end_date: body.membership_end_date ?? null,
				is_active: body.is_active ?? true,
				is_delinquent: body.is_delinquent ?? false,
				created_by: body.created_by ?? null,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating member:', error)
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Member number already exists' }, { status: 400 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
