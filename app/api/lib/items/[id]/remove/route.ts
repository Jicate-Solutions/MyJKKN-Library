/**
 * Removing one physical book: DELETE /api/lib/items/[id]/remove
 *
 * A line in the accession register is one object on a shelf. Copy 2 being
 * water-damaged says nothing about copies 1 and 3, so removing it must leave
 * them exactly where they are — only this accession number goes.
 *
 * The plain item DELETE refuses as soon as the copy has ever been issued,
 * because lib_lending_transactions references it with ON DELETE RESTRICT. Here
 * the closed history is removed with the book it describes, in reference order.
 *
 * Two things are never quietly destroyed:
 *   - a copy that is out with a member — the loan record is the only proof of
 *     who has it, and the book is not on the shelf to be removed anyway
 *   - an unpaid late charge — that is money owed, and deleting the loan behind
 *     it would erase the debt without anyone deciding to
 *
 * The title is left alone even when this was its last copy. A catalogue record
 * with no copies is what the library still knows about a book it no longer
 * holds, and dropping it would lose that.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardRecord } from '@/lib/auth/api-guard'

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_items', id)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()

		const { data: item } = await supabase
			.from('lib_items')
			.select('id, accession_number, catalogue_record_id')
			.eq('id', id)
			.maybeSingle()

		if (!item) {
			return NextResponse.json({ error: 'That copy is no longer in the register' }, { status: 404 })
		}

		const { data: loans } = await supabase
			.from('lib_lending_transactions')
			.select('id, transaction_status')
			.eq('item_id', id)

		const stillOut = (loans || []).some(l =>
			l.transaction_status === 'active' || l.transaction_status === 'overdue'
		)

		if (stillOut) {
			return NextResponse.json(
				{ error: `Accession ${item.accession_number} is out with a member — take it back before removing it` },
				{ status: 409 }
			)
		}

		const loanIds = (loans || []).map(l => l.id)

		if (loanIds.length > 0) {
			const { data: unpaid } = await supabase
				.from('lib_late_charges')
				.select('id')
				.in('transaction_id', loanIds)
				.in('payment_status', ['unpaid', 'partial'])

			if (unpaid && unpaid.length > 0) {
				return NextResponse.json(
					{
						error: `Accession ${item.accession_number} has ${unpaid.length === 1 ? 'an unpaid late charge' : `${unpaid.length} unpaid late charges`} against it — settle or waive ${unpaid.length === 1 ? 'it' : 'them'} first`,
					},
					{ status: 409 }
				)
			}

			// Innermost reference first, or each delete is refused by the one
			// pointing at it.
			const { error: chargeError } = await supabase
				.from('lib_late_charges')
				.delete()
				.in('transaction_id', loanIds)

			if (chargeError) {
				console.error('Error removing late charges:', chargeError)
				return NextResponse.json({ error: 'Could not remove this copy' }, { status: 500 })
			}

			const { error: loanError } = await supabase
				.from('lib_lending_transactions')
				.delete()
				.eq('item_id', id)

			if (loanError) {
				console.error('Error removing loan history:', loanError)
				return NextResponse.json({ error: 'Could not remove this copy' }, { status: 500 })
			}
		}

		const { error: retirementError } = await supabase
			.from('lib_retirement_requests')
			.delete()
			.eq('item_id', id)

		if (retirementError) {
			console.error('Error removing retirement requests:', retirementError)
			return NextResponse.json({ error: 'Could not remove this copy' }, { status: 500 })
		}

		const { error: itemError } = await supabase
			.from('lib_items')
			.delete()
			.eq('id', id)

		if (itemError) {
			console.error('Error removing copy:', itemError)
			return NextResponse.json(
				{ error: 'Could not remove this copy — something else still refers to it' },
				{ status: 409 }
			)
		}

		// Reported back so the desk can say "2 copies left" rather than leaving
		// the librarian to count.
		const { count: remaining } = await supabase
			.from('lib_items')
			.select('*', { count: 'exact', head: true })
			.eq('catalogue_record_id', item.catalogue_record_id)

		return NextResponse.json({
			success: true,
			accession_number: item.accession_number,
			copies_remaining: remaining ?? 0,
		})
	} catch (error) {
		console.error('Unexpected error removing a copy:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
