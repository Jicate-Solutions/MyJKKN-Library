import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { getInstitutionSettings, chargeableLateDays, capFine } from '@/lib/library/institution-settings'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const { institution_id, transaction_id, return_date } = body

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!transaction_id) {
			return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 })
		}

		// Fetch the lending transaction
		const { data: transaction, error: txError } = await supabase
			.from('lib_lending_transactions')
			.select(`
				*,
				member:lib_members(id, member_category)
			`)
			.eq('id', transaction_id)
			.single()

		if (txError || !transaction) {
			return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
		}

		if (transaction.transaction_status === 'returned') {
			return NextResponse.json({ error: 'Transaction already returned' }, { status: 400 })
		}

		// Use provided return_date or today
		const effectiveReturnDate = return_date ?? new Date().toISOString().split('T')[0]

		// Same rules the return desk uses, so the preview and the charge agree
		const settings = await getInstitutionSettings(institution_id)
		const overdueDays = chargeableLateDays(transaction.due_date, effectiveReturnDate, settings)

		// Get charge rate from member category
		const memberCategory = transaction.member?.member_category
		let chargePerDay = 1.0

		if (memberCategory) {
			const { data: categoryConfig } = await supabase
				.from('lib_member_categories')
				.select('late_charge_per_day')
				.eq('institution_id', institution_id)
				.eq('category_code', memberCategory)
				.maybeSingle()

			chargePerDay = categoryConfig?.late_charge_per_day ?? 1.0
		}

		const totalCharge = capFine(overdueDays * chargePerDay, settings)

		return NextResponse.json({
			transaction_id,
			due_date: transaction.due_date,
			effective_return_date: effectiveReturnDate,
			overdue_days: overdueDays,
			charge_per_day: chargePerDay,
			total_charge: totalCharge,
			is_overdue: overdueDays > 0,
			grace_days: settings.fine_grace_days,
			working_days_only: settings.fine_working_days_only,
		})
	} catch (error) {
		console.error('Unexpected error calculating charge:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
