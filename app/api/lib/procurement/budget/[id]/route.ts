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
			.from('lib_budget_heads')
			.select('*')
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Budget head not found' }, { status: 404 })
			}
			console.error('Error fetching budget head:', error)
			return NextResponse.json({ error: 'Failed to fetch budget head' }, { status: 500 })
		}

		const enriched = {
			...data,
			utilisation_percent: data.allocated_amount > 0
				? Math.round(((data.spent_amount ?? 0) / data.allocated_amount) * 100)
				: 0,
			available_amount: data.allocated_amount - (data.spent_amount ?? 0) - (data.committed_amount ?? 0),
		}

		return NextResponse.json(enriched)
	} catch (error) {
		console.error('Unexpected error fetching budget head:', error)
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
		delete body.budget_head_code
		delete body.fiscal_year
		delete body.created_at

		if (body.allocated_amount !== undefined) {
			body.allocated_amount = Number(body.allocated_amount)
		}

		const { data, error } = await supabase
			.from('lib_budget_heads')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating budget head:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Budget head not found' }, { status: 404 })
			}
			return NextResponse.json({ error: 'Failed to update budget head' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating budget head:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		// Prevent deletion if there is spend against this head
		const { data: existing } = await supabase
			.from('lib_budget_heads')
			.select('spent_amount, committed_amount')
			.eq('id', id)
			.single()

		if ((existing?.spent_amount ?? 0) > 0 || (existing?.committed_amount ?? 0) > 0) {
			return NextResponse.json(
				{ error: 'Cannot delete — budget head has committed or spent amounts' },
				{ status: 400 }
			)
		}

		const { error } = await supabase.from('lib_budget_heads').delete().eq('id', id)

		if (error) {
			console.error('Error deleting budget head:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — budget head is linked to procurement records' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete budget head' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting budget head:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
