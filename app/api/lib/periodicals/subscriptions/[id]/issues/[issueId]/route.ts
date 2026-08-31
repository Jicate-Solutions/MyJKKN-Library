/**
 * One recorded issue: PUT and DELETE
 * /api/lib/periodicals/subscriptions/[id]/issues/[issueId]
 *
 * An issue is logged the day it arrives, but what is known about it changes
 * afterwards: one marked missing turns up a fortnight later, a page count was
 * mistyped, the supplier answers a claim. Until now an issue could only be
 * added, so a correction meant living with the wrong line.
 *
 * The subscription's `received_issues` count is kept in step here, because it
 * is what the Received scorecard and the Issues (Rcvd/Exp) column read. An edit
 * that moves an issue into or out of `received` moves that count with it, and a
 * deleted issue that had been counted gives its place back.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardRecordRow } from '@/lib/auth/api-guard'

interface SubscriptionRow {
	id: string
	institution_id: string | null
	received_issues: number | null
}

/**
 * The subscription this issue hangs from, with the caller checked against it.
 *
 * Authorisation is deliberately on the subscription and not on the issue: it is
 * the subscription that carries the institution, and it is what the caller
 * named in the url. The issue is then confirmed to belong to it, so a valid id
 * from another college's subscription cannot be edited through this one.
 */
async function loadIssue(
	request: Request,
	subscriptionId: string,
	issueId: string
) {
	const guard = await guardRecordRow<SubscriptionRow>(
		request,
		'lib_periodical_subscriptions',
		subscriptionId,
		'id, institution_id, received_issues'
	)
	if (!guard.ok) return { ok: false as const, response: guard.response }

	const supabase = getSupabaseServer()

	const { data: issue, error } = await supabase
		.from('lib_periodical_issues')
		.select('*')
		.eq('id', issueId)
		.maybeSingle()

	if (error) {
		console.error('Error reading periodical issue:', error)
		return {
			ok: false as const,
			response: NextResponse.json({ error: 'Failed to read the issue' }, { status: 500 }),
		}
	}

	if (!issue || issue.subscription_id !== subscriptionId) {
		return {
			ok: false as const,
			response: NextResponse.json({ error: 'Issue not found' }, { status: 404 }),
		}
	}

	return { ok: true as const, supabase, subscription: guard.row, issue }
}

/** Moves the subscription's received count by one, never below zero. */
async function shiftReceivedCount(
	supabase: ReturnType<typeof getSupabaseServer>,
	subscriptionId: string,
	current: number | null,
	delta: number
) {
	if (delta === 0) return
	await supabase
		.from('lib_periodical_subscriptions')
		.update({
			received_issues: Math.max(0, (current ?? 0) + delta),
			updated_at: new Date().toISOString(),
		})
		.eq('id', subscriptionId)
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string; issueId: string }> }
) {
	try {
		const { id: subscriptionId, issueId } = await params
		const loaded = await loadIssue(request, subscriptionId, issueId)
		if (!loaded.ok) return loaded.response

		const { supabase, subscription, issue } = loaded
		const body = await request.json()

		const receiptStatus = body.receipt_status ?? issue.receipt_status

		// Only the fields the form sends are touched. Anything the form does not
		// carry — item_id, is_bound — keeps whatever it already held.
		const { data: updated, error } = await supabase
			.from('lib_periodical_issues')
			.update({
				volume_number: body.volume_number ?? null,
				issue_number: body.issue_number ?? null,
				issue_date: body.issue_date ?? null,
				// A date given is used. With none given, an issue put back to
				// expected loses the one it had — it has not arrived after all —
				// while any other status keeps the day it was recorded as arriving.
				received_date: body.received_date
					?? (receiptStatus === 'expected' ? null : issue.received_date),
				cover_date: body.cover_date ?? null,
				pages: body.pages ?? null,
				receipt_status: receiptStatus,
				remarks: body.remarks ?? null,
			})
			.eq('id', issueId)
			.select()
			.single()

		if (error) {
			console.error('Error updating periodical issue:', error)
			return NextResponse.json({ error: 'Failed to update the issue' }, { status: 500 })
		}

		// A missing issue that finally turned up now counts; one moved back out of
		// received gives its place back.
		const wasReceived = issue.receipt_status === 'received'
		const isReceived = updated.receipt_status === 'received'
		await shiftReceivedCount(
			supabase,
			subscriptionId,
			subscription.received_issues,
			(isReceived ? 1 : 0) - (wasReceived ? 1 : 0)
		)

		return NextResponse.json(updated)
	} catch (error) {
		console.error('Unexpected error updating periodical issue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; issueId: string }> }
) {
	try {
		const { id: subscriptionId, issueId } = await params
		const loaded = await loadIssue(request, subscriptionId, issueId)
		if (!loaded.ok) return loaded.response

		const { supabase, subscription, issue } = loaded

		const { error } = await supabase
			.from('lib_periodical_issues')
			.delete()
			.eq('id', issueId)

		if (error) {
			console.error('Error deleting periodical issue:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Cannot delete — this issue has related records' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to delete the issue' }, { status: 500 })
		}

		if (issue.receipt_status === 'received') {
			await shiftReceivedCount(supabase, subscriptionId, subscription.received_issues, -1)
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting periodical issue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
