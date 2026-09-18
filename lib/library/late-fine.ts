/**
 * The fine on a loan that is still out, and how much of it is still owed.
 *
 * A late book used to be charged only when it came back: the return wrote an
 * unpaid charge, and a renewal wrote nothing at all — it moved the due date on
 * from today, and the days the book had already been late were simply
 * forgotten. A learner two days late who renewed instead of returning paid
 * nothing, in every college.
 *
 * So the fine is now settled before the book moves. The desk works it out
 * here, the librarian marks it Paid or Waived, and only then will the return
 * or the renewal go through. Both routes, both lookups and the settle route
 * read these same functions, so the amount on the screen, the amount recorded
 * and the amount the server insists on are always one number.
 *
 * Server side only: the caller hands over its own client and settings.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'
import { chargeableLateDays, capFine, type InstitutionSettings } from '@/lib/library/institution-settings'

type Supabase = ReturnType<typeof getSupabaseServer>

/**
 * What a day late costs when the borrower's category names no rate.
 *
 * The return route has always charged this, so it stays the rule. The two desk
 * lookups used to fall back to nothing instead, which would have shown a
 * member with no category as owing ₹0 while the server asked for ₹1 a day.
 */
export const DEFAULT_CHARGE_PER_DAY = 1.0

export interface LateFine {
	/** Chargeable days, after this college's grace period and Sunday rule. */
	overdue_days: number
	charge_per_day: number
	/** The whole fine as of today, after this college's per-item cap. Zero when not late. */
	amount: number
}

/** A day's rate as a number, whatever shape the category row gave it in. */
export const chargePerDayFrom = (rate: number | string | null | undefined): number => {
	const value = Number(rate)
	return rate === null || rate === undefined || !Number.isFinite(value) ? DEFAULT_CHARGE_PER_DAY : value
}

/** The fine for a given number of late days at a given rate, capped. */
export function fineFor(overdueDays: number, chargePerDay: number, settings: InstitutionSettings): LateFine {
	if (overdueDays <= 0) return { overdue_days: 0, charge_per_day: chargePerDay, amount: 0 }
	return {
		overdue_days: overdueDays,
		charge_per_day: chargePerDay,
		amount: capFine(overdueDays * chargePerDay, settings),
	}
}

/**
 * The fine on one open loan, as of today, by this college's own rules.
 *
 * The rate comes from the borrower's category in this college. Only asked for
 * when the book is actually late, so an on-time return costs no extra read.
 */
export async function lateFineForLoan(
	supabase: Supabase,
	loan: { due_date: string; member_id: string },
	institutionId: string,
	settings: InstitutionSettings,
	today: string = new Date().toISOString().split('T')[0]
): Promise<LateFine> {
	const overdueDays = chargeableLateDays(loan.due_date, today, settings)
	if (overdueDays <= 0) return fineFor(0, DEFAULT_CHARGE_PER_DAY, settings)

	const { data: borrower } = await supabase
		.from('lib_borrowers')
		.select('member_category')
		.eq('id', loan.member_id)
		.maybeSingle()

	const { data: category } = await supabase
		.from('lib_member_categories')
		.select('late_charge_per_day')
		.eq('institution_id', institutionId)
		.eq('category_code', borrower?.member_category ?? '')
		.maybeSingle()

	return fineFor(overdueDays, chargePerDayFrom(category?.late_charge_per_day), settings)
}

/** The columns read off a charge that cleared some of a fine. */
export interface SettledChargeRow {
	id: string
	transaction_id: string
	total_charge: number | string | null
	payment_status: string
	created_at: string
	[column: string]: unknown
}

/**
 * The charges that count towards this loan's lateness as it stands.
 *
 * Paid or waived, and made on or after the current due date. A loan that was
 * late, settled, renewed and is now late again owes for the new lateness: the
 * charge from before the renewal was made before the new due date, so it
 * does not count against it.
 */
function coveringCharges(charges: SettledChargeRow[], loan: { id: string; due_date: string }) {
	return charges.filter(charge =>
		charge.transaction_id === loan.id
		&& (charge.payment_status === 'paid' || charge.payment_status === 'waived')
		&& charge.created_at.slice(0, 10) >= loan.due_date.slice(0, 10)
	)
}

/**
 * How much of the fine is still owed, once what was already cleared is taken off.
 *
 * Whatever was cleared counts in full. A fine paid for two days on one day,
 * with the book still out the next, leaves only the third day owing — asking
 * for the whole fine again would charge the first two days twice.
 */
export function outstandingFine(
	fine: LateFine,
	charges: SettledChargeRow[],
	loan: { id: string; due_date: string }
): number {
	if (fine.amount <= 0) return 0
	const cleared = coveringCharges(charges, loan)
		.reduce((sum, charge) => sum + Number(charge.total_charge ?? 0), 0)
	return Math.max(0, Math.round((fine.amount - cleared) * 100) / 100)
}

/** The paid or waived charges on these loans, newest first. */
export async function settledChargesFor(
	supabase: Supabase,
	transactionIds: string[]
): Promise<SettledChargeRow[]> {
	if (transactionIds.length === 0) return []
	const { data } = await supabase
		.from('lib_late_charges')
		.select('*')
		.in('transaction_id', transactionIds)
		.in('payment_status', ['paid', 'waived'])
		.order('created_at', { ascending: false })
	return (data ?? []) as SettledChargeRow[]
}

export interface LoanFineStatus {
	fine: LateFine
	/** What is still to be paid or waived before the book may move. */
	due: number
	/** The newest charge that cleared some of this fine — what the desk shows as collected or waived. */
	lastSettled: SettledChargeRow | null
}

/** The fine on one open loan, what is still owed on it, and what cleared it. */
export async function loanFineStatus(
	supabase: Supabase,
	loan: { id: string; due_date: string; member_id: string },
	institutionId: string,
	settings: InstitutionSettings,
	today: string = new Date().toISOString().split('T')[0]
): Promise<LoanFineStatus> {
	const fine = await lateFineForLoan(supabase, loan, institutionId, settings, today)
	if (fine.amount <= 0) return { fine, due: 0, lastSettled: null }

	const charges = await settledChargesFor(supabase, [loan.id])
	return {
		fine,
		due: outstandingFine(fine, charges, loan),
		lastSettled: coveringCharges(charges, loan)[0] ?? null,
	}
}

/** Said when a return or renewal is refused for a fine still owed. */
export function fineUnpaidMessage(status: LoanFineStatus, action: 'returned' | 'renewed'): string {
	const days = `${status.fine.overdue_days} day${status.fine.overdue_days === 1 ? '' : 's'}`
	return `This book is ${days} late — the ₹${status.due} fine must be marked Paid or Waived before it can be ${action}`
}
