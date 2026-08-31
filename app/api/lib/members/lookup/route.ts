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

		// Everything this library knows about them, in one read.
		//
		// It used to be two: find the borrower row, then go back for their loans,
		// their charges and their holds now that we had its id. Those second
		// queries could not start until the first came home, and a round trip to
		// the database costs about 65ms whatever it asks — so the librarian spent
		// that twice for one scan of one card.
		//
		// Asking for them underneath the borrower collapses it to one. Each list
		// is narrowed on its own terms, and a member who has never borrowed still
		// comes back with three empty lists rather than not coming back at all —
		// both checked against the live database before this was written.
		//
		// The category rules and the campus policy hang off nothing, so they ride
		// alongside rather than after.
		const [
			{ data: borrowerRow },
			{ data: category },
			settings,
		] = await Promise.all([
			supabase
				.from('lib_borrowers')
				.select(`
					id, institution_id, myjkkn_id, member_number, member_category,
					display_name, is_delinquent,
					loans:lib_lending_transactions(
						id, issued_at, due_date, renewal_count, transaction_status,
						item:lib_items(
							id, accession_number, barcode,
							catalogue:lib_catalogue_records(title, subtitle, call_number)
						)
					),
					charges:lib_late_charges(
						id, overdue_days, charge_per_day, total_charge, waiver_amount,
						net_payable, payment_status, created_at,
						transaction:lib_lending_transactions(
							id, due_date, returned_at,
							item:lib_items(
								accession_number,
								catalogue:lib_catalogue_records(title)
							)
						)
					),
					holds:lib_resource_holds(
						id, hold_status, hold_placed_at, hold_expires_at, notified_at,
						catalogue_record_id,
						catalogue:lib_catalogue_records(title, call_number)
					)
				`)
				.eq('institution_id', institutionId)
				.eq('myjkkn_id', person.myjkkn_id)
				// Books in hand right now — an overdue one is still held, so it
				// counts towards the limit and shows in the same number.
				.in('loans.transaction_status', ['active', 'overdue'])
				// Anything with money still on it. Reading only 'unpaid' left a
				// part-paid charge out of the total, so a member who had settled
				// fifty of a hundred rupees appeared to owe nothing.
				.in('charges.payment_status', ['unpaid', 'partial'])
				// Only live holds — one already fulfilled, cancelled or expired is
				// history, and the desk acts on what is still open.
				.in('holds.hold_status', ['pending', 'available'])
				.order('due_date', { ascending: true, referencedTable: 'loans' })
				.order('created_at', { ascending: false, referencedTable: 'charges' })
				.order('hold_placed_at', { ascending: true, referencedTable: 'holds' })
				.maybeSingle(),
			supabase
				.from('lib_member_categories')
				.select('category_name, max_items_allowed, loan_period_days, renewal_limit, late_charge_per_day')
				.eq('institution_id', institutionId)
				.eq('category_code', person.member_category)
				.maybeSingle(),
			getInstitutionSettings(institutionId),
		])

		// Null until their first book, exactly as before.
		const borrower = (borrowerRow as any) ?? null
		const openLoans: any[] = borrower?.loans ?? []
		const unpaid: any[] = borrower?.charges ?? []
		const openHolds: any[] = borrower?.holds ?? []
		// The filtered list is the count — no separate query to ask how many.
		const onLoan = openLoans.length

		const outstanding = unpaid.reduce(
			(sum, c: { net_payable: number | null }) => sum + Number(c.net_payable ?? 0),
			0
		)

		/**
		 * The charges the desk can settle, with the book each one is for.
		 *
		 * Supabase types a nested one-to-one join as an array, so the joined rows
		 * are read back through unknown rather than fighting the generated shape —
		 * the same way the loans below are.
		 */
		const charges = unpaid.map((charge: any) => {
			const transaction = charge.transaction as unknown as {
				id?: string
				due_date?: string
				returned_at?: string | null
				item?: { accession_number?: string; catalogue?: { title?: string } | null } | null
			} | null

			return {
				id: charge.id,
				overdue_days: charge.overdue_days ?? 0,
				charge_per_day: Number(charge.charge_per_day ?? 0),
				total_charge: Number(charge.total_charge ?? 0),
				waiver_amount: Number(charge.waiver_amount ?? 0),
				net_payable: Number(charge.net_payable ?? 0),
				payment_status: charge.payment_status,
				created_at: charge.created_at,
				due_date: transaction?.due_date ?? null,
				returned_at: transaction?.returned_at ?? null,
				accession_number: transaction?.item?.accession_number ?? null,
				title: transaction?.item?.catalogue?.title ?? 'Unknown title',
			}
		})

		/** What they are waiting for, in the order they joined the queue. */
		const holds = openHolds.map((hold: any) => {
			const catalogue = hold.catalogue as unknown as {
				title?: string
				call_number?: string
			} | null

			return {
				id: hold.id,
				catalogue_record_id: hold.catalogue_record_id,
				hold_status: hold.hold_status,
				hold_placed_at: hold.hold_placed_at,
				hold_expires_at: hold.hold_expires_at ?? null,
				notified_at: hold.notified_at ?? null,
				title: catalogue?.title ?? 'Unknown title',
				call_number: catalogue?.call_number ?? null,
			}
		})

		const today = new Date().toISOString().split('T')[0]
		const chargePerDay = category?.late_charge_per_day ?? 0
		const renewalLimit = category?.renewal_limit ?? 0

		const loans = openLoans.map((loan: any) => {
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

			items_on_loan: onLoan,
			outstanding_charges: outstanding,
			category_name: category?.category_name ?? person.member_category,
			max_items_allowed: category?.max_items_allowed ?? null,
			loan_period_days: category?.loan_period_days ?? null,

			// The three things the counter is asked about, on one answer: what
			// they are holding, what they are waiting for, what they owe.
			loans,
			holds,
			charges,
		})
	} catch (error) {
		console.error('Unexpected error looking up member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
