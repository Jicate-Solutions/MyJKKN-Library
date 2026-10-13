/**
 * Stock check rounds: /api/lib/stock/sessions
 *
 *   GET                                this college's rounds, newest first
 *   POST  { name }                     start a round
 *   PATCH { id, status }               close a round, or open it again
 *
 * A round is what makes "checked" mean something. Every scan belongs to one,
 * and starting a new one puts the whole library back to unchecked without
 * writing to a single copy — the copies carry the id of the round that last saw
 * them, so last year's ticks simply stop matching.
 *
 * Starting and closing is library staff's; a temporary stock check helper can
 * only scan into a round somebody else started, which the API guard enforces
 * for every route under /api/lib/stock at once.
 *
 * Not under /api/lib/items on purpose: that prefix is librarian-only, and an
 * assistant librarian runs stock checks too.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { MIGRATION_MESSAGE, SESSION_COLUMNS, needsMigration } from '@/lib/library/stock-check'

/** Enough rounds to see the history; a college runs one or two a year. */
const MAX_SESSIONS = 20

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
		const { data, error } = await supabase
			.from('lib_stock_sessions')
			.select(SESSION_COLUMNS)
			.eq('institution_id', institutionId)
			.order('started_at', { ascending: false })
			.limit(MAX_SESSIONS)

		if (error) {
			if (needsMigration(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw error
		}

		const sessions = data ?? []

		// How much each round has seen. One count each, asked for together: a
		// college has a couple of rounds a year, and the numbers are what makes
		// the list worth reading.
		const counts = await Promise.all(
			sessions.map(async session => {
				const { count } = await supabase
					.from('lib_stock_scans')
					.select('id', { count: 'exact', head: true })
					.eq('session_id', session.id)
				return count ?? 0
			})
		)

		return NextResponse.json({
			data: sessions.map((session, i) => ({ ...session, scans: counts[i] })),
		})
	} catch (error) {
		console.error('Stock check rounds could not be read:', error)
		return NextResponse.json({ error: 'Could not load the stock checks' }, { status: 500 })
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

		const name = String(body.name ?? '').trim().slice(0, 120)
		if (!name) return NextResponse.json({ error: 'Give this stock check a name' }, { status: 400 })

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_stock_sessions')
			.insert({
				institution_id: institutionId,
				name,
				status: 'open',
				started_by: guard.caller.userId,
				started_by_name: guard.caller.fullName || guard.caller.email || null,
			})
			.select(SESSION_COLUMNS)
			.single()

		if (error) {
			if (needsMigration(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw error
		}

		await logActivity(request, {
			action: 'create',
			resource_type: 'stock_check',
			resource_id: data.id,
			institution_id: institutionId,
			metadata: { name },
		})

		return NextResponse.json({ data: { ...data, scans: 0 } }, { status: 201 })
	} catch (error) {
		console.error('Starting a stock check failed:', error)
		return NextResponse.json({ error: 'Could not start the stock check' }, { status: 500 })
	}
}

export async function PATCH(request: Request) {
	try {
		const body = await request.json()
		const id = String(body.id ?? '')
		if (!id) return NextResponse.json({ error: 'Which stock check?' }, { status: 400 })

		const status = body.status === 'closed' || body.status === 'open' ? body.status : null
		if (!status) return NextResponse.json({ error: "status must be 'open' or 'closed'" }, { status: 400 })

		// Another college's round is simply not found
		const guard = await guardRecord(request, 'lib_stock_sessions', id)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()
		const now = new Date().toISOString()
		const who = guard.caller.fullName || guard.caller.email || null

		// A closed round keeps everything it saw; closing only stops new scans, so
		// reopening it is safe and the counts are exactly where they were.
		const { data, error } = await supabase
			.from('lib_stock_sessions')
			.update(
				status === 'closed'
					? { status, closed_at: now, closed_by_name: who, updated_at: now }
					: { status, closed_at: null, closed_by_name: null, updated_at: now }
			)
			.eq('id', id)
			.select(SESSION_COLUMNS)
			.single()

		if (error) {
			if (needsMigration(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 400 })
			}
			throw error
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'stock_check',
			resource_id: id,
			institution_id: data.institution_id,
			metadata: { status },
		})

		return NextResponse.json({ data })
	} catch (error) {
		console.error('Updating a stock check failed:', error)
		return NextResponse.json({ error: 'Could not update the stock check' }, { status: 500 })
	}
}
