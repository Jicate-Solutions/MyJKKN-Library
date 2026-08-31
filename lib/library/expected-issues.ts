/**
 * A year's issues, written out the day a subscription is registered.
 *
 * A monthly journal will bring twelve issues. The librarian knows that on day
 * one, and until now had to record each one from nothing as it arrived — which
 * means the register could only ever answer "what came", never "what is owed".
 * An issue that never turned up simply was not there, and looked identical to
 * one nobody had got round to entering.
 *
 * So the twelve rows are created up front, all marked 'expected'. Each is
 * turned to 'received' on the day it arrives, and whatever is still 'expected'
 * at the end of the year is the claim that goes to the supplier — a list the
 * library can now produce instead of reconstructing from memory.
 *
 * Nothing here is guessed. The count is the subscription's own expected_issues,
 * which the form works out from the frequency; the volume is the one the
 * librarian entered. Dates are deliberately left empty: when an issue arrives
 * is not something to predict, and a cover date invented in advance would be
 * indistinguishable from one read off an issue in hand.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'

type Supabase = ReturnType<typeof getSupabaseServer>

/**
 * A ceiling on how many rows one subscription may lay out.
 *
 * The form only ever sends 1 to 52, but this route takes a number from the
 * request, and a mistyped or hand-made 100000 would write a hundred thousand
 * rows against one journal. Weekly is 52, so anything past a hundred is not a
 * subscription anybody is running.
 */
const MOST_ISSUES = 100

export interface ExpectedIssuesResult {
	/** How many rows were written. Zero is a valid answer — see `reason`. */
	created: number
	/** Why nothing was written, for the librarian rather than the log. */
	reason: string | null
}

/**
 * Lays out the issues a subscription is going to bring.
 *
 * Never throws, and never undoes the subscription: a journal registered without
 * its twelve rows is a small inconvenience the librarian can fix by hand, while
 * a subscription refused because of them is a librarian who cannot get on with
 * their day. The caller reports `reason` alongside the subscription it did
 * create.
 */
export async function createExpectedIssues(
	supabase: Supabase,
	subscription: {
		id: string
		institution_id: string
		start_volume: string | null
		expected_issues: number | null
	}
): Promise<ExpectedIssuesResult> {
	const wanted = Number(subscription.expected_issues)

	if (!Number.isInteger(wanted) || wanted < 1) {
		return { created: 0, reason: null }
	}
	if (wanted > MOST_ISSUES) {
		return { created: 0, reason: `${wanted} issues is more than one subscription can hold` }
	}

	const rows = Array.from({ length: wanted }, (_, index) => ({
		institution_id: subscription.institution_id,
		subscription_id: subscription.id,
		// The volume the librarian entered, carried onto every issue in it. Text,
		// because "12" and "Vol 12" are both what somebody wrote on the shelf.
		volume_number: subscription.start_volume || null,
		issue_number: String(index + 1),
		issue_date: null,
		// Not yet arrived, so not yet received. This is what the pending
		// migration makes possible — see the error handling below.
		received_date: null,
		cover_date: null,
		pages: null,
		receipt_status: 'expected',
		is_bound: false,
	}))

	const { error } = await supabase.from('lib_periodical_issues').insert(rows)

	if (!error) return { created: rows.length, reason: null }

	// 23502 is a not-null violation, which here means one thing: the database
	// still has received_date NOT NULL and the migration has not been run. Say
	// so plainly — "Failed to create issues" would send somebody looking at the
	// subscription, which is fine, rather than at the update that is missing.
	if (error.code === '23502') {
		return {
			created: 0,
			reason: 'This library\'s database has not been updated yet — run the pending database update to have issues laid out automatically',
		}
	}

	console.error('Could not lay out the expected issues:', error)
	return { created: 0, reason: 'The subscription was saved, but its issues could not be laid out' }
}
