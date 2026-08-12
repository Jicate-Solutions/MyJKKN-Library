/**
 * Removing a book and every copy of it: DELETE /api/lib/catalogue/[id]/remove
 *
 * The plain DELETE on a catalogue record refuses as soon as a copy exists,
 * because lib_items references it with ON DELETE RESTRICT. That is right for a
 * catalogue of titles — you should not lose five physical books by deleting one
 * line. In the Pharmacy register, though, a row *is* a book, and deleting means
 * deleting: the copies, their accession numbers and their closed loan history
 * go with it.
 *
 * Two things are never quietly destroyed:
 *   - a copy that is out with a member — the loan record is the only proof of
 *     who has it, and the book is not on the shelf to be removed anyway
 *   - an unpaid late charge — that is money owed, and deleting the loan behind
 *     it would erase the debt without anyone deciding to
 *
 * Both refuse with the accession number named, so the librarian knows exactly
 * which book to deal with first.
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
		const guard = await guardRecord(request, 'lib_catalogue_records', id)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()

		const { data: record } = await supabase
			.from('lib_catalogue_records')
			.select('id, title')
			.eq('id', id)
			.maybeSingle()

		if (!record) {
			return NextResponse.json({ error: 'That book is no longer in the register' }, { status: 404 })
		}

		// A subscription points at the title with RESTRICT, and unlike copies it
		// is not ours to clean up from here.
		const { count: subscriptions } = await supabase
			.from('lib_periodical_subscriptions')
			.select('*', { count: 'exact', head: true })
			.eq('catalogue_record_id', id)

		if ((subscriptions ?? 0) > 0) {
			return NextResponse.json(
				{ error: 'This title has a periodical subscription against it — close the subscription first' },
				{ status: 409 }
			)
		}

		const { data: items } = await supabase
			.from('lib_items')
			.select('id, accession_number')
			.eq('catalogue_record_id', id)

		const itemIds = (items || []).map(i => i.id)
		const accessionOf = new Map((items || []).map(i => [i.id, i.accession_number]))

		if (itemIds.length > 0) {
			const { data: loans } = await supabase
				.from('lib_lending_transactions')
				.select('id, item_id, transaction_status')
				.in('item_id', itemIds)

			const openLoans = (loans || []).filter(l =>
				l.transaction_status === 'active' || l.transaction_status === 'overdue'
			)

			if (openLoans.length > 0) {
				const numbers = openLoans.map(l => accessionOf.get(l.item_id) ?? '?').join(', ')
				return NextResponse.json(
					{
						error: openLoans.length === 1
							? `Accession ${numbers} is out with a member — take it back before removing this book`
							: `Accessions ${numbers} are out with members — take them back before removing this book`,
					},
					{ status: 409 }
				)
			}

			const loanIds = (loans || []).map(l => l.id)

			if (loanIds.length > 0) {
				const { data: unpaid } = await supabase
					.from('lib_late_charges')
					.select('id, transaction_id')
					.in('transaction_id', loanIds)
					.in('payment_status', ['unpaid', 'partial'])

				if (unpaid && unpaid.length > 0) {
					return NextResponse.json(
						{ error: `There ${unpaid.length === 1 ? 'is an unpaid late charge' : `are ${unpaid.length} unpaid late charges`} against this book — settle or waive ${unpaid.length === 1 ? 'it' : 'them'} first` },
						{ status: 409 }
					)
				}

				// Settled charges and closed loans go with the book they describe.
				// Deleted in reference order, innermost first, or each delete would
				// be refused by the one pointing at it.
				const { error: chargeError } = await supabase
					.from('lib_late_charges')
					.delete()
					.in('transaction_id', loanIds)

				if (chargeError) {
					console.error('Error removing late charges:', chargeError)
					return NextResponse.json({ error: 'Could not remove this book' }, { status: 500 })
				}

				const { error: loanError } = await supabase
					.from('lib_lending_transactions')
					.delete()
					.in('item_id', itemIds)

				if (loanError) {
					console.error('Error removing loan history:', loanError)
					return NextResponse.json({ error: 'Could not remove this book' }, { status: 500 })
				}
			}

			const { error: retirementError } = await supabase
				.from('lib_retirement_requests')
				.delete()
				.in('item_id', itemIds)

			if (retirementError) {
				console.error('Error removing retirement requests:', retirementError)
				return NextResponse.json({ error: 'Could not remove this book' }, { status: 500 })
			}

			const { error: itemError } = await supabase
				.from('lib_items')
				.delete()
				.eq('catalogue_record_id', id)

			if (itemError) {
				console.error('Error removing copies:', itemError)
				return NextResponse.json(
					{ error: 'Could not remove the copies — something else still refers to them' },
					{ status: 409 }
				)
			}
		}

		// Authors and holds fall away with it: both reference the record with
		// ON DELETE CASCADE.
		const { error: recordError } = await supabase
			.from('lib_catalogue_records')
			.delete()
			.eq('id', id)

		if (recordError) {
			console.error('Error removing catalogue record:', recordError)
			return NextResponse.json({ error: 'Could not remove this book' }, { status: 500 })
		}

		return NextResponse.json({
			success: true,
			title: record.title,
			copies_removed: itemIds.length,
		})
	} catch (error) {
		console.error('Unexpected error removing a book:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
