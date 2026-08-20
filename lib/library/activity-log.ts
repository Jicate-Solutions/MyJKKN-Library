/**
 * Writing the activity log from an API route.
 *
 * One call at the end of a change records who made it, in which library, to
 * what, and what the record looked like before and after. The rules it keeps:
 *
 *   * It never throws. A save must not fail because the log did — every path
 *     here ends in a swallowed catch, and a lost line is written to the server
 *     console instead so nothing disappears in silence.
 *   * The person is resolved here, from the session token on the request. A
 *     caller cannot say who they are; the sessions table says it.
 *   * Snapshots are scrubbed. A row of `users` carries tokens and a row of
 *     settings carries keys — anything that looks like a secret is dropped
 *     before it can reach the log, and from there an Excel export.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, IMPERSONATION_COOKIE } from '@/lib/auth/server-access'

/** The verbs the console filters by. Keep this closed — free text fragments the filter. */
export type ActivityAction =
	| 'create' | 'update' | 'delete' | 'read'
	| 'navigation' | 'page_view' | 'click' | 'search'
	| 'file_import' | 'file_export' | 'file_upload' | 'file_download'
	| 'auth_login' | 'auth_logout' | 'auth_session_refresh' | 'auth_session_expired'
	| 'impersonation_start' | 'impersonation_stop'

export interface ActivityEntry {
	action: ActivityAction
	/** Singular, snake_case: 'member', 'catalogue_record', 'item', 'loan', 'setting'. */
	resource_type?: string | null
	/** The page path a librarian would recognise — '/members', '/registry'. */
	resource_id?: string | null
	/** Which library this belongs to. Take it from the guard, never from the body. */
	institution_id?: string | null
	old_values?: Record<string, unknown> | null
	new_values?: Record<string, unknown> | null
	status?: 'success' | 'error' | 'pending'
	error_message?: string | null
	metadata?: Record<string, unknown>
}

/**
 * Fields that must never be copied into a snapshot.
 *
 * Matched on the field name rather than the value, so a column added later
 * called `api_key` or `refresh_token` is caught without anyone remembering to
 * come back here.
 */
const SECRET_FIELD = /(password|token|secret|api[-_]?key|credential|otp|session)/i

/** How much of one snapshot is worth keeping. Beyond this the row is noise. */
const MAX_SNAPSHOT_FIELDS = 60

function scrub(values: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
	if (!values || typeof values !== 'object') return null

	const safe: Record<string, unknown> = {}
	let kept = 0

	for (const [key, value] of Object.entries(values)) {
		if (kept >= MAX_SNAPSHOT_FIELDS) break
		if (SECRET_FIELD.test(key)) {
			safe[key] = '[hidden]'
			kept++
			continue
		}
		safe[key] = value
		kept++
	}

	return Object.keys(safe).length > 0 ? safe : null
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get('cookie')
	if (!header) return null
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (key === name) return decodeURIComponent(rest.join('='))
	}
	return null
}

/** The same token the guards read: an Authorization header, or the cookie. */
export function readAccessToken(request: Request): string | null {
	const header = request.headers.get('authorization')
	if (header?.startsWith('Bearer ')) return header.slice(7)
	return readCookie(request, 'access_token')
}

/**
 * Whose session this is, according to the `sessions` table.
 *
 * Every clause earns its place: sessions do duplicate, so this takes the newest
 * rather than failing on more than one; an expired row would credit today's
 * work to a stale visit; a signed-out session must stop collecting activity.
 *
 * This is the cheap path and it fills `session_id`, but it cannot be the only
 * one: `sessions.session_token` is written at sign-in, while /api/token/refresh
 * hands the browser a NEW access token without rewriting that row. From the
 * first renewal onwards the tokens no longer match and every line would be
 * filed under nobody — which is exactly what the console was showing.
 */
export async function resolveSession(
	token: string | null
): Promise<{ userId: string | null; sessionId: string | null }> {
	if (!token) return { userId: null, sessionId: null }

	try {
		const supabase = getSupabaseServer()
		const { data } = await supabase
			.from('sessions')
			.select('id, user_id')
			.eq('session_token', token)
			.eq('is_active', true)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(1)

		const session = data?.[0]
		return { userId: session?.user_id ?? null, sessionId: session?.id ?? null }
	} catch {
		return { userId: null, sessionId: null }
	}
}

