/**
 * The trail behind "view as user".
 *
 * A super admin acting as someone else can do everything that person can do,
 * so the one thing that must never be lost is who was really at the keyboard.
 * Two kinds of entry are written: when a session starts and stops, and every
 * change made while it is running.
 *
 * Writing the trail must never break the action itself — if the table is
 * missing the entry goes to the server log instead, so nothing silently
 * disappears and the desk keeps working.
 */

import { getSupabaseServer } from '@/lib/supabase-server'

interface SessionEvent {
	event: 'start' | 'stop'
	realUserId: string
	realEmail: string
	targetUserId: string
	targetEmail: string
}

interface ActionEvent {
	realUserId: string
	realEmail: string
	targetUserId: string
	targetEmail: string
	method: string
	path: string
	institutionId: string | null
}

async function write(row: Record<string, unknown>, fallbackLabel: string) {
	try {
		const supabase = getSupabaseServer()
		const { error } = await supabase.from('lib_impersonation_log').insert(row)
		if (error) throw error
	} catch {
		// Table not created yet, or the insert failed — never lose the record
		console.warn(`[impersonation] ${fallbackLabel}`, JSON.stringify(row))
	}
}

/** Records a super admin starting or stopping a "view as" session. */
export async function recordImpersonationEvent(event: SessionEvent): Promise<void> {
	await write(
		{
			event_type: event.event,
			real_user_id: event.realUserId,
			real_email: event.realEmail,
			target_user_id: event.targetUserId,
			target_email: event.targetEmail,
			occurred_at: new Date().toISOString(),
		},
		`session ${event.event}`
	)
}

/** Records one change made while viewing as someone else. */
export async function recordImpersonatedAction(action: ActionEvent): Promise<void> {
	await write(
		{
			event_type: 'action',
			real_user_id: action.realUserId,
			real_email: action.realEmail,
			target_user_id: action.targetUserId,
			target_email: action.targetEmail,
			http_method: action.method,
			request_path: action.path,
			institution_id: action.institutionId,
			occurred_at: new Date().toISOString(),
		},
		'action'
	)
}
