import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const mode = searchParams.get('mode') ?? 'monthly' // 'daily' | 'monthly'
		const fromDate = searchParams.get('from_date')
		const toDate = searchParams.get('to_date')

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		// Determine date range
		let startDate = fromDate
		let endDate = toDate
		if (!startDate || !endDate) {
			const now = new Date()
			if (mode === 'daily') {
				// Default: last 30 days
				const from = new Date(now)
				from.setDate(now.getDate() - 29)
				startDate = from.toISOString().split('T')[0]
				endDate = now.toISOString().split('T')[0]
			} else {
				// Default: last 12 months
				const from = new Date(now)
				from.setMonth(now.getMonth() - 11)
				from.setDate(1)
				startDate = from.toISOString().split('T')[0]
				endDate = now.toISOString().split('T')[0]
			}
		}

		// Fetch transactions in date range
		const { data: transactions, error: txError } = await supabase
			.from('lib_lending_transactions')
			.select('id, issued_at, returned_at, transaction_status, due_date, member_id')
			.eq('institution_id', institutionId)
			.gte('issued_at', `${startDate}T00:00:00Z`)
			.lte('issued_at', `${endDate}T23:59:59Z`)
			.range(0, 9999)

		if (txError) {
			console.error('Error fetching circulation data:', txError)
			return NextResponse.json({ error: 'Failed to fetch circulation data' }, { status: 500 })
		}

		// Fetch visits in date range
		const { data: visits } = await supabase
			.from('lib_member_visits')
			.select('id, visit_date')
			.eq('institution_id', institutionId)
			.gte('visit_date', startDate!)
			.lte('visit_date', endDate!)
			.range(0, 9999)

		const txData = transactions ?? []
		const visitData = visits ?? []

		// Group by period
		const periodMap: Record<
			string,
			{ issues: number; returns: number; overdue: number; visits: number; unique_members: Set<string> }
		> = {}

		const getPeriodKey = (dateStr: string): string => {
			if (mode === 'daily') return dateStr.substring(0, 10)
			return dateStr.substring(0, 7) // YYYY-MM
		}

		for (const tx of txData) {
			const key = getPeriodKey(tx.issued_at)
			if (!periodMap[key]) {
				periodMap[key] = { issues: 0, returns: 0, overdue: 0, visits: 0, unique_members: new Set() }
			}
			periodMap[key].issues++
			periodMap[key].unique_members.add(tx.member_id)
			if (tx.returned_at) periodMap[key].returns++
			if (tx.transaction_status === 'overdue') periodMap[key].overdue++
		}

		for (const visit of visitData) {
			const key = getPeriodKey(visit.visit_date)
			if (!periodMap[key]) {
				periodMap[key] = { issues: 0, returns: 0, overdue: 0, visits: 0, unique_members: new Set() }
			}
			periodMap[key].visits++
		}

		// Build sorted summary array
		const summary = Object.entries(periodMap)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([period, stats]) => ({
				period,
				issues: stats.issues,
				returns: stats.returns,
				overdue_active: stats.overdue,
				visits: stats.visits,
				unique_members: stats.unique_members.size,
			}))

		// Totals
		const totals = summary.reduce(
			(acc, row) => ({
				issues: acc.issues + row.issues,
				returns: acc.returns + row.returns,
				visits: acc.visits + row.visits,
			}),
			{ issues: 0, returns: 0, visits: 0 }
		)

		return NextResponse.json({
			mode,
			from_date: startDate,
			to_date: endDate,
			institution_id: institutionId,
			summary,
			totals,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		console.error('Unexpected error generating circulation summary:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
