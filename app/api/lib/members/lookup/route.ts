/**
 * Desk lookup for a member: GET /api/lib/members/lookup?barcode=…
 *
 * The circulation page calls this when the librarian scans a college ID card
 * or types the ID by hand — both arrive here as the same `barcode` value, so
 * the desk works with or without a scanner.
 *
 * Who the person is comes from MyJKKN: every Active learner and staff member
 * of this college is a member, and nobody is enrolled here first. What the
 * library itself knows about them — books in hand, fines owing — comes from
 * `lib_borrowers`, and that row exists only if they have borrowed before. A
 * first-time borrower is found perfectly well; they simply have nothing out
 * and nothing owing, which is the truth.
 *
 * Returns the photo and name, because the person handing over the card and the
 * person the card belongs to are not always the same, and the librarian needs
 * to see that at a glance.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { getInstitutionSettings, chargeableLateDays, capFine } from '@/lib/library/institution-settings'
import { personByCardNumber, myjkknConfigured } from '@/lib/library/myjkkn-directory'
import { findBorrower } from '@/lib/library/borrower'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const barcode = (searchParams.get('barcode') ?? '').trim()

		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!barcode) {
			return NextResponse.json({ error: 'Scan a card or type an ID' }, { status: 400 })
		}

		// The desk always works one college at a time — whose rules apply, and
		// whose fines are owed, are both questions about one library.
		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json(
				{ error: 'Choose a college first — the desk serves one library at a time' },
				{ status: 400 }
			)
		}

		if (!myjkknConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so cards cannot be checked' },
				{ status: 503 }
			)
		}

		const person = await personByCardNumber(institutionId, barcode)
		if (!person) {
			return NextResponse.json(
				{ error: `No member found for "${barcode}" — check the number, or that they are Active in MyJKKN` },
				{ status: 404 }
			)
		}

		const supabase = getSupabaseServer()

		// What this library knows about them. Null until their first book.
		const borrower = await findBorrower(supabase, institutionId, person.myjkkn_id)

		// Everything else is answerable the moment we know who this is, and none
		// of it depends on any of the rest — so it all goes at once. Asked one
		// after another, several round trips of waiting would stand between the
		// scan and the name appearing on screen.
		const [
			{ count: onLoan },
			{ data: unpaid },
			{ data: category },
			{ data: openLoans },
			settings,
		] = await Promise.all([
			// Books in hand right now — overdue ones are still held, so they
			// count towards the limit and must show in the same number.
			borrower
				? supabase
					.from('lib_lending_transactions')
					.select('*', { count: 'exact', head: true })
					.eq('member_id', borrower.id)
					.in('transaction_status', ['active', 'overdue'])
				: Promise.resolve({ count: 0 }),
			borrower
				? supabase
					.from('lib_late_charges')
					.select('net_payable')
					.eq('member_id', borrower.id)
					.eq('payment_status', 'unpaid')
				: Promise.resolve({ data: [] as { net_payable: number | null }[] }),
			supabase
				.from('lib_member_categories')
				.select('category_name, max_items_allowed, loan_period_days, renewal_limit, late_charge_per_day')
				.eq('institution_id', institutionId)
				.eq('category_code', person.member_category)
				.maybeSingle(),
			// The books actually in this person's hands. The desk needs these on
			// the same screen as the member: "what have you got, and what is due"
			// is the first question asked at the counter, and it should not need
			// a second search to answer.
			borrower
				? supabase
					.from('lib_lending_transactions')
					.select(`
						id, issued_at, due_date, renewal_count, transaction_status,
						item:lib_items(
							id, accession_number, barcode,
							catalogue:lib_catalogue_records(title, subtitle, call_number)
						)
					`)
					.eq('member_id', borrower.id)
					.in('transaction_status', ['active', 'overdue'])
					.order('due_date', { ascending: true })
				: Promise.resolve({ data: [] as any[] }),
			getInstitutionSettings(institutionId),
		])

		const outstanding = (unpaid || []).reduce(
			(sum, c: { net_payable: number | null }) => sum + (c.net_payable ?? 0),
			0
		)

		const today = new Date().toISOString().split('T')[0]
		const chargePerDay = category?.late_charge_per_day ?? 0
		const renewalLimit = category?.renewal_limit ?? 0

		const loans = (openLoans || []).map((loan: any) => {
			// Supabase types a nested one-to-one join as an array, so read it back
			// through unknown rather than fighting the generated shape.
			const item = loan.item as unknown as {
				id: string
				accession_number: string
				barcode: string | null
				catalogue: { title?: string; subtitle?: string; call_number?: string } | null
			} | null

			const lateDays = chargeableLateDays(loan.due_date, today, settings)

			return {
				id: loan.id,
				item_id: item?.id ?? null,
				accession_number: item?.accession_number ?? null,
				title: item?.catalogue?.title ?? 'Unknown title',
				call_number: item?.catalogue?.call_number ?? null,
				issued_at: loan.issued_at,
				due_date: loan.due_date,
				renewal_count: loan.renewal_count ?? 0,
				renewal_limit: renewalLimit,
				can_renew: (loan.renewal_count ?? 0) < renewalLimit,
				is_overdue: lateDays > 0,
				overdue_days: lateDays,
				estimated_charge: capFine(lateDays * chargePerDay, settings),
			}
		})

		return NextResponse.json({
			// The borrower row where there is one, so a page holding this can act
			// on their loans. Null for somebody who has never taken a book — the
			// issue below is what creates it.
			id: borrower?.id ?? null,
			borrower_id: borrower?.id ?? null,

			// Who they are, from MyJKKN. This is what an issue is made against.
			myjkkn_id: person.myjkkn_id,
			person_kind: person.person_kind,
			institution_id: institutionId,
			member_number: person.member_number,
			member_category: person.member_category,
			display_name: person.display_name,
			email: person.email,
			phone: person.phone,
			photo_url: person.photo_url,
			role_label: person.role_label,

			// Active in MyJKKN is what membership now means, and only Active
			// people are ever returned above.
			is_active: true,
			is_delinquent: borrower?.is_delinquent ?? false,
			has_borrowed: !!borrower,

			items_on_loan: onLoan ?? 0,
			outstanding_charges: outstanding,
			category_name: category?.category_name ?? person.member_category,
			max_items_allowed: category?.max_items_allowed ?? null,
			loan_period_days: category?.loan_period_days ?? null,
			loans,
		})
	} catch (error) {
		console.error('Unexpected error looking up member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
