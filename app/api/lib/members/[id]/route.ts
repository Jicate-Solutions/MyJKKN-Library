/**
 * One member, as the library knows them: GET /api/lib/members/[id]
 *
 * `id` is the kinded MyJKKN id the list hands out — `learner:<uuid>` or
 * `facilitator:<uuid>`. Who they are is re-read from MyJKKN; what this library
 * knows about them is read here: the books in their hands, the money they owe,
 * what they are waiting for, and when they last walked in. It is what the
 * members page shows when a row is opened, so the librarian can act on a
 * person without carrying their number to another screen.
 *
 * One college at a time, always — whose fines, whose loans, whose door are
 * all questions about one library, so `institution_id` is required and the
 * caller must be allowed to see it.
 *
 * Nothing is written, changed or deleted here: a member is an Active learner
 * or staff member in MyJKKN, and MyJKKN owns all three of those verbs. PUT and
 * DELETE still answer so a page left open from before the change is told why.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { getInstitutionSettings, chargeableLateDays } from '@/lib/library/institution-settings'
import { personByMyjkknId, myjkknConfigured } from '@/lib/library/myjkkn-directory'

const GONE = {
	error:
		'Members are no longer kept in the library — everyone Active in MyJKKN is already a member of their college\'s library. Names and details are changed in MyJKKN.',
}

/** How many of their visits are shown. Enough to see a habit, not a history. */
const RECENT_VISITS = 5

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const [kind, myjkknId] = id.split(':')
		if ((kind !== 'learner' && kind !== 'facilitator') || !myjkknId) {
			return NextResponse.json({ error: 'That is not a member id' }, { status: 400 })
		}

		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'Choose a college first — a member belongs to one library' }, { status: 400 })
		}

		if (!myjkknConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so members cannot be read' },
				{ status: 503 }
			)
		}

		const person = await personByMyjkknId(institutionId, kind, myjkknId)
		if (!person) {
			return NextResponse.json(
				{ error: 'No such member — they may no longer be Active in MyJKKN' },
				{ status: 404 }
			)
		}

		const supabase = getSupabaseServer()

		// Everything the library holds on them, read together. The borrower row
		// exists only once they have taken a book, so a first-timer comes back with
		// three empty lists — which is the truth, not a fault.
		const [{ data: borrowerRow }, { data: visitRows }, settings] = await Promise.all([
			supabase
				.from('lib_borrowers')
				.select(`
					id, is_delinquent, first_borrowed_at,
					loans:lib_lending_transactions(
						id, issued_at, due_date, renewal_count, transaction_status,
						item:lib_items(accession_number, catalogue:lib_catalogue_records(title))
					),
					charges:lib_late_charges(
						id, net_payable, payment_status, created_at,
						transaction:lib_lending_transactions(item:lib_items(accession_number, catalogue:lib_catalogue_records(title)))
					),
					holds:lib_resource_holds(id, hold_status, catalogue:lib_catalogue_records(title))
				`)
				.eq('institution_id', institutionId)
				.eq('myjkkn_id', person.myjkkn_id)
				.in('loans.transaction_status', ['active', 'overdue'])
				.in('charges.payment_status', ['unpaid', 'partial'])
				.in('holds.hold_status', ['pending', 'available'])
				.order('due_date', { ascending: true, referencedTable: 'loans' })
				.order('created_at', { ascending: false, referencedTable: 'charges' })
				.maybeSingle(),
			supabase
				.from('lib_member_visits')
				.select('visit_date, entry_time, exit_time')
				.eq('institution_id', institutionId)
				.eq('myjkkn_id', person.myjkkn_id)
				.order('created_at', { ascending: false })
				.limit(RECENT_VISITS),
			getInstitutionSettings(institutionId),
		])

		const borrower = (borrowerRow as any) ?? null
		const today = new Date().toISOString().split('T')[0]

		// Supabase types a nested one-to-one join as an array, so the joined rows
		// are read back through unknown rather than fighting the generated shape.
		const loans = ((borrower?.loans ?? []) as any[]).map(loan => {
			const item = loan.item as unknown as {
				accession_number?: string
				catalogue?: { title?: string } | null
			} | null
			const lateDays = chargeableLateDays(loan.due_date, today, settings)
			return {
				id: loan.id,
				title: item?.catalogue?.title ?? 'Unknown title',
				accession_number: item?.accession_number ?? null,
				issued_at: loan.issued_at,
				due_date: loan.due_date,
				renewal_count: loan.renewal_count ?? 0,
				is_overdue: lateDays > 0,
				overdue_days: lateDays,
			}
		})

		const charges = ((borrower?.charges ?? []) as any[]).map(charge => {
			const transaction = charge.transaction as unknown as {
				item?: { accession_number?: string; catalogue?: { title?: string } | null } | null
			} | null
			return {
				id: charge.id,
				title: transaction?.item?.catalogue?.title ?? 'Unknown title',
				accession_number: transaction?.item?.accession_number ?? null,
				net_payable: Number(charge.net_payable ?? 0),
				payment_status: charge.payment_status,
				created_at: charge.created_at,
			}
		})

		const holds = ((borrower?.holds ?? []) as any[]).map(hold => {
			const catalogue = hold.catalogue as unknown as { title?: string } | null
			return { id: hold.id, hold_status: hold.hold_status, title: catalogue?.title ?? 'Unknown title' }
		})

		return NextResponse.json({
			id,
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
			is_delinquent: borrower?.is_delinquent ?? false,
			has_borrowed: !!borrower,
			first_borrowed_at: borrower?.first_borrowed_at ?? null,
			outstanding_charges: charges.reduce((sum, c) => sum + c.net_payable, 0),
			loans,
			charges,
			holds,
			visits: visitRows ?? [],
		})
	} catch (error) {
		console.error('Unexpected error reading a member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT() {
	return NextResponse.json(GONE, { status: 410 })
}

export async function DELETE() {
	return NextResponse.json(GONE, { status: 410 })
}
