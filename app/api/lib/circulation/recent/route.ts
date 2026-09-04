/**
 * What this desk has done lately: GET /api/lib/circulation/recent?institution_id=…&since=…&limit=…
 *
 * Every issue, return and renewal since `since` (the start of the librarian's
 * day, as the page works it out; the last 24 hours if not given), newest
 * first, in the shape the desk page keeps for what it does in the sitting —
 * so the strip at the foot of the desk shows the morning's work after a
 * reload exactly as it showed it while it was being done.
 *
 * One read. A loan row carries all three moments (issued, returned, last
 * renewed), so a row is read once and turned into as many lines as fall in
 * the window.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import type { DeskEvent } from '@/lib/library/desk'
import { eventKey } from '@/lib/library/desk'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** Rows read to find the events — a loan touched today is at most three lines. */
const ROWS_READ = 150

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		// The desk serves one college at a time; asked for all of them, it has
		// nothing to say rather than something misleading.
		if (!guard.institutionId) return NextResponse.json({ events: [], since: null })

		const sinceParam = searchParams.get('since')
		const sinceDate = sinceParam && !Number.isNaN(new Date(sinceParam).getTime())
			? new Date(sinceParam)
			: new Date(Date.now() - 24 * 60 * 60 * 1000)
		// Whole seconds: the value rides inside an `or=(…)` filter, where a
		// fractional part is one more dot for the filter grammar to read.
		const since = sinceDate.toISOString().replace(/\.\d{3}Z$/, 'Z')

		const asked = Number(searchParams.get('limit'))
		const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_lending_transactions')
			.select(`
				id, issued_at, due_date, returned_at, renewal_count, last_renewed_at, transaction_status,
				member:lib_borrowers(display_name, member_number),
				item:lib_items(accession_number, catalogue:lib_catalogue_records(title))
			`)
			.eq('institution_id', guard.institutionId)
			.or(`issued_at.gte.${since},returned_at.gte.${since},last_renewed_at.gte.${since}`)
			.order('updated_at', { ascending: false })
			.limit(ROWS_READ)

		if (error) {
			console.error('Error reading recent desk activity:', error)
			return NextResponse.json({ error: 'Could not read what the desk did today' }, { status: 500 })
		}

		const events: DeskEvent[] = []
		for (const row of (data ?? []) as any[]) {
			const member = row.member as { display_name?: string; member_number?: string } | null
			const item = row.item as { accession_number?: string; catalogue?: { title?: string } | null } | null
			const base = {
				transaction_id: row.id as string,
				title: item?.catalogue?.title ?? 'Unknown title',
				accession_number: item?.accession_number ?? null,
				member_name: member?.display_name ?? 'Unknown member',
				member_number: member?.member_number ?? null,
			}

			if (row.issued_at && row.issued_at >= since) {
				events.push({ ...base, key: eventKey('issue', row.id, row.issued_at), kind: 'issue', at: row.issued_at, due_date: row.due_date ?? null })
			}
			if (row.returned_at && row.returned_at >= since) {
				events.push({ ...base, key: eventKey('return', row.id, row.returned_at), kind: 'return', at: row.returned_at, due_date: row.due_date ?? null })
			}
			if (row.last_renewed_at && row.last_renewed_at >= since) {
				events.push({ ...base, key: eventKey('renew', row.id, row.last_renewed_at), kind: 'renew', at: row.last_renewed_at, due_date: row.due_date ?? null })
			}
		}

		events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

		return NextResponse.json({ events: events.slice(0, limit), since })
	} catch (error) {
		console.error('Unexpected error reading recent desk activity:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
