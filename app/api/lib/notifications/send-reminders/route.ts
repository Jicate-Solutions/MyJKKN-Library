/**
 * Library reminder emails — librarian-triggered, never automatic.
 *
 * POST /api/lib/notifications/send-reminders
 *   { institution_id, type: 'overdue' | 'hold_available', member_ids?, dry_run? }
 *
 * Sends through the existing `send-email` Supabase Edge Function (Resend).
 * Every attempt is written to lib_notification_log; a unique index on that table
 * stops the same loan/hold being emailed twice on the same day.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { overdueReminderEmail, holdAvailableEmail } from '@/lib/library/notification-templates'

type ReminderType = 'overdue' | 'hold_available'

interface Recipient {
	memberId: string
	email: string
	memberName: string
	referenceId: string
	subject: string
	html: string
}

interface SendOutcome {
	member: string
	email: string
	status: 'sent' | 'failed' | 'skipped'
	reason?: string
}

const EDGE_FUNCTION = 'send-email'

/** Calls the send-email Edge Function. Returns null on success, else the reason. */
async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
	const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

	if (!baseUrl || !serviceKey) {
		return 'Supabase URL or service role key is not configured'
	}

	try {
		const response = await fetch(`${baseUrl}/functions/v1/${EDGE_FUNCTION}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${serviceKey}`,
			},
			body: JSON.stringify({ to, subject, html }),
		})

		if (response.status === 404) {
			return `The "${EDGE_FUNCTION}" Edge Function is not deployed on this project`
		}

		if (!response.ok) {
			const detail = await response.json().catch(() => ({}))
			return detail.error || `Email service returned ${response.status}`
		}

		return null
	} catch (error) {
		return error instanceof Error ? error.message : 'Could not reach the email service'
	}
}

/** Best-effort logging — a missing log table must not fail a real send. */
async function logAttempt(
	supabase: ReturnType<typeof getSupabaseServer>,
	row: Record<string, unknown>
): Promise<void> {
	const { error } = await supabase.from('lib_notification_log').insert(row)
	if (error) {
		console.warn('[Library reminders] Could not write notification log:', error.message)
	}
}

/** Loans past their due date, with the member and item details needed for the email. */
async function collectOverdue(
	supabase: ReturnType<typeof getSupabaseServer>,
	institutionId: string,
	memberIds: string[] | null
): Promise<{ recipients: Recipient[]; skipped: SendOutcome[] }> {
	const today = new Date().toISOString().split('T')[0]

	let query = supabase
		.from('lib_lending_transactions')
		.select(`
			id,
			due_date,
			member:lib_members(id, display_name, email, member_category, is_active),
			item:lib_items(accession_number, catalogue_record:lib_catalogue_records(title))
		`)
		.eq('institution_id', institutionId)
		.lt('due_date', today)
		.in('transaction_status', ['active', 'overdue'])

	if (memberIds?.length) query = query.in('member_id', memberIds)

	const { data, error } = await query.range(0, 9999)
	if (error) throw new Error(error.message)

	// Charge rates differ per member category
	const { data: categories } = await supabase
		.from('lib_member_categories')
		.select('category_code, late_charge_per_day')
		.eq('institution_id', institutionId)

	const rateByCategory = new Map(
		(categories || []).map(c => [c.category_code, Number(c.late_charge_per_day) || 0])
	)

	const todayMs = new Date(today).getTime()
	const recipients: Recipient[] = []
	const skipped: SendOutcome[] = []

	for (const tx of data || []) {
		const member = tx.member as any
		const item = tx.item as any
		const title = item?.catalogue_record?.title ?? 'Library item'
		const name = member?.display_name ?? 'Member'

		if (!member?.email) {
			skipped.push({ member: name, email: '—', status: 'skipped', reason: 'No email address on record' })
			continue
		}

		const overdueDays = Math.max(
			0,
			Math.floor((todayMs - new Date(tx.due_date).getTime()) / 86_400_000)
		)
		const rate = rateByCategory.get(member.member_category) ?? 0

		const { subject, html } = overdueReminderEmail({
			memberName: name,
			title,
			accessionNumber: item?.accession_number ?? null,
			dueDate: tx.due_date,
			overdueDays,
			estimatedCharge: rate > 0 ? overdueDays * rate : null,
		})

		recipients.push({ memberId: member.id, email: member.email, memberName: name, referenceId: tx.id, subject, html })
	}

	return { recipients, skipped }
}