/**
 * Remembered identities, so a name costs one lookup rather than one per line.
 *
 * A page view writes a line, and asking MyJKKN who the token belongs to on
 * every one of them would put a network call in front of ordinary browsing.
 * Five minutes is short enough that a signed-out token stops being written
 * almost immediately, and long enough that a busy desk resolves once.
 *
 * Keyed by token AND by who is being viewed as, because the same token means a
 * different person the moment a super admin views as somebody else.
 */
const actorCache = new Map<string, { userId: string | null; sessionId: string | null; at: number }>()
const ACTOR_TTL_MS = 5 * 60 * 1000
/** A ceiling, so a long-running server cannot grow this map forever. */
const ACTOR_CACHE_MAX = 500

function cacheKey(token: string, viewAs: string | null): string {
	return `${token}|${viewAs ?? ''}`
}

/**
 * Who did this, and in which session.
 *
 * The `sessions` row is tried first — it is a local query and it is the only
 * thing that knows the session id. When it misses, the caller is resolved the
 * same way every guarded route resolves them, from the token itself, so the
 * name in the log matches the name the rest of the system would use.
 */
export async function resolveActor(request: Request): Promise<{ userId: string | null; sessionId: string | null }> {
	const token = readAccessToken(request)
	if (!token) return { userId: null, sessionId: null }

	const key = cacheKey(token, readCookie(request, IMPERSONATION_COOKIE))
	const cached = actorCache.get(key)
	if (cached && Date.now() - cached.at < ACTOR_TTL_MS) {
		return { userId: cached.userId, sessionId: cached.sessionId }
	}

	const bySession = await resolveSession(token)
	let { userId } = bySession
	const { sessionId } = bySession

	if (!userId) {
		try {
			const { caller } = await getCaller(request)
			userId = caller?.userId ?? null
		} catch {
			// Leave it unnamed rather than lose the line
		}
	}

	if (actorCache.size >= ACTOR_CACHE_MAX) actorCache.clear()
	actorCache.set(key, { userId, sessionId, at: Date.now() })

	return { userId, sessionId }
}

/**
 * The caller's address, as the nearest proxy reports it.
 *
 * Read in the order the request actually passes through — Cloudflare first,
 * then the load balancer's list, whose first entry is the client.
 */
export function readIpAddress(request: Request): string | null {
	const headers = request.headers
	const forwarded = headers.get('x-forwarded-for')
	return (
		headers.get('cf-connecting-ip') ||
		headers.get('true-client-ip') ||
		(forwarded ? forwarded.split(',')[0].trim() : null) ||
		headers.get('x-real-ip') ||
		null
	)
}

/**
 * Writes one line of the activity log.
 *
 * Never awaited for correctness — the caller may await it to keep ordering
 * tidy, but nothing it returns matters and nothing it does can fail the work.
 */
export async function logActivity(request: Request, entry: ActivityEntry): Promise<void> {
	try {
		const { userId, sessionId } = await resolveActor(request)

		const supabase = getSupabaseServer()
		const { error } = await supabase.from('lib_activity_log').insert({
			institution_id: entry.institution_id ?? null,
			user_id: userId,
			session_id: sessionId,
			action: entry.action,
			resource_type: entry.resource_type ?? null,
			resource_id: entry.resource_id ?? null,
			old_values: scrub(entry.old_values),
			new_values: scrub(entry.new_values),
			ip_address: readIpAddress(request),
			user_agent: request.headers.get('user-agent'),
			status: entry.status ?? 'success',
			error_message: entry.error_message ?? null,
			metadata: entry.metadata ?? {},
		})

		if (error) throw error
	} catch (error) {
		// The work itself already succeeded; the record of it goes to the server
		// log so it is not lost while the table is missing or unreachable
		console.warn('[activity] not written:', entry.action, entry.resource_type, (error as Error)?.message)
	}
}

/**
 * The record as it stands, read before it is changed.
 *
 * An update that does not do this loses the "before" half of the story — there
 * is no way to recover it once the row is overwritten.
 */
export async function fetchOldValues(
	table: string,
	id: string,
	idColumn = 'id'
): Promise<Record<string, unknown> | null> {
	try {
		const supabase = getSupabaseServer()
		const { data } = await supabase.from(table).select('*').eq(idColumn, id).maybeSingle()
		return (data as Record<string, unknown>) ?? null
	} catch {
		return null
	}
}
