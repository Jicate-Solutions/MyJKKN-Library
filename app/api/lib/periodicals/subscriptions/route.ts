import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const subscriptionStatus = searchParams.get('subscription_status')
		const fiscalYear = searchParams.get('fiscal_year')
		const search = searchParams.get('search')

		let query = supabase
			.from('lib_periodical_subscriptions')
			.select(`
				*,
				catalogue_record:lib_catalogue_records(id, title, issn, resource_format),
				supplier:lib_suppliers(id, supplier_code, supplier_name),
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (subscriptionStatus) query = query.eq('subscription_status', subscriptionStatus)
		if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)
		if (search) {
			// Search by catalogue record title via filter after fetch — handled below
		}

		const { data, error } = await query
			.order('created_at', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching periodical subscriptions:', error)
			return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
		}

		let result = data || []

		if (search) {
			const term = search.toLowerCase()
			result = result.filter(
				(s) =>
					(s.catalogue_record?.title ?? '').toLowerCase().includes(term) ||
					(s.subscription_number ?? '').toLowerCase().includes(term)
			)
		}

		return NextResponse.json(result)
	} catch (error) {
		console.error('Unexpected error fetching subscriptions:', error)
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
		if (!body.fiscal_year?.trim()) {
			return NextResponse.json({ error: 'fiscal_year is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_periodical_subscriptions')
			.insert({
				institution_id: body.institution_id,
				catalogue_record_id: body.catalogue_record_id,
				supplier_id: body.supplier_id ?? null,
				budget_head_id: body.budget_head_id ?? null,
				subscription_number: body.subscription_number ?? null,
				subscription_type: body.subscription_type ?? null,
				frequency: body.frequency ?? null,
				fiscal_year: body.fiscal_year.trim(),
				start_date: body.start_date ?? null,
				end_date: body.end_date ?? null,
				subscription_cost: body.subscription_cost ?? null,
				currency_code: body.currency_code ?? 'INR',
				start_volume: body.start_volume ?? null,
				start_issue: body.start_issue ?? null,
				expected_issues: body.expected_issues ?? null,
				received_issues: 0,
				access_url: body.access_url ?? null,
				login_id: body.login_id ?? null,
				password_hint: body.password_hint ?? null,
				subscription_status: body.subscription_status ?? 'active',
				is_gratis: body.is_gratis ?? false,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating subscription:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check catalogue_record_id or supplier_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating subscription:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
