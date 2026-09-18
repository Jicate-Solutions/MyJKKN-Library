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
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { loanFineStatus } from '@/lib/library/late-fine'

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
			return NextResponse.json({ error: `No book found for "${barcode}"`, reason: 'no_item' }, { status: 404 })
		}

		// The open loan needs the item's id and the rules need its institution, but
		// neither needs the other — read one after the other, the settings waited
		// out the loan query for nothing. The scanner is at a desk with a queue.
		const [{ data: loan }, settings] = await Promise.all([
			supabase
				.from('lib_lending_transactions')
				.select(`
					*,
					member:lib_borrowers(id, member_number, display_name, member_category, email, phone)
				`)
				.eq('item_id', item.id)
				.in('transaction_status', ['active', 'overdue'])
				.order('issued_at', { ascending: false })
				.limit(1)
				.maybeSingle(),
			getInstitutionSettings(item.institution_id),
		])

		if (!loan) {
			return NextResponse.json(
				{ error: 'This copy is not on loan — nothing to return or renew', reason: 'not_on_loan' },
				{ status: 404 }
			)
		}

		// The fine by the same rule the return and renew routes insist on, and
		// whether it has been cleared already — a late book can only go back or
		// be renewed once it has, so the desk has to know before it offers the
		// button.
		const today = new Date().toISOString().split('T')[0]
		const { fine, due } = await loanFineStatus(supabase, loan, item.institution_id, settings, today)

		return NextResponse.json({
			...loan,
			item: {
				id: item.id,
				accession_number: item.accession_number,
				title: (item.catalogue as { title?: string } | null)?.title ?? null,
			},
			is_overdue: fine.overdue_days > 0,
			overdue_days: fine.overdue_days,
			charge_per_day: fine.charge_per_day,
			estimated_charge: fine.amount,
			fine_due: due,
			fine_settled: due <= 0,
		})
	} catch (error) {
		console.error('Unexpected error looking up loan:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
