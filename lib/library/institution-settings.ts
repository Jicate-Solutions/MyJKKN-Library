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
}

/** Reads one institution's policy, falling back to the defaults above. */
export async function getInstitutionSettings(
	institutionId: string | null | undefined
): Promise<InstitutionSettings> {
	if (!institutionId) return DEFAULT_SETTINGS

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
