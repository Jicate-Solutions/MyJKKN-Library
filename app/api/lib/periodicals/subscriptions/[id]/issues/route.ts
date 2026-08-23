import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord, guardRecordRow } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_periodical_subscriptions', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()

		// A weekly running for twenty years is past a thousand issues, and a
		// single request stops there without saying so.
		//
		// The accessioned copy used to be joined on too, but the issues table
		// reads none of it — every column it draws is already on the issue row —
		// so that join was fetched and discarded on every load.
		const { data, error } = await fetchAllRows<Record<string, any>>(range =>
			supabase
				.from('lib_periodical_issues')
				.select('*')
				.eq('subscription_id', id)
				.order('issue_date', { ascending: false })
				.range(range.from, range.to)
		)

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

		// The guard reads the subscription this issue belongs to, so the route
		// does not read the same row again straight afterwards
		const guard = await guardRecordRow<{
			id: string
			institution_id: string | null
			catalogue_record_id: string | null
			received_issues: number | null
			expected_issues: number | null
		}>(
			request,
			'lib_periodical_subscriptions',
			subscriptionId,
			'id, catalogue_record_id, institution_id, received_issues, expected_issues'
		)
		if (!guard.ok) return guard.response

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const subscription = guard.row

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
				remarks: body.remarks ?? null,
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
