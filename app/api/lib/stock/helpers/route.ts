/**
 * Stock check helpers: /api/lib/stock/helpers
 *
 *   GET    ?institution_id=…        this college's helpers, soonest to lapse first
 *   POST   { institution_id, … }    let one more learner scan, until a date
 *   DELETE ?id=…                    take it back now
 *
 * A stock check is counted by a few learners for a week. Letting one in used to
 * mean editing LIBRARY_ACCESS_GRANTS in Vercel — a redeploy, an engineer, and a
 * librarian who could not add a helper on the morning the counting started.
 * This is that list, so the Stock Check page can manage it itself.
 *
 * SUPER ADMIN ONLY, every verb including the read. A helper's own grant lets
 * them GET anything under /api/lib/stock, which is what makes their one page
 * work — so without the check below they could read, and then edit, the list of
 * who else is a helper. The guard lets them past; this route does not.
 *
 * Nothing here is a login. A helper still signs in through MyJKKN like
 * everybody else; all a row does is answer what MyJKKN cannot — that this
 * address is expected, until this date, at this college, for this one job.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller } from '@/lib/auth/server-access'
import { forgetStockHelpers } from '@/lib/auth/role-grants'
import { logActivity } from '@/lib/library/activity-log'
import { istToday } from '@/lib/library/ist-clock'

/** Said when the table is not there yet, instead of a 500 nobody can act on. */
const MIGRATION_MESSAGE =
	'The database has not been updated for stock check helpers yet — please run migration 20261022_lib_stock_check_helpers.sql'

/** Table-not-there, from Postgres and from PostgREST. */
const NO_TABLE = new Set(['42P01', 'PGRST205', '42703'])

const COLUMNS =
	'id, institution_id, email, display_name, member_number, myjkkn_id, expires_on, created_at, created_by_name'

/**
 * The longest a helper may be let in for.
 *
 * A stock check is a week of counting, not a standing arrangement. A date
 * further out than this is almost always a typo in the year, and the one time
 * it is not, adding them again in three months costs nothing.
 */
const MAX_DAYS = 120

const text = (value: unknown): string => (value ?? '').toString().trim()

/** Only a super admin, and the same answer for every verb. */
async function requireSuperAdmin(request: Request) {
	const { caller, error, status } = await getCaller(request)
	if (!caller) {
		return { ok: false as const, response: NextResponse.json({ error }, { status: status ?? 401 }) }
	}
	if (!caller.isSuperAdmin) {
		return {
			ok: false as const,
			response: NextResponse.json(
				{ error: 'Only a super admin can add or remove stock check helpers' },
				{ status: 403 }
			),
		}
	}
	return { ok: true as const, caller }
}

/** A row as the screen reads it, with the one thing it cannot work out itself. */
function withState(row: Record<string, unknown>) {
	const expiresOn = text(row.expires_on)
	return {
		...row,
		// Compared as plain dates, the same way the grant itself is read: the
		// named day is the last one that works, all of it.
		is_expired: expiresOn ? expiresOn < istToday() : true,
	}
}

