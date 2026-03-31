import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('lib_periodical_subscriptions')
			.select(`
				*,
				catalogue_record:lib_catalogue_records(id, title, issn, resource_format, publisher_name),
				supplier:lib_suppliers(id, supplier_code, supplier_name, contact_person, email),
				budget_head:lib_budget_heads(id, budget_head_code, budget_head_name, fiscal_year)
			`)
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
			}
			console.error('Error fetching subscription:', error)
			return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching subscription:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		delete body.id
		delete body.institution_id
		delete body.catalogue_record_id
		delete body.created_at

		const { data, error } = await supabase
			.from('lib_periodical_subscriptions')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating subscription:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating subscription:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
