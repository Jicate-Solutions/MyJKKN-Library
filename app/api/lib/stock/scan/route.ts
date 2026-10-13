/**
 * One scan — or a shelf full of them: POST /api/lib/stock/scan
 *
 *   { session_id, numbers: ['12407', '5994', …] }
 *
 * The hot path of the whole feature. Five or six people scan into the same
 * round at once, each expecting the next book to be scannable before they have
 * picked it up, so this route is built to be two round trips and no more:
 *
 *   1. the round and the copies, asked for together
 *   2. the scans written and the copies stamped, written together
 *
 * Nothing else happens in here. No MyJKKN call, no member lookup, no fine, no
 * status change, and deliberately no activity log line — lib_stock_scans *is*
 * the log, with who scanned what and when, and writing 26,000 activity rows
 * beside it would cost the scanner its speed for a second copy of the truth.
 *
 * WHY IT IS SAFE TO SEND THE SAME SCAN TWICE
 *
 * UNIQUE (session_id, accession_number) means the second write of a copy in a
 * round does nothing at all. Two people reaching for the same shelf, a double
 * press on the scanner, or a request the phone gave up on and sent again on a
 * weak signal: all three count once. That is what lets the browser retry a scan
 * it is not sure landed, which on the network these rooms have is the
 * difference between a count that finishes and one that has to be redone.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { MIGRATION_MESSAGE, needsMigration, numbersFrom, stockFilter } from '@/lib/library/stock-check'

interface MatchedItem {
	id: string
	accession_number: string | null
	barcode: string | null
	status: string
	catalogue: { title: string | null } | null
}

/** What one scanned number came to. */
interface ScanResult {
	/** As it was scanned, so the person can see their own number back */
	scanned: string
	accession_number: string | null
	outcome: 'checked' | 'repeat' | 'unknown'
	title: string | null
	item_status: string | null
	/** Who got there first, on a repeat */
	first_by: string | null
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

		const sessionId = String(body.session_id ?? '')
		if (!sessionId) {
			return NextResponse.json({ error: 'Start or open a stock check first' }, { status: 400 })
		}

		const numbers = numbersFrom(body.numbers ?? body.number)
		if (numbers.length === 0) {
			return NextResponse.json({ error: 'Nothing was scanned' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const quoted = numbers.map(n => `"${n.replace(/"/g, '')}"`).join(',')

		// Both questions at once: which round this is, and which copies these
		// numbers are. Neither answer depends on the other, and together they are
		// the only read this route does.
		const [round, copies] = await Promise.all([
			supabase
				.from('lib_stock_sessions')
				.select('id, institution_id, status')
				.eq('id', sessionId)
				.maybeSingle(),
			supabase
				.from('lib_items')
				.select('id, accession_number, barcode, status, catalogue:lib_catalogue_records(title)')
				.match(stockFilter(institutionId))
				.or(`accession_number.in.(${quoted}),barcode.in.(${quoted})`),
		])

		if (round.error) {
			if (needsMigration(round.error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw round.error
		}
		if (copies.error) {
			if (needsMigration(copies.error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw copies.error
		}

		// Another college's round is not found rather than refused, so an id
		// cannot be used to learn what exists elsewhere.
		if (!round.data || round.data.institution_id !== institutionId) {
			return NextResponse.json({ error: 'This stock check is not in this library' }, { status: 404 })
		}
		if (round.data.status !== 'open') {
			return NextResponse.json(
				{ error: 'This stock check is closed — open it again to carry on scanning' },
				{ status: 409 }
			)
		}

		const items = (copies.data ?? []) as unknown as MatchedItem[]

		// A scanner reads whichever code is on the sticker, so both are matched —
		// but the scan is always filed under the accession number, or the same
		// copy read two ways would count twice in one round.
		const byNumber = new Map<string, MatchedItem>()
		for (const item of items) {
			if (item.accession_number) byNumber.set(item.accession_number, item)
			if (item.barcode) byNumber.set(item.barcode, item)
		}

		const now = new Date().toISOString()
		const who = guard.caller.userId
		const whoName = guard.caller.fullName || guard.caller.email || null

		// One row per number, each key once: a request that happens to carry both
		// the accession number and the barcode of one copy writes one scan.
		const rows: Record<string, unknown>[] = []
		const keyed = new Map<string, string>()
		for (const scanned of numbers) {
			const item = byNumber.get(scanned)
			const key = item?.accession_number ?? scanned
			keyed.set(scanned, key)
			if (rows.some(r => r.accession_number === key)) continue

			rows.push({
				session_id: sessionId,
				institution_id: institutionId,
				item_id: item?.id ?? null,
				accession_number: key,
				outcome: item ? 'checked' : 'unknown',
				item_status: item?.status ?? null,
				title: item?.catalogue?.title ?? null,
				scanned_by: who,
				scanned_by_name: whoName,
				scanned_at: now,
			})
		}

		const itemIds = [...new Set(items.map(i => i.id))]

		// Written together, because neither waits on the other. The stamp on the
		// copy is what the progress counts read; the scan row is who saw it.
		const [written, stamped] = await Promise.all([
			supabase
				.from('lib_stock_scans')
				.upsert(rows, { onConflict: 'session_id,accession_number', ignoreDuplicates: true })
				.select('accession_number'),
			itemIds.length > 0
				? supabase
					.from('lib_items')
					// Only these two columns, ever. `status` and `updated_at` are left
					// alone on purpose: a stock check is not a circulation event, and
					// nothing else in the library should move because of one.
					.update({ stock_session_id: sessionId, stock_checked_at: now })
					.eq('institution_id', institutionId)
					.in('id', itemIds)
				: Promise.resolve({ error: null }),
		])

		if (written.error) {
			if (needsMigration(written.error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw written.error
		}
		if (stamped.error) {
			if (needsMigration(stamped.error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw stamped.error
		}

		// What the database let through. Anything else was already in this round.
		const fresh = new Set((written.data ?? []).map(r => r.accession_number as string))
		const repeats = [...new Set([...keyed.values()])].filter(key => !fresh.has(key))

		// Who got there first, asked for only when somebody did
		const firstBy = new Map<string, string | null>()
		if (repeats.length > 0) {
			const { data } = await supabase
				.from('lib_stock_scans')
				.select('accession_number, scanned_by_name')
				.eq('session_id', sessionId)
				.in('accession_number', repeats)
			for (const row of data ?? []) {
				firstBy.set(row.accession_number as string, (row.scanned_by_name as string | null) ?? null)
			}
		}

		const results: ScanResult[] = numbers.map(scanned => {
			const item = byNumber.get(scanned)
			const key = keyed.get(scanned) ?? scanned
			const repeat = !fresh.has(key)

			return {
				scanned,
				accession_number: item?.accession_number ?? null,
				outcome: item ? (repeat ? 'repeat' : 'checked') : 'unknown',
				title: item?.catalogue?.title ?? null,
				item_status: item?.status ?? null,
				first_by: repeat ? firstBy.get(key) ?? null : null,
			}
		})

		return NextResponse.json({
			results,
			// What this request actually added to the count
			checked: results.filter(r => r.outcome === 'checked').length,
		})
	} catch (error) {
		console.error('A stock check scan failed:', error)
		return NextResponse.json({ error: 'Could not save the scan' }, { status: 500 })
	}
}
