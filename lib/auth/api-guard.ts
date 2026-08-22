/**
 * One-line institution guard for `/api/lib/*` routes.
 *
 * Before this existed, routes filtered by institution only when the URL asked
 * them to — so editing `?institution_id=` in the address bar exposed another
 * campus's data. These helpers resolve the caller from their session and force
 * the scope server-side, so the URL can no longer be trusted.
 *
 * Usage in a collection route:
 *
 *   const guard = await guardCollection(request, searchParams.get('institution_id'))
 *   if (!guard.ok) return guard.response
 *   const institutionId = guard.institutionId
 *
 * Usage on a single record:
 *
 *   const guard = await guardRecord(request, 'lib_borrowers', id)
 *   if (!guard.ok) return guard.response
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, resolveInstitutionScope, type Caller } from './server-access'
import { recordImpersonatedAction } from './impersonation-log'

export type GuardResult =
	| { ok: true; caller: Caller; institutionId: string | null }
	| { ok: false; response: NextResponse }

/** Same as GuardResult, but carrying the row the guard had to read anyway. */
export type GuardRowResult<T> =
	| { ok: true; caller: Caller; institutionId: string | null; row: T }
	| { ok: false; response: NextResponse }

function deny(error: string, status: number): { ok: false; response: NextResponse } {
	return { ok: false, response: NextResponse.json({ error }, { status }) }
}

/**
 * Writes the audit line when a change is made while viewing as someone else.
 *
 * Every route already passes through one of the guards below, so putting it
 * here covers all of them at once — including any route added later. Reads are
 * skipped: it is the changes that need an owner.
 */
function noteIfImpersonated(caller: Caller, request: Request, institutionId: string | null) {
	if (!caller.impersonatedBy) return
	if (request.method.toUpperCase() === 'GET') return

	// Deliberately not awaited — the audit must never delay or fail the action
	void recordImpersonatedAction({
		realUserId: caller.impersonatedBy.userId,
		realEmail: caller.impersonatedBy.email,
		targetUserId: caller.userId,
		targetEmail: caller.email,
		method: request.method,
		path: new URL(request.url).pathname,
		institutionId,
	})
}

/**
 * Resolves which institution this caller may read/write.
 *
 * super_admin keeps whatever was requested (including nothing, meaning all).
 * Everyone else is pinned to their own institution; asking for another one is
 * refused outright rather than quietly re-scoped, so the attempt is visible.
 */
export async function guardCollection(
	request: Request,
	requestedInstitutionId: string | null
): Promise<GuardResult> {
	const { caller, error, status } = await getCaller(request)
	if (!caller) return deny(error ?? 'Not signed in', status ?? 401)


	const scope = resolveInstitutionScope(caller, requestedInstitutionId)
	if (scope.error) return deny(scope.error, scope.status ?? 403)

	noteIfImpersonated(caller, request, scope.institutionId)
	return { ok: true, caller, institutionId: scope.institutionId }
}

/**
 * Same as guardCollection but for a request body. The returned institutionId is
 * what the row must be written with — never take it from the body directly.
 */
export async function guardWrite(
	request: Request,
	bodyInstitutionId: string | null | undefined
): Promise<GuardResult> {
	const { caller, error, status } = await getCaller(request)
	if (!caller) return deny(error ?? 'Not signed in', status ?? 401)


	const scope = resolveInstitutionScope(caller, bodyInstitutionId ?? null)
	if (scope.error) return deny(scope.error, scope.status ?? 403)

	// Anyone who spans institutions must say which one a new row belongs to —
	// a super admin, or a library admin with no college of their own.
	if (!scope.institutionId && (caller.isSuperAdmin || caller.role === 'library_admin')) {
		return deny('institution_id is required — select an institution first', 400)
	}

	noteIfImpersonated(caller, request, scope.institutionId)
	return { ok: true, caller, institutionId: scope.institutionId }
}

/**
 * Guards an operation on one existing row: loads its institution_id and refuses
 * if it belongs to another campus. Returns 404 rather than 403 when the row is
 * out of scope, so the URL cannot be used to probe which ids exist elsewhere.
 */
export async function guardRecord(
	request: Request,
	table: string,
	recordId: string
): Promise<GuardResult> {
	const { caller, error, status } = await getCaller(request)
	if (!caller) return deny(error ?? 'Not signed in', status ?? 401)


	// Spans every institution: a super admin, or a library admin overseeing all
	if (caller.isSuperAdmin || (caller.role === 'library_admin' && !caller.institutionId)) {
		noteIfImpersonated(caller, request, null)
		return { ok: true, caller, institutionId: null }
	}

	if (!caller.institutionId) {
		return deny('Your account is not linked to an institution', 403)
	}

	const supabase = getSupabaseServer()
	const { data: row } = await supabase
		.from(table)
		.select('institution_id')
		.eq('id', recordId)
		.maybeSingle()

	if (!row) return deny('Not found', 404)

	if (row.institution_id !== caller.institutionId) {
		return deny('Not found', 404)
	}

	noteIfImpersonated(caller, request, caller.institutionId)
	return { ok: true, caller, institutionId: caller.institutionId }
}

/**
 * The same guard, for a route that goes on to read the very row being guarded.
 *
 * `guardRecord` fetches a row's `institution_id` to check scope, and the route
 * that called it then fetches the same row again in full — two queries against
 * one row, on every detail page load. This reads it once, checks the scope on
 * what came back, and hands the row to the route.
 *
 * `columns` must include `institution_id` (`*` does), because that is what the
 * check is made against. Out-of-scope answers 404, exactly as `guardRecord`
 * does, so the URL still cannot be used to probe which ids exist elsewhere.
 */
export async function guardRecordRow<T extends { institution_id: string | null }>(
	request: Request,
	table: string,
	recordId: string,
	columns: string
): Promise<GuardRowResult<T>> {
	const { caller, error, status } = await getCaller(request)
	if (!caller) return deny(error ?? 'Not signed in', status ?? 401)


	const supabase = getSupabaseServer()
	const { data: row, error: readError } = await supabase
		.from(table)
		.select(columns)
		.eq('id', recordId)
		.maybeSingle()

	if (readError) {
		console.error(`Error reading ${table} for the record guard:`, readError.message)
		return deny('Failed to read the record', 500)
	}

	if (!row) return deny('Not found', 404)

	// The columns are given by the caller, so the client cannot type the row
	const record = row as unknown as T

	// Spans every institution: a super admin, or a library admin overseeing all
	if (caller.isSuperAdmin || (caller.role === 'library_admin' && !caller.institutionId)) {
		noteIfImpersonated(caller, request, null)
		return { ok: true, caller, institutionId: null, row: record }
	}

	if (!caller.institutionId) {
		return deny('Your account is not linked to an institution', 403)
	}

	if (record.institution_id !== caller.institutionId) {
		return deny('Not found', 404)
	}

	noteIfImpersonated(caller, request, caller.institutionId)
	return { ok: true, caller, institutionId: caller.institutionId, row: record }
}
