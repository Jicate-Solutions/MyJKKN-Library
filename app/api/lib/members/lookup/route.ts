/**
 * Desk lookup for a member: GET /api/lib/members/lookup?barcode=…
 *
 * The circulation page calls this when the librarian scans a college ID card
 * or types the ID by hand — both arrive here as the same `barcode` value, so
 * the desk works with or without a scanner.
 *
 * Returns the photo and name, because the person handing over the card and the
 * person the card belongs to are not always the same, and the librarian needs
 * to see that at a glance.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { getInstitutionSettings, chargeableLateDays, capFine } from '@/lib/library/institution-settings'
// The shared reader: it times MyJKKN out and remembers the answer, where the
// copy that used to live here would wait as long as MyJKKN cared to take.
import { fetchLearnerPhoto } from '@/lib/library/learner-photo'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const barcode = (searchParams.get('barcode') ?? '').trim()

		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!barcode) {
			return NextResponse.json({ error: 'Scan a card or type an ID' }, { status: 400 })
		}

		const supabase = getSupabaseServer()

		// The member number IS the card number — for learners it is their roll
		// number. Matched case-insensitively and whole, so typing `pb23001` by
		// hand finds the same person a scanner does, but `PB2300` finds nobody.
		let query = supabase
			.from('lib_members')
			.select('*')
			.ilike('member_number', barcode)
			.limit(1)

		if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

		const { data: matches, error } = await query

		if (error) {
			console.error('Error looking up member:', error)
			return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
		}

		const member = matches?.[0]
		if (!member) {
			return NextResponse.json({ error: `No member found for "${barcode}"` }, { status: 404 })
		}

		// Everything else the desk needs is answerable the moment we know who
		// this is, and none of it depends on any of the rest — so it all goes at
		// once. Asked one after another, as it used to be, five round trips of
		// waiting stood between the scan and the name appearing on screen.
		const [
			{ count: onLoan },
			{ data: unpaid },
			{ data: category },
			{ data: openLoans },
			settings,
			photo,
		] = await Promise.all([
			// Books in hand right now — overdue ones are still held, so they
			// count towards the limit and must show in the same number.
			supabase
				.from('lib_lending_transactions')
				.select('*', { count: 'exact', head: true })
				.eq('member_id', member.id)
				.in('transaction_status', ['active', 'overdue']),
			supabase
				.from('lib_late_charges')
				.select('net_payable')
				.eq('member_id', member.id)
				.eq('payment_status', 'unpaid'),
			supabase
				.from('lib_member_categories')
				.select('category_name, max_items_allowed, loan_period_days, renewal_limit, late_charge_per_day')
				.eq('institution_id', member.institution_id)
				.eq('category_code', member.member_category)
				.maybeSingle(),
			// The books actually in this person's hands. The desk needs these on
			// the same screen as the member: "what have you got, and what is due"
			// is the first question asked at the counter, and it should not need
			// a second search to answer.
			supabase
				.from('lib_lending_transactions')
				.select(`
					id, issued_at, due_date, renewal_count, transaction_status,
					item:lib_items(
						id, accession_number, barcode,
						catalogue:lib_catalogue_records(title, subtitle, call_number)
					)
				`)
				.eq('member_id', member.id)
				.in('transaction_status', ['active', 'overdue'])
				.order('due_date', { ascending: true }),
			getInstitutionSettings(member.institution_id),
			fetchLearnerPhoto(member.learner_id),
		])

		const outstanding = (unpaid || []).reduce(
			(sum, c: { net_payable: number | null }) => sum + (c.net_payable ?? 0),
			0
		)

		const today = new Date().toISOString().split('T')[0]
		const chargePerDay = category?.late_charge_per_day ?? 0
		const renewalLimit = category?.renewal_limit ?? 0

		const loans = (openLoans || []).map(loan => {
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
			...member,
			photo_url: photo,
			items_on_loan: onLoan ?? 0,
			outstanding_charges: outstanding,
			category_name: category?.category_name ?? member.member_category,
			max_items_allowed: category?.max_items_allowed ?? null,
			loan_period_days: category?.loan_period_days ?? null,
			loans,
		})
	} catch (error) {
		console.error('Unexpected error looking up member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
