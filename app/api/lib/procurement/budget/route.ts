import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const fiscalYear = searchParams.get('fiscal_year')
		const resourceType = searchParams.get('resource_type')
		const isActive = searchParams.get('is_active')

		let query = supabase.from('lib_budget_heads').select('*')

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)
		if (resourceType) query = query.eq('resource_type', resourceType)
		if (isActive !== null) query = query.eq('is_active', isActive === 'true')

		const { data, error } = await query
			.order('budget_head_code', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching budget heads:', error)
			return NextResponse.json({ error: 'Failed to fetch budget heads' }, { status: 500 })
		}

		// Compute utilisation percentage for each head
		const enriched = (data || []).map((head) => ({
			...head,
			utilisation_percent: head.allocated_amount > 0
				? Math.round(((head.spent_amount ?? 0) / head.allocated_amount) * 100)
				: 0,
			available_amount: head.allocated_amount - (head.spent_amount ?? 0) - (head.committed_amount ?? 0),
		}))

		return NextResponse.json(enriched)
	} catch (error) {
		console.error('Unexpected error fetching budget heads:', error)
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
		if (!body.fiscal_year?.trim()) {
			return NextResponse.json({ error: 'fiscal_year is required' }, { status: 400 })
		}
		if (!body.budget_head_code?.trim()) {
			return NextResponse.json({ error: 'budget_head_code is required' }, { status: 400 })
		}
		if (!body.budget_head_name?.trim()) {
			return NextResponse.json({ error: 'budget_head_name is required' }, { status: 400 })
		}
		if (body.allocated_amount === undefined || body.allocated_amount === null) {
			return NextResponse.json({ error: 'allocated_amount is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_budget_heads')
			.insert({
				institution_id: body.institution_id,
				fiscal_year: body.fiscal_year.trim(),
				budget_head_code: body.budget_head_code.trim().toUpperCase(),
				budget_head_name: body.budget_head_name.trim(),
				resource_type: body.resource_type ?? null,
				allocated_amount: Number(body.allocated_amount),
				spent_amount: 0,
				committed_amount: 0,
				is_active: body.is_active ?? true,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating budget head:', error)
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Budget head code already exists for this institution and fiscal year' }, { status: 400 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create budget head' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating budget head:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
