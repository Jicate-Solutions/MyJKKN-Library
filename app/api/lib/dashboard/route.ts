/**
 * The dashboard's live figures: GET /api/lib/dashboard?institution_id=…
 *
 * Three cards on the dashboard had nothing behind them. Overdue Items and
 * Pending Charges were drawn as a dash whatever the library held, and On Loan
 * Today read the NAAC report's count of every loan made this year, which is
 * not what is out today. This answers the three questions the cards ask, as
 * of now:
 *
 *   * on_loan_now     — books in members' hands, overdue ones included
 *   * overdue         — of those, the ones past their due date, counted the
 *                       way the Overdue page counts them, so the card and the
 *                       page it opens agree
 *   * pending_charges — money still owed on late charges (unpaid or part
 *                       paid), and on how many charges
 *
 * Scoped like every library route: one college, or every college together for
 * a super admin on All Institutions.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		const supabase = getSupabaseServer()
		const today = new Date().toISOString().split('T')[0]

		const openLoans = () => {
			let query = supabase
				.from('lib_lending_transactions')
				.select('id', { count: 'exact', head: true })
				.in('transaction_status', ['active', 'overdue'])
			if (institutionId) query = query.eq('institution_id', institutionId)
			return query
		}

		// Three questions, none waiting on another
		const [onLoan, overdue, charges] = await Promise.all([
			openLoans(),
			openLoans().lt('due_date', today),
			fetchAllRows<{ net_payable: number | string | null }>(range => {
				let query = supabase
					.from('lib_late_charges')
					.select('net_payable')
					.in('payment_status', ['unpaid', 'partial'])
				if (institutionId) query = query.eq('institution_id', institutionId)
				return query.range(range.from, range.to)
			}),
		])

		const failed = onLoan.error ?? overdue.error ?? charges.error
		if (failed) {
			console.error('Error reading the dashboard figures:', failed)
			return NextResponse.json({ error: 'Failed to load the dashboard figures' }, { status: 500 })
		}

		const owed = (charges.data ?? []).reduce((sum, row) => sum + Number(row.net_payable ?? 0), 0)

		return NextResponse.json({
			on_loan_now: onLoan.count ?? 0,
			overdue: overdue.count ?? 0,
			pending_charges_amount: Math.round(owed * 100) / 100,
			pending_charges_count: (charges.data ?? []).length,
			as_of: today,
		})
	} catch (error) {
		console.error('Unexpected error reading the dashboard figures:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