export async function GET(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const institutionId = text(new URL(request.url).searchParams.get('institution_id'))
		if (!institutionId) {
			return NextResponse.json({ error: 'Select a college first' }, { status: 400 })
		}

		const { data, error } = await getSupabaseServer()
			.from('lib_stock_check_helpers')
			.select(COLUMNS)
			.eq('institution_id', institutionId)
			.order('expires_on', { ascending: false })

		if (error) {
			if (NO_TABLE.has(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 503 })
			}
			console.error('Error reading stock check helpers:', error)
			return NextResponse.json({ error: 'Could not read the helper list' }, { status: 500 })
		}

		return NextResponse.json((data ?? []).map(withState))
	} catch (error) {
		console.error('Unexpected error reading stock check helpers:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const body = await request.json().catch(() => null)
		if (!body) {
			return NextResponse.json({ error: 'Nothing was sent' }, { status: 400 })
		}

		const institutionId = text(body.institution_id)
		const email = text(body.email).toLowerCase()
		const expiresOn = text(body.expires_on)

		if (!institutionId) {
			return NextResponse.json({ error: 'Select a college first' }, { status: 400 })
		}
		// MyJKKN is where they sign in, so without an address there is nothing to
		// recognise them by and the grant could never match anybody.
		if (!email.includes('@')) {
			return NextResponse.json(
				{ error: 'This member has no email address in MyJKKN, so they cannot be signed in as a helper' },
				{ status: 400 }
			)
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
			return NextResponse.json({ error: 'Choose the last day this helper may scan' }, { status: 400 })
		}

		const today = istToday()
		if (expiresOn < today) {
			return NextResponse.json({ error: 'That date has already passed' }, { status: 400 })
		}
		const latest = new Date(Date.parse(today + 'T00:00:00.000Z') + MAX_DAYS * 86400000)
			.toISOString()
			.slice(0, 10)
		if (expiresOn > latest) {
			return NextResponse.json(
				{ error: `A helper can be let in for at most ${MAX_DAYS} days — until ${latest}` },
				{ status: 400 }
			)
		}

		const supabase = getSupabaseServer()

		// The college must be a real one. Super admin spans every campus, so the
		// id arrives from the screen rather than from a scope, and an id that is
		// not a college would write a row no sign-in could ever match.
		const { data: college } = await supabase
			.from('institutions')
			.select('id, institution_code')
			.eq('id', institutionId)
			.maybeSingle()

		if (!college) {
			return NextResponse.json({ error: 'That college was not found' }, { status: 400 })
		}

		// One address, one helper grant. Adding the same person again moves their
		// date rather than failing — that is what somebody pressing Add a second
		// time means, and refusing it would only send them to find the row first.
		const { data, error } = await supabase
			.from('lib_stock_check_helpers')
			.upsert(
				{
					institution_id: institutionId,
					email,
					display_name: text(body.display_name) || null,
					member_number: text(body.member_number) || null,
					myjkkn_id: text(body.myjkkn_id) || null,
					expires_on: expiresOn,
					created_by: guard.caller.userId,
					created_by_name: guard.caller.fullName ?? guard.caller.email,
				},
				{ onConflict: 'email' }
			)
			.select(COLUMNS)
			.maybeSingle()

		if (error) {
			if (NO_TABLE.has(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 503 })
			}
			console.error('Error adding a stock check helper:', error)
			return NextResponse.json({ error: 'Could not add this helper' }, { status: 500 })
		}

		// The sign-in path holds this list for half a minute; this one server has
		// just changed it, so it stops holding the old answer.
		forgetStockHelpers()

		await logActivity(request, {
			action: 'create',
			resource_type: 'stock_check_helper',
			resource_id: '/registry/stock-check',
			institution_id: institutionId,
			new_values: { email, expires_on: expiresOn, college: college.institution_code },
		})

		return NextResponse.json(withState((data ?? {}) as Record<string, unknown>), { status: 201 })
	} catch (error) {
		console.error('Unexpected error adding a stock check helper:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const guard = await requireSuperAdmin(request)
		if (!guard.ok) return guard.response

		const id = text(new URL(request.url).searchParams.get('id'))
		if (!id) {
			return NextResponse.json({ error: 'Which helper?' }, { status: 400 })
		}

		const { data, error } = await getSupabaseServer()
			.from('lib_stock_check_helpers')
			.delete()
			.eq('id', id)
			.select(COLUMNS)
			.maybeSingle()

		if (error) {
			if (NO_TABLE.has(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 503 })
			}
			console.error('Error removing a stock check helper:', error)
			return NextResponse.json({ error: 'Could not remove this helper' }, { status: 500 })
		}
		if (!data) {
			return NextResponse.json({ error: 'That helper was already removed' }, { status: 404 })
		}

		forgetStockHelpers()

		await logActivity(request, {
			action: 'delete',
			resource_type: 'stock_check_helper',
			resource_id: '/registry/stock-check',
			institution_id: text(data.institution_id),
			old_values: { email: data.email, expires_on: data.expires_on },
		})

		return NextResponse.json({ ok: true })
	} catch (error) {
		console.error('Unexpected error removing a stock check helper:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
