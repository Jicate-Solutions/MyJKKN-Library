/**
 * Desk lookup for a loan: GET /api/lib/circulation/lookup?barcode=…
 *
 * Used on return and renew — the librarian scans the book and this finds the
 * open loan behind it, with the borrower, the due date and what is owed if it
 * came back late, calculated with this campus's own fine rules.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { getInstitutionSettings, chargeableLateDays, capFine } from '@/lib/library/institution-settings'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const barcode = (searchParams.get('barcode') ?? '').trim()

		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!barcode) {
			return NextResponse.json({ error: 'Scan a book or type its accession number' }, { status: 400 })
		}

		const supabase = getSupabaseServer()

		let itemQuery = supabase
			.from('lib_items')
			.select('id, accession_number, institution_id, catalogue:lib_catalogue_records(title)')
			.or(`accession_number.eq.${barcode},barcode.eq.${barcode}`)
			.limit(1)

		if (guard.institutionId) itemQuery = itemQuery.eq('institution_id', guard.institutionId)

		const { data: item } = await itemQuery.maybeSingle()
		if (!item) {
			return NextResponse.json({ error: `No book found for "${barcode}"` }, { status: 404 })
		}

		const { data: loan } = await supabase
			.from('lib_lending_transactions')
			.select(`
				*,
				member:lib_members(id, member_number, display_name, member_category, email, phone)
			`)
			.eq('item_id', item.id)
			.in('transaction_status', ['active', 'overdue'])
			.order('issued_at', { ascending: false })
			.limit(1)
			.maybeSingle()

		if (!loan) {
			return NextResponse.json(
				{ error: 'This copy is not on loan — nothing to return or renew' },
				{ status: 404 }
			)
		}

		const settings = await getInstitutionSettings(item.institution_id)
		const today = new Date().toISOString().split('T')[0]
		const lateDays = chargeableLateDays(loan.due_date, today, settings)

		let chargePerDay = 0
		if (lateDays > 0) {
			const { data: category } = await supabase
				.from('lib_member_categories')
				.select('late_charge_per_day')
				.eq('institution_id', item.institution_id)
				.eq('category_code', loan.member?.member_category ?? '')
				.maybeSingle()
			chargePerDay = category?.late_charge_per_day ?? 0
		}

		return NextResponse.json({
			...loan,
			item: {
				id: item.id,
				accession_number: item.accession_number,
				title: (item.catalogue as { title?: string } | null)?.title ?? null,
			},
			is_overdue: lateDays > 0,
			overdue_days: lateDays,
			charge_per_day: chargePerDay,
			estimated_charge: capFine(lateDays * chargePerDay, settings),
		})
	} catch (error) {
		console.error('Unexpected error looking up loan:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
