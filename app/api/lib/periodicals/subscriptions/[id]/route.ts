import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_periodical_subscriptions', id)
		if (!guard.ok) return guard.response
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
		const guard = await guardRecord(request, 'lib_periodical_subscriptions', id)
		if (!guard.ok) return guard.response
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

/**
 * Deleting one subscription: DELETE /api/lib/periodicals/subscriptions/[id]
 *
 * The Delete option on the subscriptions list has always called this; there was
 * no handler behind it, so the row vanished from the screen and came back on
 * the next refresh, still subscribed.
 *
 * A subscription with issues recorded against it is not deleted — those issues
 * are the library's record of what actually arrived, and losing them to tidy up
 * a list is not a trade worth making. The librarian is told to cancel it
 * instead, which is what the status is for.
 */
export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_periodical_subscriptions', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()

		const { count: issues } = await supabase
			.from('lib_periodical_issues')
			.select('id', { count: 'exact', head: true })
			.eq('subscription_id', id)

		if ((issues ?? 0) > 0) {
			return NextResponse.json(
				{ error: `This subscription has ${issues} issue${issues === 1 ? '' : 's'} recorded against it — cancel it instead of deleting it` },
				{ status: 400 }
			)
		}

		const { error } = await supabase
			.from('lib_periodical_subscriptions')
			.delete()
			.eq('id', id)

		if (error) {
			console.error('Error deleting subscription:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — something else refers to this subscription' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete subscription' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting subscription:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
