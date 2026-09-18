/**
 * Each college's own holidays, read from the JKKN calendar.
 *
 * The calendar lives in the MyJKKN sign-in project (`NEXT_PUBLIC_SUPABASE_URL1`,
 * the project `jkkn-identity.ts` already reads with the same service key):
 *
 *   * `calendar_entries` — one row per holiday, event or meeting. Only
 *     `kind = 'holiday'` rows matter here; events and meetings do not close
 *     anything.
 *   * `scope_institution_ids` — the MyJKKN institutions the holiday is for.
 *     Null (or empty) means every institution: Independence Day, Deepavali.
 *     A list means only those: the First and Third Saturdays are leave for
 *     six colleges and a working day for Dental, which is not on the list.
 *
 * Checked against the live calendar on 18 Sep 2026: the six scoped ids are
 * AHS, CAS, CET, CNR, COE and COP, matched through our own
 * `institutions.myjkkn_institution_ids` — the same mapping every MyJKKN read in
 * this app goes through, so a college is only ever given its own days.
 *
 * What the library does with a closed day: a fine does not count it — the
 * book could not have come back — and a due date that lands on it moves to
 * the next day the library is open.
 *
 * Tolerant on purpose. Without the key, or if the calendar cannot be read,
 * every college simply has no holidays and fines and due dates work exactly as
 * they did before this existed.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { myjkknInstitutionIdsFor } from '@/lib/library/myjkkn-directory'
import type { InstitutionSettings } from '@/lib/library/institution-settings'

const CALENDAR_URL = process.env.NEXT_PUBLIC_SUPABASE_URL1 ?? ''
/** Server-only. The calendar is read the way `jkkn_identities` is, with the service key. */
const CALENDAR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY1 ?? ''

let reader: SupabaseClient | null = null

/** One read-only client, made once. It carries no session, so it is shareable. */
function getReader(): SupabaseClient | null {
	if (!CALENDAR_URL || !CALENDAR_KEY) return null
	if (!reader) {
		reader = createClient(CALENDAR_URL, CALENDAR_KEY, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	}
	return reader
}

/**
 * How long a college's holidays are reused before the calendar is read again.
 *
 * Read on every issue, renewal, return and desk lookup, and changed a few
 * times a term. Ten minutes means a holiday added this morning is in force
 * before lunch, at one read per college per ten minutes. A failed read is
 * kept for one minute only, so the calendar is tried again soon.
 */
const HOLIDAYS_TTL_MS = 10 * 60 * 1000
const FAILED_TTL_MS = 60 * 1000

const holidayCache = new Map<string, { days: Set<string>; expiresAt: number }>()

interface CalendarRow {
	start_at: string
	end_at: string | null
	all_day: boolean | null
}

/** YYYY-MM-DD as the calendar means it, in India. */
function istDateKey(iso: string): string {
	const shifted = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000)
	return shifted.toISOString().slice(0, 10)
}

/**
 * Every date one calendar row closes, first to last.
 *
 * An all-day row is stored as the date itself — 2026-08-15T00:00Z to
 * 2026-08-15T23:59:59Z — so its dates are read as written; turning them into
 * India time would push the end a day late. A timed row is read in India time.
 * Pongal, the 14th to the 16th, is three dates.
 */
function datesOf(row: CalendarRow): string[] {
	const first = row.all_day ? row.start_at.slice(0, 10) : istDateKey(row.start_at)
	const lastRaw = row.end_at ?? row.start_at
	const last = row.all_day ? lastRaw.slice(0, 10) : istDateKey(lastRaw)

	const days: string[] = []
	const cursor = new Date(`${first}T00:00:00Z`)
	const end = new Date(`${last}T00:00:00Z`)
	// A row running backwards, or longer than a year, is a typing mistake —
	// the first date alone is kept rather than closing the library for months.
	if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return []
	if (end < cursor || end.getTime() - cursor.getTime() > 366 * 86_400_000) return [first]

	while (cursor <= end) {
		days.push(cursor.toISOString().slice(0, 10))
		cursor.setUTCDate(cursor.getUTCDate() + 1)
	}
	return days
}

/**
 * The dates this college is closed for a holiday, as YYYY-MM-DD.
 *
 * Holidays for every institution, plus those scoped to any of the MyJKKN
 * institutions this college is. Another college's leave is never included.
 */
export async function collegeHolidays(institutionId: string | null | undefined): Promise<Set<string>> {
	if (!institutionId) return new Set()

	const cached = holidayCache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached.days

	const supabase = getReader()
	if (!supabase) return new Set()

	try {
		const myjkknIds = await myjkknInstitutionIdsFor(institutionId)

		// Everyone's holidays, and this college's own. A college with no
		// mapping gets only the everyone-holidays: its own cannot be told apart.
		const scope = myjkknIds.length > 0
			? `scope_institution_ids.is.null,scope_institution_ids.eq.{},scope_institution_ids.ov.{${myjkknIds.join(',')}}`
			: 'scope_institution_ids.is.null,scope_institution_ids.eq.{}'

		const { data, error } = await supabase
			.from('calendar_entries')
			.select('start_at, end_at, all_day')
			.eq('kind', 'holiday')
			.eq('is_active', true)
			.or(scope)
			.range(0, 4999)

		if (error) throw error

		const days = new Set<string>()
		for (const row of (data ?? []) as CalendarRow[]) {
			for (const day of datesOf(row)) days.add(day)
		}

		holidayCache.set(institutionId, { days, expiresAt: Date.now() + HOLIDAYS_TTL_MS })
		return days
	} catch (error) {
		console.warn('[college-calendar] holidays not read, carrying on without them:', error)
		const days = new Set<string>()
		holidayCache.set(institutionId, { days, expiresAt: Date.now() + FAILED_TTL_MS })
		return days
	}
}

/**
 * True when the library is shut on this date.
 *
 * A holiday on this college's calendar, or a Sunday where the college counts
 * working days only (Library Rules → "Count only working days") — the same
 * Sunday rule fines have always used.
 */
export function isClosedDay(
	dateKey: string,
	holidays: ReadonlySet<string>,
	settings: Pick<InstitutionSettings, 'fine_working_days_only'>
): boolean {
	if (holidays.has(dateKey)) return true
	if (settings.fine_working_days_only && new Date(`${dateKey}T00:00:00Z`).getUTCDay() === 0) return true
	return false
}

/**
 * A due date moved off a closed day, onto the next day the library is open.
 *
 * A book due on Deepavali cannot come back on Deepavali; due on the day after
 * three days of Pongal, it is due then. Takes and gives YYYY-MM-DD. Never
 * moves more than sixty days, so a calendar typed wrongly cannot push a loan
 * out indefinitely.
 */
export function nextOpenDay(
	dateKey: string,
	holidays: ReadonlySet<string>,
	settings: Pick<InstitutionSettings, 'fine_working_days_only'>
): string {
	const cursor = new Date(`${dateKey}T00:00:00Z`)
	if (Number.isNaN(cursor.getTime())) return dateKey
	for (let moved = 0; moved < 60; moved++) {
		const key = cursor.toISOString().slice(0, 10)
		if (!isClosedDay(key, holidays, settings)) return key
		cursor.setUTCDate(cursor.getUTCDate() + 1)
	}
	return dateKey
}
