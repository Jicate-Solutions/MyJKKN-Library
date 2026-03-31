import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id') || searchParams.get('institutions_id')
		const academicYear = searchParams.get('academic_year') // e.g., "2024-25"

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		// Determine academic year date range
		// Academic year: June 1 to May 31
		let yearStartDate: string
		let yearEndDate: string

		if (academicYear) {
			const parts = academicYear.split('-')
			const startYear = parseInt(parts[0])
			yearStartDate = `${startYear}-06-01`
			yearEndDate = `${startYear + 1}-05-31`
		} else {
			// Default: current academic year
			const now = new Date()
			const month = now.getMonth() + 1 // 1-12
			const year = now.getFullYear()
			const startYear = month >= 6 ? year : year - 1
			yearStartDate = `${startYear}-06-01`
			yearEndDate = `${startYear + 1}-05-31`
		}

		// Fetch all metrics in parallel
		const [
			totalVolumesResult,
			volumesAddedResult,
			totalTitlesResult,
			annualVisitsResult,
			digitalResourcesResult,
			activeSubscriptionsResult,
			circulationResult,
			budgetResult,
			membersResult,
		] = await Promise.all([
			// 4.2.1 / 4.2.4 — Total volumes (all active items)
			supabase
				.from('lib_items')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.eq('is_active', true),

			// Volumes added this academic year
			supabase
				.from('lib_items')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.eq('is_active', true)
				.gte('accession_date', yearStartDate)
				.lte('accession_date', yearEndDate),

			// Total unique titles (catalogue records)
			supabase
				.from('lib_catalogue_records')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.eq('is_active', true),

			// 4.2.5 — Annual footfall
			supabase
				.from('lib_member_visits')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.gte('visit_date', yearStartDate)
				.lte('visit_date', yearEndDate),

			// 4.2.2 / 4.2.6 — E-resources (active, NAAC reportable)
			supabase
				.from('lib_digital_resources')
				.select('id, resource_type, resource_title, annual_cost')
				.eq('institution_id', institutionId)
				.eq('is_active', true)
				.eq('naac_reportable', true),

			// Active periodical subscriptions in fiscal year
			supabase
				.from('lib_periodical_subscriptions')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.eq('subscription_status', 'active'),

			// Lending transactions this academic year
			supabase
				.from('lib_lending_transactions')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.gte('issued_at', `${yearStartDate}T00:00:00Z`)
				.lte('issued_at', `${yearEndDate}T23:59:59Z`),

			// 4.2.3 — Annual expenditure on library resources
			supabase
				.from('lib_budget_heads')
				.select('resource_type, spent_amount, allocated_amount')
				.eq('institution_id', institutionId)
				.eq('is_active', true),

			// Total active members
			supabase
				.from('lib_members')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', institutionId)
				.eq('is_active', true),
		])

		// Aggregate budget by resource type
		const budgetByType: Record<string, { allocated: number; spent: number }> = {}
		let totalAnnualExpenditure = 0
		for (const head of budgetResult.data ?? []) {
			const type = head.resource_type ?? 'other'
			if (!budgetByType[type]) budgetByType[type] = { allocated: 0, spent: 0 }
			budgetByType[type].allocated += Number(head.allocated_amount ?? 0)
			budgetByType[type].spent += Number(head.spent_amount ?? 0)
			totalAnnualExpenditure += Number(head.spent_amount ?? 0)
		}

		// E-resource breakdown
		const digitalResources = digitalResourcesResult.data ?? []
		const eResourcesByType: Record<string, number> = {}
		for (const r of digitalResources) {
			eResourcesByType[r.resource_type] = (eResourcesByType[r.resource_type] ?? 0) + 1
		}
		const totalEResourceCost = digitalResources.reduce(
			(sum, r) => sum + Number(r.annual_cost ?? 0),
			0
		)

		// Compute average daily visits
		const totalAnnualVisits = annualVisitsResult.count ?? 0
		const workingDays = 250 // approximate working days in academic year
		const avgDailyVisits = Math.round(totalAnnualVisits / workingDays)

		// Build response matching LibNaacCriterion4Report type
		const metrics = {
			institution_id: institutionId,
			academic_year: academicYear ?? `${yearStartDate.substring(0, 4)}-${yearEndDate.substring(2, 4)}`,

			// Core counts
			total_volumes: totalVolumesResult.count ?? 0,
			volumes_added_this_year: volumesAddedResult.count ?? 0,
			total_titles: totalTitlesResult.count ?? 0,
			active_members: membersResult.count ?? 0,
			total_lending_transactions: circulationResult.count ?? 0,

			// Periodicals & digital
			print_journals_subscribed: activeSubscriptionsResult.count ?? 0,
			digital_resources_count: digitalResources.length,
			inflibnet_databases: digitalResources.filter((r) => r.resource_type === 'inflibnet').length,

			// Expenditure
			annual_books_expenditure: budgetByType['books']?.spent ?? 0,
			annual_journals_expenditure: budgetByType['periodicals']?.spent ?? 0,
			annual_digital_expenditure: budgetByType['digital']?.spent ?? 0,
			total_annual_expenditure: totalAnnualExpenditure,

			// Footfall
			daily_avg_footfall: avgDailyVisits,
			total_annual_visits: totalAnnualVisits,

			generated_at: new Date().toISOString(),
		}

		return NextResponse.json(metrics)
	} catch (error) {
		console.error('Unexpected error generating NAAC report:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
