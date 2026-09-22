/**
 * Missing books: /api/lib/missing
 *
 *   GET  ?list=missing              every copy this college has marked missing
 *   GET  ?q=12407, 5994 …           the copies with these accession numbers (or
 *                                   barcodes), exact, any separator
 *   POST { action: 'missing', item_ids, reason }   mark them missing
 *   POST { action: 'found',   item_ids }           put them back on the shelf
 *
 * A missing copy keeps its row — the catalogue still lists it, as Missing —
 * with why, when and by whom. The OPAC and the desk only ever count a copy
 * that is 'available', so to them it is simply not available.
 *
 * A copy out on loan can be marked missing too: the member says they lost it.
 * Its loan is closed as 'lost_by_member', so it leaves their list at the desk.
 * No fine is written here — that is decided later, not by this page.
 *
 * Not under /api/lib/items on purpose: that prefix is librarian-only, and an
 * assistant librarian may mark books missing as well.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'

const ITEM_COLUMNS =
	'id, accession_number, barcode, status, missing_reason, missing_marked_at, missing_marked_by, catalogue_record_id, catalogue:lib_catalogue_records(id, title, author)'

/** What a copy in any of these states can be marked missing from. */
const MARKABLE = ['available', 'on_loan', 'on_hold']

const MAX_NUMBERS = 500
const CHUNK = 200

const MIGRATION_MESSAGE =
	'The database has not been updated for Missing Books yet — please run migration 20260922_lib_items_missing.sql'

function chunk<T>(items: T[], size = CHUNK): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

/** Accession numbers as typed or pasted — commas, spaces or one per line. */
function numbersFrom(text: string): string[] {
	return [...new Set(text.split(/[\s,;]+/).map(n => n.trim()).filter(Boolean))].slice(0, MAX_NUMBERS)
}

type Supabase = ReturnType<typeof getSupabaseServer>

interface ItemRow {
	id: string
	accession_number: string | null
	barcode: string | null
	status: string
	catalogue: { id: string; title: string | null } | null
}

