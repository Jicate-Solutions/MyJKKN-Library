/**
 * Issuing a book: POST /api/lib/circulation/issue
 *
 * This is the one place a person becomes a borrower. Everyone Active in MyJKKN
 * is already a member of their college's library — nobody is enrolled — so
 * until a book actually leaves the building there is nothing about them in this
 * database at all. The row in `lib_borrowers` is written here, and here only,
 * and only once every check below has passed: a refused issue leaves no trace
 * of a borrower who never borrowed.
 *
 * Body: { institution_id, item_id, myjkkn_id, person_kind }
 * `member_id` is still accepted, for a borrower this library already holds.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { logActivity } from '@/lib/library/activity-log'
import { personByMyjkknId, type DirectoryPerson } from '@/lib/library/myjkkn-directory'
import { ensureBorrower, findBorrower, borrowerById } from '@/lib/library/borrower'

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		const { institution_id, item_id, issued_by } = body
		const myjkknId: string | null = body.myjkkn_id ?? null
		const personKind: 'learner' | 'facilitator' | null =
			body.person_kind === 'learner' || body.person_kind === 'facilitator' ? body.person_kind : null
		const memberId: string | null = body.member_id ?? null

		if (!institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!item_id) {
			return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
		}
		if (!myjkknId && !memberId) {
			return NextResponse.json({ error: 'Scan the member card first' }, { status: 400 })
		}
		if (myjkknId && !personKind) {
			return NextResponse.json({ error: 'person_kind must be learner or facilitator' }, { status: 400 })
		}

		// Who is borrowing.
		//
		// Checked against MyJKKN again rather than trusted from the request: the
		// desk sends back what it found, and a book must not leave the building
		// on the strength of a value somebody could type. This also refuses a
		// person from another campus outright — `personByMyjkknId` only ever
		// looks inside this college's own MyJKKN institutions.
		let person: DirectoryPerson | null = null
		let borrower = null

		if (myjkknId && personKind) {
			person = await personByMyjkknId(institution_id, personKind, myjkknId)
			if (!person) {
				return NextResponse.json(
					{ error: 'This person is not an Active member of this college in MyJKKN' },
					{ status: 404 }
				)
			}
			borrower = await findBorrower(supabase, institution_id, person.myjkkn_id)
		} else if (memberId) {
			// A borrower this library already holds — including one carried over
			// from before members came from MyJKKN.
			borrower = await borrowerById(supabase, institution_id, memberId)
			if (!borrower) {
				return NextResponse.json({ error: 'Member not found' }, { status: 404 })
			}
		}

		const memberCategory = person?.member_category ?? borrower?.member_category ?? ''

		// The book, the campus rules and how much they are already holding are
		// three separate questions that do not depend on each other's answers,
		// so they are asked together rather than one after another with the desk
		// waiting through all three.
		const [
			{ data: item, error: itemError },
			settings,
			{ count: booksHeld },
			{ data: categoryConfig },
		] = await Promise.all([
			supabase
				.from('lib_items')
				// The title and shelf mark ride along so the reply can carry the new
				// loan in the shape the desk lists loans in — the desk used to read
				// the whole member again after every book just to add one line.
				.select('id, status, is_lendable, institution_id, catalogue_record_id, accession_number, catalogue:lib_catalogue_records(title, call_number)')
				.eq('id', item_id)
				.single(),
			getInstitutionSettings(institution_id),
			// The limit is on books held at once, not books borrowed over the
			// year — returning one frees the slot immediately. An overdue book is
			// still in the member's hands, so it must count: checking only
			// 'active' would let someone holding three overdue books take three
			// more. Somebody with no borrower row has never held anything.
			borrower
				? supabase
					.from('lib_lending_transactions')
					.select('*', { count: 'exact', head: true })
					.eq('member_id', borrower.id)
					.in('transaction_status', ['active', 'overdue'])
				: Promise.resolve({ count: 0 }),
			supabase
				.from('lib_member_categories')
				.select('loan_period_days, max_items_allowed, renewal_limit')
				.eq('institution_id', institution_id)
				.eq('category_code', memberCategory)
				.maybeSingle(),
		])

		// 1. The book is here, and lendable
		if (itemError || !item) {
			return NextResponse.json({ error: 'Item not found' }, { status: 404 })
		}
		if (item.institution_id !== institution_id) {
			return NextResponse.json({ error: 'Item does not belong to this institution' }, { status: 400 })
		}
		if (item.status !== 'available') {
			return NextResponse.json(
				{ error: `Item is not available for lending — current status: ${item.status}` },
				{ status: 400 }
			)
		}
		if (!item.is_lendable) {
			return NextResponse.json({ error: 'Item is marked as non-lendable (reference only)' }, { status: 400 })
		}

		// 2. Nothing outstanding stands in the way.
		//
		// Whether unpaid charges stop a member borrowing is a campus decision:
		// Pharmacy lets them take the next book while a fine is still open.
		// Somebody who has never borrowed owes nothing, by definition.
		if (borrower?.is_delinquent && settings.block_borrowing_when_fine_due) {
			return NextResponse.json(
				{ error: 'Member has unpaid late charges — please clear outstanding charges before lending' },
				{ status: 400 }
			)
		}

		// 3. They are not already at their limit
		const loanPeriodDays = body.loan_period_days ?? categoryConfig?.loan_period_days ?? 14
		const maxItemsAllowed = categoryConfig?.max_items_allowed ?? 3

		if ((booksHeld ?? 0) >= maxItemsAllowed) {
			return NextResponse.json(
				{
					error: `Member is already holding ${booksHeld} of ${maxItemsAllowed} books — return one before taking another`,
				},
				{ status: 400 }
			)
		}

		// 4. Everything has passed, so this person is now a borrower.
		//
		// Written no earlier than this on purpose: a refused issue must not
		// leave a borrower row behind for somebody who never took a book.
		if (!borrower && person) {
			const created = await ensureBorrower(supabase, institution_id, person)
			if (!created.borrower) {
				return NextResponse.json({ error: created.error ?? 'Could not record who is borrowing' }, { status: 500 })
			}
			borrower = created.borrower
		}

		if (!borrower) {
			return NextResponse.json({ error: 'Could not identify who is borrowing' }, { status: 400 })
		}

		// 5. Due date
		const today = new Date()
		const dueDate = new Date(today)
		dueDate.setDate(today.getDate() + loanPeriodDays)
		const dueDateStr = dueDate.toISOString().split('T')[0]

		// 6. The loan itself
		const { data: transaction, error: txError } = await supabase
			.from('lib_lending_transactions')
			.insert({
				institution_id,
				item_id,
				member_id: borrower.id,
				issued_at: new Date().toISOString(),
				due_date: dueDateStr,
				issued_by: issued_by ?? null,
				renewal_count: 0,
				transaction_status: 'active',
			})
			.select()
			.single()

		if (txError) {
			console.error('Error creating lending transaction:', txError)
			return NextResponse.json({ error: 'Failed to create lending transaction' }, { status: 500 })
		}

		// 7. The copy is now out
		const { error: itemUpdateError } = await supabase
			.from('lib_items')
			.update({ status: 'on_loan', updated_at: new Date().toISOString() })
			.eq('id', item_id)

		if (itemUpdateError) {
			console.error('Error updating item status:', itemUpdateError)
			// Attempt to rollback the transaction record
			await supabase.from('lib_lending_transactions').delete().eq('id', transaction.id)
			return NextResponse.json({ error: 'Failed to update item status — transaction rolled back' }, { status: 500 })
		}

		// 8. Close off the hold this book answers, and write the log line.
		//
		// Both only happen once the loan is safely recorded, and neither is
		// waiting on the other — so they go together rather than one after the
		// next. That is one less round trip with the borrower still at the
		// counter, and a round trip here costs about 65ms whatever it carries.
		//
		// Both are still awaited. Letting them run unattended would be faster
		// again, but on a serverless host the function can be frozen the moment
		// the reply is sent, and a hold left sitting as 'available' after the
		// book has walked out is worse than 65ms.
		const [{ data: fulfilledHolds }] = await Promise.all([
			supabase
				.from('lib_resource_holds')
				.update({
					hold_status: 'fulfilled',
					checked_out_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq('member_id', borrower.id)
				.eq('item_id', item_id)
				.eq('hold_status', 'available')
				.select('id'),

			logActivity(request, {
				action: 'create',
				resource_type: 'loan',
				resource_id: '/circulation',
				institution_id,
				new_values: transaction,
				metadata: {
					member_id: borrower.id,
					member_number: borrower.member_number,
					item_id,
					due_date: dueDateStr,
					loan_period_days: loanPeriodDays,
				},
			}),
		])

		// The new loan as the desk lists a member's loans, and the count it
		// changes, so the member card can move on without another lookup.
		const catalogue = (item as { catalogue?: { title?: string; call_number?: string } | null }).catalogue ?? null
		const renewalLimit = categoryConfig?.renewal_limit ?? 0
		const fulfilledHoldId = (fulfilledHolds as { id: string }[] | null)?.[0]?.id ?? null

		return NextResponse.json(
			{
				success: true,
				transaction,
				due_date: dueDateStr,
				loan_period_days: loanPeriodDays,
				borrower_id: borrower.id,
				member_number: borrower.member_number,
				display_name: borrower.display_name,
				items_on_loan: (booksHeld ?? 0) + 1,
				fulfilled_hold_id: fulfilledHoldId,
				loan: {
					id: transaction.id,
					item_id,
					accession_number: (item as { accession_number?: string }).accession_number ?? null,
					title: catalogue?.title ?? 'Unknown title',
					call_number: catalogue?.call_number ?? null,
					issued_at: transaction.issued_at,
					due_date: dueDateStr,
					renewal_count: 0,
					renewal_limit: renewalLimit,
					can_renew: renewalLimit > 0,
					is_overdue: false,
					overdue_days: 0,
					estimated_charge: 0,
				},
			},
			{ status: 201 }
		)
	} catch (error) {
		console.error('Unexpected error during issue:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
