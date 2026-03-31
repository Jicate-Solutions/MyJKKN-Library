import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const fiscalYear = searchParams.get('fiscal_year')

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		let query = supabase
			.from('lib_budget_heads')
			.select('*')
			.eq('institution_id', institutionId)
			.eq('is_active', true)

		if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

		const { data, error } = await query.order('budget_head_code', { ascending: true })

		if (error) {
			console.error('Error fetching budget utilisation:', error)
			return NextResponse.json({ error: 'Failed to fetch budget data' }, { status: 500 })
		}

		const heads = data ?? []

		// Per-head enrichment
		const enriched = heads.map((head) => {
			const spent = Number(head.spent_amount ?? 0)
			const committed = Number(head.committed_amount ?? 0)
			const allocated = Number(head.allocated_amount ?? 0)
			const available = allocated - spent - committed
			const utilisedPercent = allocated > 0 ? Math.round((spent / allocated) * 100) : 0
			const committedPercent = allocated > 0 ? Math.round((committed / allocated) * 100) : 0

			return {
				...head,
				spent_amount: spent,
				committed_amount: committed,
				allocated_amount: allocated,
				available_amount: available,
				utilisation_percent: utilisedPercent,
				committed_percent: committedPercent,
				is_over_budget: spent > allocated,
			}
		})

		// Summary totals
		const totals = enriched.reduce(
			(acc, head) => ({
				total_allocated: acc.total_allocated + head.allocated_amount,
				total_spent: acc.total_spent + head.spent_amount,
				total_committed: acc.total_committed + head.committed_amount,
				total_available: acc.total_available + head.available_amount,
			}),
			{ total_allocated: 0, total_spent: 0, total_committed: 0, total_available: 0 }
		)

		const overallUtilisationPercent =
			totals.total_allocated > 0
				? Math.round((totals.total_spent / totals.total_allocated) * 100)
				: 0

		// Group by resource_type for chart data
		const byResourceType: Record<
			string,
			{ allocated: number; spent: number; committed: number; available: number }
		> = {}
		for (const head of enriched) {
			const type = head.resource_type ?? 'other'
			if (!byResourceType[type]) {
				byResourceType[type] = { allocated: 0, spent: 0, committed: 0, available: 0 }
			}
			byResourceType[type].allocated += head.allocated_amount
			byResourceType[type].spent += head.spent_amount
			byResourceType[type].committed += head.committed_amount
			byResourceType[type].available += head.available_amount
		}

		return NextResponse.json({
			institution_id: institutionId,
			fiscal_year: fiscalYear ?? 'all',
			heads: enriched,
			totals: {
				...totals,
				overall_utilisation_percent: overallUtilisationPercent,
			},
			by_resource_type: byResourceType,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		console.error('Unexpected error generating budget utilisation report:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
