/**
 * Screen activity, arriving a handful at a time: POST /api/lib/logs/batch
 *
 * Page views and menu clicks are far too frequent to send one request each —
 * a librarian moving through the catalogue would open a connection every few
 * seconds. The browser queues them instead and posts up to fifty together.
 *
 * One session lookup and one insert serve the whole batch, so the cost of
 * recording fifty movements is the cost of recording one.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import {
	readIpAddress,
	resolveActor,
	type ActivityAction,
} from '@/lib/library/activity-log'

/** Enough for a long browse, small enough that one bad client cannot flood the table. */
const MAX_ENTRIES = 50

interface IncomingEntry {
	action?: string
	resource_type?: string | null
	resource_id?: string | null
	institution_id?: string | null
	metadata?: Record<string, unknown>
	status?: 'success' | 'error' | 'pending'
	error_message?: string | null
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const entries: IncomingEntry[] = Array.isArray(body.entries) ? body.entries : []

		if (entries.length === 0) {
			return NextResponse.json({ error: 'No entries were sent' }, { status: 400 })
		}
		if (entries.length > MAX_ENTRIES) {
			return NextResponse.json({ error: `Maximum ${MAX_ENTRIES} entries per batch` }, { status: 400 })
		}

		// Resolved once for the batch — every entry in it comes from one browser,
		// and the identity is taken from the token rather than from what was sent
		const { userId, sessionId } = await resolveActor(request)
		const ipAddress = readIpAddress(request)
		const userAgent = request.headers.get('user-agent')

		const rows = entries
			.filter(entry => (entry.action ?? '').toString().trim())
			.map(entry => ({
				institution_id: entry.institution_id ?? null,
				user_id: userId,
				session_id: sessionId,
				action: (entry.action as ActivityAction) ?? 'page_view',
				resource_type: entry.resource_type ?? null,
				resource_id: entry.resource_id ?? null,
				ip_address: ipAddress,
				user_agent: userAgent,
				status: entry.status ?? 'success',
				error_message: entry.error_message ?? null,
				metadata: entry.metadata ?? {},
			}))

		if (rows.length === 0) {
			return NextResponse.json({ error: 'Every entry was missing an action' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const { error } = await supabase.from('lib_activity_log').insert(rows)

		if (error) {
			console.warn('[activity] batch not written:', error.message)
			// The browser is told nothing is wrong: telemetry must not surface as
			// a broken page
			return NextResponse.json({ success: false, count: 0 })
		}

		return NextResponse.json({ success: true, count: rows.length })
	} catch (error) {
		console.error('Unexpected error writing an activity batch:', error)
		return NextResponse.json({ success: false, count: 0 })
	}
}
