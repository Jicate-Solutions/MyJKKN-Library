/**
 * Clearing a late fine at the desk: POST /api/lib/circulation/settle
 *
 * Body: { institution_id, mode: 'paid' | 'waive', waiver_reason?,
 *         transaction_id? | charge_id? }
 *
 * A late book now has to have its fine cleared before it can be returned or
 * renewed, so this is the one step between the book on the counter and the
 * Return or Renew button. It lives under circulation, not under charges,
 * because the assistant librarian runs the desk and has to be able to clear
 * the fine there — the charges page stays the librarian's.
 *
 *   * `transaction_id` — a book still out. The fine is worked out now, by this
 *     college's own rules, less anything already cleared on it, and what is
 *     left is written as a charge already paid or waived. Nothing is taken
 *     from the request but the choice: the amount is the server's, so the desk
 *     cannot clear a smaller fine than is owed.
 *   * `charge_id` — a charge already on record with money still on it, from a
 *     return made before this rule. It is marked paid or waived in full.
 *
 * Paid is the whole amount, taken at the counter. Waived is the whole amount
 * let off, with the reason — the charges page still offers part-payments and
 * part-waivers for the librarian.
 *
 * Asked twice for the same loan, the second answer is the charge the first one
 * wrote: a double click must not record the money twice.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { setDelinquent } from '@/lib/library/borrower'
import { loanFineStatus } from '@/lib/library/late-fine'

type Mode = 'paid' | 'waive'

/** A member who owes nothing any more stops being marked as owing. */
async function refreshDelinquency(supabase: ReturnType<typeof getSupabaseServer>, memberId: string) {
	const { count } = await supabase
		.from('lib_late_charges')
		.select('*', { count: 'exact', head: true })
		.eq('member_id', memberId)
		.in('payment_status', ['unpaid', 'partial'])
	if ((count ?? 0) === 0) await setDelinquent(supabase, memberId, false)
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		const mode: Mode | null = body.mode === 'paid' || body.mode === 'waive' ? body.mode : null
		const reason = String(body.waiver_reason ?? '').trim()
		// Who cleared it. collected_by and waiver_approved_by are uuid columns, so
		// it is the signed-in staff member's id - their MyJKKN staff id, or their
		// sign-in id - and never their name: a name there made Postgres refuse
		// the row (22P02), and every Paid and Waive answered 'Could not settle
		// the fine'. An id that is not a uuid is left out rather than refused.
		const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		const who = UUID.test(guard.caller.userId ?? '') ? guard.caller.userId : null
		const today = new Date().toISOString().split('T')[0]

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!mode) {
			return NextResponse.json({ error: "mode must be 'paid' or 'waive'" }, { status: 400 })
		}
		if (mode === 'waive' && !reason) {
			return NextResponse.json({ error: 'Say why the fine is being let off' }, { status: 400 })
		}
		if (!body.transaction_id && !body.charge_id) {
			return NextResponse.json({ error: 'Name the loan or the charge to settle' }, { status: 400 })
		}

		const settledFields = (total: number, alreadyWaived: number) => mode === 'paid'
			? {
				payment_status: 'paid',
				net_payable: 0,
				payment_date: today,
				collected_by: who,
			}
			: {
				payment_status: 'waived',
				net_payable: 0,
				waiver_amount: Math.min(total, alreadyWaived),
				waiver_reason: reason,
				waiver_approved_by: who,
			}

		// ── A charge already on record ─────────────────────────────────────
		if (body.charge_id) {
			const { data: existing } = await supabase
				.from('lib_late_charges')
				.select('*')
				.eq('id', body.charge_id)
				.eq('institution_id', institutionId)
				.maybeSingle()

			if (!existing) {
				return NextResponse.json({ error: 'That charge is not in this library' }, { status: 404 })
			}
			if (existing.payment_status === 'paid' || existing.payment_status === 'waived') {
				return NextResponse.json(existing)
			}

			const total = Number(existing.total_charge ?? 0)
			// Waiving lets off whatever is still owed, on top of anything let off
			// before; paying takes what is still owed.
			const alreadyWaived = Number(existing.waiver_amount ?? 0) + Number(existing.net_payable ?? 0)

			const { data: saved, error } = await supabase
				.from('lib_late_charges')
				.update({ ...settledFields(total, alreadyWaived), updated_at: new Date().toISOString() })
				.eq('id', existing.id)
				.select()
				.single()

			if (error) {
				console.error('Error settling a late charge at the desk:', error)
				return NextResponse.json({ error: 'Could not settle the fine' }, { status: 500 })
			}

			await Promise.all([
				refreshDelinquency(supabase, existing.member_id),
				logActivity(request, {
					action: 'update',
					resource_type: 'late_charge',
					resource_id: '/circulation',
					institution_id: institutionId,
					old_values: existing,
					new_values: saved,
					metadata: { settled: mode, charge_id: existing.id, amount: Number(existing.net_payable ?? 0) },
				}),
			])

			return NextResponse.json(saved)
		}

		// ── A book still out ───────────────────────────────────────────────
		const [{ data: loan }, settings] = await Promise.all([
			supabase
				.from('lib_lending_transactions')
				.select('id, member_id, due_date, transaction_status')
				.eq('id', body.transaction_id)
				.eq('institution_id', institutionId)
				.in('transaction_status', ['active', 'overdue'])
				.maybeSingle(),
			getInstitutionSettings(institutionId),
		])

		if (!loan) {
			return NextResponse.json({ error: 'That book is not on loan in this library' }, { status: 404 })
		}

		const fineStatus = await loanFineStatus(supabase, loan, institutionId, settings, today)
		const { fine, due } = fineStatus
		if (fine.amount <= 0) {
			return NextResponse.json({ error: 'This book is not late — there is no fine to settle' }, { status: 400 })
		}

		// Cleared already — a second click, or a second desk — so the answer is
		// the charge that cleared it, and nothing new is written.
		if (due <= 0) return NextResponse.json(fineStatus.lastSettled)

		const { data: saved, error } = await supabase
			.from('lib_late_charges')
			.insert({
				institution_id: institutionId,
				transaction_id: loan.id,
				member_id: loan.member_id,
				overdue_days: fine.overdue_days,
				charge_per_day: fine.charge_per_day,
				total_charge: due,
				waiver_amount: mode === 'waive' ? due : 0,
				...settledFields(due, due),
			})
			.select()
			.single()

		if (error) {
			console.error('Error recording a late fine at the desk:', error)
			return NextResponse.json({ error: 'Could not settle the fine' }, { status: 500 })
		}

		await Promise.all([
			refreshDelinquency(supabase, loan.member_id),
			logActivity(request, {
				action: 'create',
				resource_type: 'late_charge',
				resource_id: '/circulation',
				institution_id: institutionId,
				new_values: saved,
				metadata: {
					settled: mode,
					transaction_id: loan.id,
					overdue_days: fine.overdue_days,
					amount: due,
				},
			}),
		])

		return NextResponse.json(saved, { status: 201 })
	} catch (error) {
		console.error('Unexpected error settling a late fine:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