/** Holds whose item is waiting on the reservation shelf. */
async function collectHolds(
	supabase: ReturnType<typeof getSupabaseServer>,
	institutionId: string,
	memberIds: string[] | null
): Promise<{ recipients: Recipient[]; skipped: SendOutcome[] }> {
	let query = supabase
		.from('lib_resource_holds')
		.select(`
			id,
			hold_expires_at,
			member:lib_members(id, display_name, email),
			item:lib_items(accession_number),
			catalogue_record:lib_catalogue_records(title)
		`)
		.eq('institution_id', institutionId)
		.eq('hold_status', 'available')

	if (memberIds?.length) query = query.in('member_id', memberIds)

	const { data, error } = await query.range(0, 9999)
	if (error) throw new Error(error.message)

	const recipients: Recipient[] = []
	const skipped: SendOutcome[] = []

	for (const hold of data || []) {
		const member = hold.member as any
		const record = hold.catalogue_record as any
		const item = hold.item as any
		const title = record?.title ?? 'Reserved item'
		const name = member?.display_name ?? 'Member'

		if (!member?.email) {
			skipped.push({ member: name, email: '—', status: 'skipped', reason: 'No email address on record' })
			continue
		}

		const { subject, html } = holdAvailableEmail({
			memberName: name,
			title,
			accessionNumber: item?.accession_number ?? null,
			expiryDate: hold.hold_expires_at ?? null,
		})

		recipients.push({ memberId: member.id, email: member.email, memberName: name, referenceId: hold.id, subject, html })
	}

	return { recipients, skipped }
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const institutionId: string | undefined = body.institution_id
		const type: ReminderType = body.type
		const memberIds: string[] | null = Array.isArray(body.member_ids) && body.member_ids.length
			? body.member_ids
			: null
		const dryRun: boolean = body.dry_run === true

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (type !== 'overdue' && type !== 'hold_available') {
			return NextResponse.json(
				{ error: "type must be 'overdue' or 'hold_available'" },
				{ status: 400 }
			)
		}

		const { recipients, skipped } = type === 'overdue'
			? await collectOverdue(supabase, institutionId, memberIds)
			: await collectHolds(supabase, institutionId, memberIds)

		// Lets the UI show "12 members will be emailed" before anything is sent
		if (dryRun) {
			return NextResponse.json({
				dry_run: true,
				would_send: recipients.length,
				skipped: skipped.length,
				results: skipped,
			})
		}

		if (recipients.length === 0) {
			return NextResponse.json({
				sent: 0,
				failed: 0,
				skipped: skipped.length,
				results: skipped,
				message: skipped.length > 0
					? 'Nobody could be emailed — no email addresses on record'
					: 'Nothing to send',
			})
		}

		const results: SendOutcome[] = [...skipped]
		let sent = 0
		let failed = 0

		// Sequential on purpose: Resend rate-limits bursts, and a librarian
		// clicking once expects a reliable result over a fast one.
		for (const r of recipients) {
			const failure = await sendEmail(r.email, r.subject, r.html)

			if (failure) {
				failed++
				results.push({ member: r.memberName, email: r.email, status: 'failed', reason: failure })
			} else {
				sent++
				results.push({ member: r.memberName, email: r.email, status: 'sent' })
			}

			await logAttempt(supabase, {
				institution_id: institutionId,
				member_id: r.memberId,
				notification_type: type,
				reference_id: r.referenceId,
				recipient_email: r.email,
				subject: r.subject,
				send_status: failure ? 'failed' : 'sent',
				error_message: failure,
				sent_by: body.sent_by ?? null,
			})
		}

		return NextResponse.json({ sent, failed, skipped: skipped.length, results })
	} catch (error) {
		console.error('Error sending library reminders:', error)
		return NextResponse.json({ error: 'Failed to send reminders' }, { status: 500 })
	}
}
