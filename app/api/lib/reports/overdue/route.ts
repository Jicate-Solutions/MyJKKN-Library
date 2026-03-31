import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const memberCategory = searchParams.get('member_category')
		const minDaysOverdue = parseInt(searchParams.get('min_days_overdue') ?? '1', 10)

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const today = new Date().toISOString().split('T')[0]

		let query = supabase
			.from('lib_lending_transactions')
			.select(`
				id,
				issued_at,
				due_date,
				renewal_count,
				transaction_status,
				member_id,
				item_id,
				member:lib_members(
					id,
					member_number,
					display_name,
					email,
					phone,
					member_category,
					is_delinquent
				),
				item:lib_items(
					id,
					accession_number,
					barcode,
					catalogue_record:lib_catalogue_records(
						id,
						title,
						isbn,
						call_number,
						resource_format
					)
				)
			`)
			.eq('institution_id', institutionId)
			.lt('due_date', today)
			.in('transaction_status', ['active', 'overdue'])

		const { data, error } = await query
			.order('due_date', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching overdue report:', error)
			return NextResponse.json({ error: 'Failed to fetch overdue report' }, { status: 500 })
		}

		const todayMs = new Date(today).getTime()

		// Enrich with overdue_days and estimated_charge
		let rows = (data ?? []).map((tx) => {
			const dueDateMs = new Date(tx.due_date).getTime()
			const overdueDays = Math.max(
				0,
				Math.floor((todayMs - dueDateMs) / (1000 * 60 * 60 * 24))
			)
			return {
				...tx,
				overdue_days: overdueDays,
			}
		})

		// Filter by minimum overdue days
		rows = rows.filter((r) => r.overdue_days >= minDaysOverdue)

		// Filter by member category if requested
		if (memberCategory) {
			rows = rows.filter(
				(r) =>
					(r.member as { member_category?: string } | null)?.member_category === memberCategory
			)
		}

		// Batch fetch charge rates by member category
		const { data: categories } = await supabase
			.from('lib_member_categories')
			.select('category_code, late_charge_per_day')
			.eq('institution_id', institutionId)

		const chargeRateMap = Object.fromEntries(
			(categories ?? []).map((c) => [c.category_code, c.late_charge_per_day ?? 1.0])
		)

		// Add estimated charge
		const enriched = rows.map((row) => {
			const memberCat = (row.member as { member_category?: string } | null)?.member_category ?? ''
			const chargePerDay = chargeRateMap[memberCat] ?? 1.0
			const estimatedCharge = row.overdue_days * chargePerDay

			return {
				...row,
				charge_per_day: chargePerDay,
				estimated_charge: estimatedCharge,
			}
		})

		// Summary statistics
		const summary = {
			total_overdue: enriched.length,
			total_estimated_charges: enriched.reduce((sum, r) => sum + r.estimated_charge, 0),
			by_category: {} as Record<string, { count: number; total_charge: number }>,
			by_overdue_bracket: {
				'1-7_days': enriched.filter((r) => r.overdue_days <= 7).length,
				'8-30_days': enriched.filter((r) => r.overdue_days > 7 && r.overdue_days <= 30).length,
				'31-90_days': enriched.filter((r) => r.overdue_days > 30 && r.overdue_days <= 90).length,
				'over_90_days': enriched.filter((r) => r.overdue_days > 90).length,
			},
		}

		for (const row of enriched) {
			const cat = (row.member as { member_category?: string } | null)?.member_category ?? 'unknown'
			if (!summary.by_category[cat]) summary.by_category[cat] = { count: 0, total_charge: 0 }
			summary.by_category[cat].count++
			summary.by_category[cat].total_charge += row.estimated_charge
		}

		return NextResponse.json({
			institution_id: institutionId,
			as_of: today,
			data: enriched,
			summary,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		console.error('Unexpected error generating overdue report:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
