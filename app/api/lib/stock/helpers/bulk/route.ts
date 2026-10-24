/**
 * Stock check helpers, many at once: /api/lib/stock/helpers/bulk
 *
 *   POST { institution_id?, expires_on, rows: [{ row, name, email, institution }], save }
 *
 * The same list as /api/lib/stock/helpers, filled from a spreadsheet instead of
 * one search at a time. With `save: false` every row is checked and nothing is
 * written, so the screen can show what will happen; with `save: true` the rows
 * that pass are written and the rest are reported.
 *
 * A college named in the body wins — the sheet then has no Institution column.
 * Without one (All Institutions) each row names the college it is lent to.
 *
 * MYJKKN STAFF ONLY. Every address is looked up in MyJKKN's whole staff roster,
 * on the institution email — exactly as sign-in matches it: typed by hand, one
 * wrong letter is a helper who cannot get in, and a learner is not to be
 * assigned from a sheet.
 *
 * SUPER ADMIN ONLY, for the same reason as the single route.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller } from '@/lib/auth/server-access'
import { forgetStockHelpers } from '@/lib/auth/role-grants'
import { logActivity } from '@/lib/library/activity-log'
import { istToday } from '@/lib/library/ist-clock'
import { collegeDirectory, myjkknConfigured } from '@/lib/library/myjkkn-directory'
import { allStaff, type MyjkknStaff } from '@/lib/auth/myjkkn-staff'

const MIGRATION_MESSAGE =
	'The database has not been updated for stock check helpers yet — please run migration 20261022_lib_stock_check_helpers.sql'

const NO_TABLE = new Set(['42P01', 'PGRST205', '42703'])

/** What Postgres says when ON CONFLICT names columns it has no unique index for. */
const NO_SUCH_CONFLICT = '42P10'

/** The same ceiling as adding one helper. */
const MAX_DAYS = 120

/** A stock check is a few dozen people; a sheet far past this is the wrong file. */
const MAX_ROWS = 1000

const text = (value: unknown): string => (value ?? '').toString().trim()

interface SheetRow {
	row: number
	name: string
	email: string
	institution: string
}

interface CheckedRow {
	row: number
	name: string
	email: string
	institution_code: string
	status: 'ready' | 'needs_attention'
	reason: string | null
}