/** Who has each of these copies out now, if anyone. */
async function openLoans(supabase: Supabase, institutionId: string, itemIds: string[]) {
	const byItem = new Map<string, { id: string; member_name: string | null; member_number: string | null; due_date: string }>()
	for (const ids of chunk(itemIds)) {
		const { data } = await supabase
			.from('lib_lending_transactions')
			.select('id, item_id, due_date, member:lib_borrowers(display_name, member_number)')
			.eq('institution_id', institutionId)
			.in('item_id', ids)
			.in('transaction_status', ['active', 'overdue'])
		for (const row of (data ?? []) as unknown as {
			id: string; item_id: string; due_date: string
			member: { display_name: string | null; member_number: string | null } | null
		}[]) {
			byItem.set(row.item_id, {
				id: row.id,
				member_name: row.member?.display_name ?? null,
				member_number: row.member?.member_number ?? null,
				due_date: row.due_date,
			})
		}
	}
	return byItem
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'Select an institution first' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const items: ItemRow[] = []
		let notFound: string[] = []

		if (searchParams.get('list') === 'missing') {
			const { data, error } = await supabase
				.from('lib_items')
				.select(ITEM_COLUMNS)
				.eq('institution_id', institutionId)
				.eq('status', 'missing')
				.order('missing_marked_at', { ascending: false, nullsFirst: false })
				.range(0, 9999)
			if (error) {
				if (error.code === '42703') return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
			items.push(...((data ?? []) as unknown as ItemRow[]))
		} else {
			const numbers = numbersFrom(searchParams.get('q') ?? '')
			if (numbers.length === 0) {
				return NextResponse.json({ error: 'Type one or more accession numbers' }, { status: 400 })
			}
			for (const part of chunk(numbers)) {
				const list = part.map(n => `"${n.replace(/"/g, '')}"`).join(',')
				const { data, error } = await supabase
					.from('lib_items')
					.select(ITEM_COLUMNS)
					.eq('institution_id', institutionId)
					.or(`accession_number.in.(${list}),barcode.in.(${list})`)
				if (error) {
					if (error.code === '42703') return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
					throw error
				}
				items.push(...((data ?? []) as unknown as ItemRow[]))
			}

			// In the order they were typed, each copy once
			const seen = new Set<string>()
			const ordered: ItemRow[] = []
			for (const n of numbers) {
				for (const item of items) {
					if ((item.accession_number === n || item.barcode === n) && !seen.has(item.id)) {
						seen.add(item.id)
						ordered.push(item)
					}
				}
			}
			items.splice(0, items.length, ...ordered)
			notFound = numbers.filter(n => !items.some(i => i.accession_number === n || i.barcode === n))
		}

		const loans = await openLoans(supabase, institutionId, items.filter(i => i.status === 'on_loan').map(i => i.id))

		return NextResponse.json({
			data: items.map(item => ({ ...item, loan: loans.get(item.id) ?? null })),
			not_found: notFound,
		})
	} catch (error) {
		console.error('Missing books lookup failed:', error)
		return NextResponse.json({ error: 'Could not load the books' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'Select an institution first' }, { status: 400 })
		}

		const action = body.action === 'missing' || body.action === 'found' ? body.action : null
		const itemIds: string[] = Array.isArray(body.item_ids)
			? [...new Set((body.item_ids as unknown[]).map(String).filter(Boolean))]
			: []
		const reason = String(body.reason ?? '').trim()

		if (!action) return NextResponse.json({ error: "action must be 'missing' or 'found'" }, { status: 400 })
		if (itemIds.length === 0) return NextResponse.json({ error: 'Pick at least one book' }, { status: 400 })
		if (itemIds.length > MAX_NUMBERS) {
			return NextResponse.json({ error: `Up to ${MAX_NUMBERS} books at a time` }, { status: 400 })
		}
		if (action === 'missing' && !reason) {
			return NextResponse.json({ error: 'Write why these books are missing' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const now = new Date().toISOString()

		// Only this college's copies — an id from another college is simply not found
		const found: ItemRow[] = []
		for (const ids of chunk(itemIds)) {
			const { data, error } = await supabase
				.from('lib_items')
				.select(ITEM_COLUMNS)
				.eq('institution_id', institutionId)
				.in('id', ids)
			if (error) {
				if (error.code === '42703') return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
			found.push(...((data ?? []) as unknown as ItemRow[]))
		}

		const skipped: { accession_number: string | null; reason: string }[] = []
		const accession = (id: string) => found.find(i => i.id === id)?.accession_number ?? null
		for (const id of itemIds) {
			if (!found.some(i => i.id === id)) skipped.push({ accession_number: null, reason: 'Not a copy in this library' })
		}

		if (action === 'found') {
			const back = found.filter(i => i.status === 'missing')
			for (const item of found.filter(i => i.status !== 'missing')) {
				skipped.push({ accession_number: item.accession_number, reason: 'Not marked missing' })
			}

			const done: string[] = []
			for (const ids of chunk(back.map(i => i.id))) {
				const { data, error } = await supabase
					.from('lib_items')
					.update({ status: 'available', missing_reason: null, missing_marked_at: null, missing_marked_by: null, updated_at: now })
					.eq('institution_id', institutionId)
					.eq('status', 'missing')
					.in('id', ids)
					.select('id')
				if (error) throw error
				done.push(...(data ?? []).map(r => r.id as string))
			}

			await logActivity(request, {
				action: 'update',
				resource_type: 'item',
				resource_id: '/registry/missing',
				institution_id: institutionId,
				metadata: { found: true, accession_numbers: done.map(accession) },
			})

			return NextResponse.json({ updated: done.length, skipped })
		}

		// Marking missing
		const markable = found.filter(i => MARKABLE.includes(i.status))
		for (const item of found.filter(i => !MARKABLE.includes(i.status))) {
			skipped.push({
				accession_number: item.accession_number,
				reason: item.status === 'missing' ? 'Already marked missing' : `This copy is ${item.status.replace(/_/g, ' ')}`,
			})
		}

		const who = guard.caller.fullName || guard.caller.email || null
		const done: string[] = []
		for (const ids of chunk(markable.map(i => i.id))) {
			const { data, error } = await supabase
				.from('lib_items')
				.update({ status: 'missing', missing_reason: reason, missing_marked_at: now, missing_marked_by: who, updated_at: now })
				.eq('institution_id', institutionId)
				.in('status', MARKABLE)
				.in('id', ids)
				.select('id')
			if (error) {
				if (error.code === '42703') return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
				throw error
			}
			done.push(...(data ?? []).map(r => r.id as string))
		}

		// A copy that was out: its loan closes, so it leaves the member's list
		const closedLoans: string[] = []
		for (const ids of chunk(done)) {
			const { data, error } = await supabase
				.from('lib_lending_transactions')
				.update({ transaction_status: 'lost_by_member', updated_at: now })
				.eq('institution_id', institutionId)
				.in('item_id', ids)
				.in('transaction_status', ['active', 'overdue'])
				.select('id')
			if (error) console.error('Closing loans of missing books failed:', error.message)
			closedLoans.push(...(data ?? []).map(r => r.id as string))
		}

		// A copy put aside for somebody's hold: the hold waits for the next copy
		for (const ids of chunk(done)) {
			const { error } = await supabase
				.from('lib_resource_holds')
				.update({ hold_status: 'pending', item_id: null, notified_at: null, updated_at: now })
				.eq('institution_id', institutionId)
				.in('item_id', ids)
				.eq('hold_status', 'available')
			if (error) console.error('Releasing holds on missing books failed:', error.message)
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'item',
			resource_id: '/registry/missing',
			institution_id: institutionId,
			metadata: { missing: true, reason, accession_numbers: done.map(accession), closed_loans: closedLoans },
		})

		return NextResponse.json({ updated: done.length, closed_loans: closedLoans.length, skipped })
	} catch (error) {
		console.error('Missing books update failed:', error)
		return NextResponse.json({ error: 'Could not update the books' }, { status: 500 })
	}
}
