import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const requestStatus = searchParams.get('request_status')
		const search = searchParams.get('search')

		let query = supabase
			.from('lib_procurement_requests')
			.select(`
				*,
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name, fiscal_year)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (requestStatus) query = query.eq('request_status', requestStatus)
		if (search) {
			query = query.or(`title.ilike.%${search}%,isbn.ilike.%${search}%,author.ilike.%${search}%`)
		}

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching procurement requests:', error)
			return NextResponse.json({ error: 'Failed to fetch procurement requests' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching procurement requests:', error)
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
		if (!body.title?.trim()) {
			return NextResponse.json({ error: 'title is required' }, { status: 400 })
		}

		// Auto-generate request_number
		let requestNumber = body.request_number?.trim()
		if (!requestNumber) {
			const year = new Date().getFullYear()
			const { count } = await supabase
				.from('lib_procurement_requests')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', body.institution_id)

			const seq = String((count ?? 0) + 1).padStart(4, '0')
			requestNumber = `REQ/${year}/${seq}`
		}

		const { data, error } = await supabase
			.from('lib_procurement_requests')
			.insert({
				institution_id: body.institution_id,
				request_number: requestNumber,
				requested_by: body.requested_by ?? null,
				title: body.title.trim(),
				author: body.author ?? null,
				publisher: body.publisher ?? null,
				edition: body.edition ?? null,
				isbn: body.isbn ?? null,
				resource_format: body.resource_format ?? 'book',
				quantity: body.quantity ?? 1,
				estimated_price: body.estimated_price ?? null,
				currency_code: body.currency_code ?? 'INR',
				budget_head_id: body.budget_head_id ?? null,
				purpose: body.purpose ?? null,
				department: body.department ?? null,
				priority: body.priority ?? 'normal',
				request_status: 'pending',
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating procurement request:', error)
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Request number already exists' }, { status: 400 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id or budget_head_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create procurement request' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating procurement request:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
