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
			.from('lib_periodical_issues')
			.select(`
				*,
				item:lib_items(id, accession_number, barcode, status)
			`)
			.eq('subscription_id', id)
			.order('issue_date', { ascending: false })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching periodical issues:', error)
			return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching issues:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id: subscriptionId } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		// Verify subscription exists
		const { data: subscription, error: subError } = await supabase
			.from('lib_periodical_subscriptions')
			.select('id, catalogue_record_id, institution_id, received_issues, expected_issues')
			.eq('id', subscriptionId)
			.single()

		if (subError || !subscription) {
			return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
		}

		const { data: issue, error: issueError } = await supabase
			.from('lib_periodical_issues')
			.insert({
				institution_id: body.institution_id,
				subscription_id: subscriptionId,
				item_id: body.item_id ?? null,
				volume_number: body.volume_number ?? null,
				issue_number: body.issue_number ?? null,
				issue_date: body.issue_date ?? null,
				received_date: body.received_date ?? new Date().toISOString().split('T')[0],
				cover_date: body.cover_date ?? null,
				pages: body.pages ?? null,
				receipt_status: body.receipt_status ?? 'received',
				is_bound: body.is_bound ?? false,
			})
			.select()
			.single()

		if (issueError) {
			console.error('Error creating periodical issue:', issueError)
			if (issueError.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check subscription_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to record issue' }, { status: 500 })
		}

		// Increment received_issues count on subscription
		if (issue.receipt_status === 'received') {
			await supabase
				.from('lib_periodical_subscriptions')
				.update({
					received_issues: (subscription.received_issues ?? 0) + 1,
					updated_at: new Date().toISOString(),
				})
				.eq('id', subscriptionId)
		}

		return NextResponse.json(issue, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating periodical issue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