export async function POST(request: Request) {
	try {
		const { caller, error: callerError, status } = await getCaller(request)
		if (!caller) {
			return NextResponse.json({ error: callerError }, { status: status ?? 401 })
		}
		if (!caller.isSuperAdmin) {
			return NextResponse.json(
				{ error: 'Only a super admin can add or remove stock check helpers' },
				{ status: 403 }
			)
		}

		const body = await request.json().catch(() => null)
		if (!body || !Array.isArray(body.rows)) {
			return NextResponse.json({ error: 'Nothing was sent' }, { status: 400 })
		}
		if (body.rows.length === 0) {
			return NextResponse.json({ error: 'The file has no rows to assign' }, { status: 400 })
		}
		if (body.rows.length > MAX_ROWS) {
			return NextResponse.json(
				{ error: `At most ${MAX_ROWS} rows in one file — split it and upload twice` },
				{ status: 400 }
			)
		}

		const expiresOn = text(body.expires_on)
		if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
			return NextResponse.json({ error: 'Choose the last day these helpers may scan' }, { status: 400 })
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

		if (!myjkknConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so the addresses cannot be checked' },
				{ status: 503 }
			)
		}

		const supabase = getSupabaseServer()

		// The library's own colleges — the seven with a MyJKKN mapping
		const { data: institutions } = await supabase
			.from('institutions')
			.select('id, institution_code, myjkkn_institution_ids')

		const colleges = (institutions || [])
			.filter(row => Array.isArray(row.myjkkn_institution_ids) && row.myjkkn_institution_ids.length > 0)
			.map(row => ({ id: row.id as string, code: text(row.institution_code).toUpperCase() }))

		const idByCode = new Map(colleges.map(college => [college.code, college.id]))
		const codeById = new Map(colleges.map(college => [college.id, college.code]))

		const fixedCollege = text(body.institution_id)
		if (fixedCollege && !codeById.has(fixedCollege)) {
			return NextResponse.json({ error: 'That college was not found' }, { status: 400 })
		}

		// Every staff member MyJKKN has, across every campus — the same roster, and
		// the same match on the institution address, that sign-in itself uses. A
		// college's member roll is not enough: it lists a staff member under
		// whichever address MyJKKN filled first, and leaves out the campuses the
		// library does not cover, so people who sign in every day were reported
		// as not found. The roster is cached for a minute and shared.
		const roster = await allStaff()
		// An empty roster is MyJKKN not answering, not a JKKN with no staff —
		// every row would otherwise come back as "not found"
		if (roster.length === 0) {
			return NextResponse.json(
				{ error: 'Could not read the staff list from MyJKKN just now — please try again' },
				{ status: 503 }
			)
		}
		const byInstitutionEmail = new Map<string, MyjkknStaff>()
		const byAnyEmail = new Map<string, MyjkknStaff>()
		for (const person of roster) {
			const institutional = text(person.institutionEmail).toLowerCase()
			if (institutional) byInstitutionEmail.set(institutional, person)
			const any = text(person.email).toLowerCase()
			if (any && !byAnyEmail.has(any)) byAnyEmail.set(any, person)
		}

		// Their own college's code, for the label on the list
		const codeByMyjkknId = new Map<string, string>()
		for (const row of institutions || []) {
			for (const myjkknId of (row.myjkkn_institution_ids as string[] | null) ?? []) {
				codeByMyjkknId.set(String(myjkknId), text(row.institution_code).toUpperCase())
			}
		}

		// Learners are only looked for when an address is not a member of staff,
		// to say why it was left out — most files never need the rolls at all
		let learnerEmails: Set<string> | null = null
		const isLearner = async (email: string) => {
			if (!learnerEmails) {
				const rolls = await Promise.all(colleges.map(college => collegeDirectory(college.id).catch(() => [])))
				learnerEmails = new Set(rolls.flat()
					.filter(person => person.person_kind === 'learner')
					.map(person => text(person.email).toLowerCase())
					.filter(Boolean))
			}
			return learnerEmails.has(email)
		}

		const seen = new Set<string>()
		const checked: CheckedRow[] = []
		const toWrite: { row: CheckedRow; person: MyjkknStaff; institutionId: string }[] = []

		for (const raw of body.rows as SheetRow[]) {
			const email = text(raw?.email).toLowerCase()
			const institutionId = fixedCollege || idByCode.get(text(raw?.institution).toUpperCase()) || ''
			const result: CheckedRow = {
				row: Number(raw?.row) || 0,
				name: text(raw?.name),
				email,
				institution_code: fixedCollege ? codeById.get(fixedCollege) ?? '' : text(raw?.institution).toUpperCase(),
				status: 'needs_attention',
				reason: null,
			}
			checked.push(result)

			if (!email.includes('@')) {
				result.reason = 'Email is missing'
				continue
			}
			if (!institutionId) {
				result.reason = result.institution_code
					? `${result.institution_code} is not one of the library's colleges`
					: 'Institution is missing'
				continue
			}

			const key = `${email}|${institutionId}`
			if (seen.has(key)) {
				result.reason = 'Already in this file for the same college'
				continue
			}

			const staff = byInstitutionEmail.get(email)
			if (!staff) {
				// A member of staff, but this is not the address they sign in with
				const other = byAnyEmail.get(email)
				if (other) {
					result.reason = other.institutionEmail
						? `Use their institution email: ${other.institutionEmail}`
						: 'MyJKKN has no institution email for them, so they cannot sign in'
				} else {
					result.reason = (await isLearner(email))
						? 'This is a learner — only MyJKKN staff can be assigned'
						: 'Not found among MyJKKN staff'
				}
				continue
			}
			if (!staff.isActive) {
				result.reason = 'Inactive in MyJKKN'
				continue
			}

			seen.add(key)
			result.status = 'ready'
			if (!result.name) result.name = staff.fullName ?? ''
			toWrite.push({ row: result, person: staff, institutionId })
		}

		const ready = toWrite.length
		if (!body.save) {
			return NextResponse.json({ rows: checked, ready, saved: 0 })
		}
		if (ready === 0) {
			return NextResponse.json({ error: 'No row is ready to assign' }, { status: 400 })
		}

		const base = (entry: typeof toWrite[number]) => ({
			institution_id: entry.institutionId,
			email: entry.row.email,
			display_name: entry.person.fullName || entry.row.name || null,
			member_number: entry.person.staffCode || null,
			myjkkn_id: entry.person.id || null,
			expires_on: expiresOn,
			created_by: caller.userId,
			created_by_name: caller.fullName ?? caller.email,
		})

		// One row per person per college, so a second upload moves their date
		let { error } = await supabase
			.from('lib_stock_check_helpers')
			.upsert(
				toWrite.map(entry => ({
					...base(entry),
					member_college_code: codeByMyjkknId.get(String(entry.person.myjkknInstitutionId ?? '')) ?? null,
				})),
				{ onConflict: 'email,institution_id' }
			)

		// Before 20261022_lib_stock_helpers_any_college.sql a person has one
		// assignment only, so the last college named for them in the file wins.
		if (error && (error.code === '42703' || error.code === NO_SUCH_CONFLICT)) {
			const lastByEmail = new Map(toWrite.map(entry => [entry.row.email, entry]))
			;({ error } = await supabase
				.from('lib_stock_check_helpers')
				.upsert([...lastByEmail.values()].map(base), { onConflict: 'email' }))
		}

		if (error) {
			if (NO_TABLE.has(error.code)) {
				return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 503 })
			}
			console.error('Error bulk adding stock check helpers:', error)
			return NextResponse.json({ error: 'Could not assign these helpers' }, { status: 500 })
		}

		forgetStockHelpers()

		await logActivity(request, {
			action: 'create',
			resource_type: 'stock_check_helper',
			resource_id: '/registry/stock-check',
			institution_id: fixedCollege || null,
			new_values: {
				bulk: true,
				count: ready,
				expires_on: expiresOn,
				helpers: toWrite.map(entry => `${entry.row.email} → ${codeById.get(entry.institutionId)}`),
			},
		})

		return NextResponse.json({ rows: checked, ready, saved: ready }, { status: 201 })
	} catch (error) {
		console.error('Unexpected error bulk adding stock check helpers:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
