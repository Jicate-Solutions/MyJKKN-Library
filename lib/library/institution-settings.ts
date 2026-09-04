/**
 * Library policy for one institution.
 *
 * Seven campuses, seven libraries, seven sets of rules — so nothing here is a
 * shared constant. Every caller passes an institution id and gets that campus's
 * policy; a campus with no row gets the defaults below and is unaffected by
 * what any other campus configures.
 *
 * The read is tolerant on purpose: if the settings table has not been created
 * yet, callers still get working defaults rather than a crash.
 */

import { getSupabaseServer } from '@/lib/supabase-server'

export interface InstitutionSettings {
	institution_id: string | null
	/** Days after the due date before a fine starts. */
	fine_grace_days: number
	/** Highest fine one item can reach, or null for no cap. */
	fine_max_per_item: number | null
	/** Count only working days when charging a fine. */
	fine_working_days_only: boolean
	/** Refuse to issue while the member owes money. */
	block_borrowing_when_fine_due: boolean
	/** Added on top of the price when a book is lost, as a percentage. */
	lost_item_processing_percent: number

	accession_prefix: string
	accession_start_number: number
	accession_pad_width: number
	accession_resets_yearly: boolean

	/** 'college_id' uses the learner's own ID as their member number. */
	member_number_source: 'auto' | 'college_id'
	member_number_prefix: string

	opening_time: string
	closing_time: string
	requires_no_dues: boolean
	/**
	 * Seconds within which a second scan of the same card at the gate is the
	 * same entry, not an exit. A card swiped twice in the queue used to become
	 * a one-minute "visit" and count twice in the footfall. 0 turns it off.
	 * Column added 2026-09-04; a database without it gets the default.
	 */
	gate_rescan_seconds: number
}

export const DEFAULT_SETTINGS: InstitutionSettings = {
	institution_id: null,
	fine_grace_days: 0,
	fine_max_per_item: null,
	fine_working_days_only: false,
	block_borrowing_when_fine_due: true,
	lost_item_processing_percent: 0,
	accession_prefix: 'ACC-',
	accession_start_number: 1,
	accession_pad_width: 4,
	accession_resets_yearly: true,
	member_number_source: 'auto',
	member_number_prefix: 'LIB',
	opening_time: '09:00',
	closing_time: '16:30',
	requires_no_dues: false,
	gate_rescan_seconds: 60,
}

/**
 * How long a campus's policy is reused before being read again.
 *
 * These rules are read on every issue, renew, return and desk lookup, and they
 * change perhaps twice a year — so re-reading the row for each of those was a
 * round trip spent confirming what had not moved. Saving the policy on the
 * settings page clears it here at once, so an edited fine is in force on the
 * next issue and not a minute later; the window below only covers a rule
 * changed straight in the database.
 *
 * Kept per institution, like everything else about these rules: one campus's
 * entry is never handed to another.
 */
const SETTINGS_TTL_MS = 60_000

interface CachedSettings {
	settings: InstitutionSettings
	expiresAt: number
}

const settingsCache = new Map<string, CachedSettings>()

/** Forgets one campus's policy, or every campus's. */
export function invalidateInstitutionSettings(institutionId?: string | null): void {
	if (!institutionId) settingsCache.clear()
	else settingsCache.delete(institutionId)
}

/** Reads one institution's policy, falling back to the defaults above. */
export async function getInstitutionSettings(
	institutionId: string | null | undefined
): Promise<InstitutionSettings> {
	if (!institutionId) return DEFAULT_SETTINGS

	const cached = settingsCache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached.settings

	const settings = await readInstitutionSettings(institutionId)
	settingsCache.set(institutionId, { settings, expiresAt: Date.now() + SETTINGS_TTL_MS })
	return settings
}

/** The read itself, exactly as it was before it was worth remembering. */
async function readInstitutionSettings(institutionId: string): Promise<InstitutionSettings> {
	try {
		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_institution_settings')
			.select('*')
			.eq('institution_id', institutionId)
			.maybeSingle()

		if (error || !data) return { ...DEFAULT_SETTINGS, institution_id: institutionId }

		return {
			...DEFAULT_SETTINGS,
			...data,
			institution_id: institutionId,
			fine_max_per_item: data.fine_max_per_item ?? null,
		}
	} catch {
		// Table not created yet — defaults keep the desk working
		return { ...DEFAULT_SETTINGS, institution_id: institutionId }
	}
}

/**
 * Whole days a book is late, after the grace period, optionally skipping
 * Sundays. Never negative.
 */
export function chargeableLateDays(
	dueDate: string | Date,
	returnedOn: string | Date,
	settings: InstitutionSettings
): number {
	const due = new Date(dueDate)
	const back = new Date(returnedOn)
	due.setHours(0, 0, 0, 0)
	back.setHours(0, 0, 0, 0)

	const MS_PER_DAY = 24 * 60 * 60 * 1000
	const rawDays = Math.floor((back.getTime() - due.getTime()) / MS_PER_DAY)
	if (rawDays <= settings.fine_grace_days) return 0

	if (!settings.fine_working_days_only) return rawDays - settings.fine_grace_days

	// Walk the calendar and skip Sundays. The librarian can still adjust the
	// amount by hand afterwards for college holidays we cannot know about.
	let chargeable = 0
	const cursor = new Date(due)
	cursor.setDate(cursor.getDate() + settings.fine_grace_days)

	while (cursor < back) {
		cursor.setDate(cursor.getDate() + 1)
		if (cursor.getDay() !== 0) chargeable++
	}

	return chargeable
}

/** Applies the per-item cap, if this institution has one. */
export function capFine(amount: number, settings: InstitutionSettings): number {
	if (settings.fine_max_per_item === null) return amount
	return Math.min(amount, settings.fine_max_per_item)
}
