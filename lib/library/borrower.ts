/**
 * The borrower row — written the moment somebody actually takes a book.
 *
 * Members are not kept in this database; they are read from MyJKKN every time
 * (see `myjkkn-directory.ts`). But a loan, a fine and a hold have to point at
 * someone for years, so the first time a person borrows, one row is written
 * here: their MyJKKN id, and what their name and number were on that day.
 *
 * Everything about that row is a consequence of an act, never of an enrolment.
 * Nobody who has not borrowed exists in `lib_borrowers` at all.
 *
 * The snapshot is refreshed each time they come back, so a corrected name or a
 * new email follows them without anyone editing anything — while a fine from
 * two years ago still says whose fine it was, even if MyJKKN has since
 * forgotten them entirely.
 */

import type { getSupabaseServer } from '@/lib/supabase-server'
import type { DirectoryPerson } from './myjkkn-directory'

type Supabase = ReturnType<typeof getSupabaseServer>

/** What the circulation routes read off a borrower. */
export interface BorrowerRow {
	id: string
	institution_id: string
	myjkkn_id: string
	person_kind: string
	member_number: string
	member_category: string
	display_name: string | null
	email: string | null
	phone: string | null
	is_delinquent: boolean
}

const BORROWER_COLUMNS =
	'id, institution_id, myjkkn_id, person_kind, member_number, member_category, display_name, email, phone, is_delinquent'

/**
 * The borrower row for a MyJKKN person, if they have ever borrowed here.
 *
 * Returns null rather than creating one — used where the question is "what do
 * we already know about them", such as showing a fine at the desk before a
 * book has been picked.
 */
export async function findBorrower(
	supabase: Supabase,
	institutionId: string,
	myjkknId: string
): Promise<BorrowerRow | null> {
	const { data } = await supabase
		.from('lib_borrowers')
		.select(BORROWER_COLUMNS)
		.eq('institution_id', institutionId)
		.eq('myjkkn_id', myjkknId)
		.maybeSingle()

	return (data as unknown as BorrowerRow) ?? null
}

/** One borrower by row id, scoped to the college that asked. */
export async function borrowerById(
	supabase: Supabase,
	institutionId: string | null,
	borrowerId: string
): Promise<BorrowerRow | null> {
	let query = supabase
		.from('lib_borrowers')
		.select(BORROWER_COLUMNS)
		.eq('id', borrowerId)

	if (institutionId) query = query.eq('institution_id', institutionId)

	const { data } = await query.maybeSingle()
	return (data as unknown as BorrowerRow) ?? null
}

/** True when the two records say different things about the same person. */
function snapshotDiffers(row: BorrowerRow, person: DirectoryPerson): boolean {
	return row.member_number !== person.member_number
		|| row.member_category !== person.member_category
		|| (row.display_name ?? '') !== person.display_name
		|| (row.email ?? '') !== (person.email ?? '')
		|| (row.phone ?? '') !== (person.phone ?? '')
}

/**
 * The borrower row for this person, creating it if this is their first book.
 *
 * Safe under two librarians at once: `UNIQUE(institution_id, myjkkn_id)` makes
 * the second insert fail with 23505, and that is read as "somebody else just
 * created it" and answered by reading theirs — never by making a second row,
 * which would split one person's fines in two.
 */
export async function ensureBorrower(
	supabase: Supabase,
	institutionId: string,
	person: DirectoryPerson
): Promise<{ borrower: BorrowerRow | null; error: string | null }> {
	const existing = await findBorrower(supabase, institutionId, person.myjkkn_id)

	if (existing) {
		// Keep what we hold in step with MyJKKN, but only when it has actually
		// changed — an ordinary issue then costs one comparison, not a write.
		if (snapshotDiffers(existing, person)) {
			const { data: updated } = await supabase
				.from('lib_borrowers')
				.update({
					member_number: person.member_number,
					member_category: person.member_category,
					display_name: person.display_name,
					email: person.email,
					phone: person.phone,
					last_seen_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq('id', existing.id)
				.select(BORROWER_COLUMNS)
				.maybeSingle()

			// A refusal to refresh the name must not refuse the book
			if (updated) return { borrower: updated as unknown as BorrowerRow, error: null }
		}
		return { borrower: existing, error: null }
	}

	const now = new Date().toISOString()
	const { data: created, error } = await supabase
		.from('lib_borrowers')
		.insert({
			institution_id: institutionId,
			myjkkn_id: person.myjkkn_id,
			person_kind: person.person_kind,
			member_number: person.member_number,
			member_category: person.member_category,
			display_name: person.display_name,
			email: person.email,
			phone: person.phone,
			is_delinquent: false,
			first_borrowed_at: now,
			last_seen_at: now,
		})
		.select(BORROWER_COLUMNS)
		.maybeSingle()

	if (!error && created) return { borrower: created as unknown as BorrowerRow, error: null }

	// Someone else created it between our read and our write
	if (error?.code === '23505') {
		const raced = await findBorrower(supabase, institutionId, person.myjkkn_id)
		if (raced) return { borrower: raced, error: null }
	}

	// The database has not been given the new table yet — say so plainly rather
	// than leaving the desk with "Failed to issue"
	if (error?.code === '42P01') {
		return {
			borrower: null,
			error: 'This library\'s database has not been updated for the new member system yet — please run the pending database update',
		}
	}

	console.error('Error creating borrower:', error)
	return { borrower: null, error: 'Could not record who is borrowing' }
}

/**
 * Marks a borrower as owing money, or as clear.
 *
 * Wrapped rather than written inline at each call site so "who owes" has one
 * definition, and so the three places that change it cannot drift apart.
 */
export async function setDelinquent(
	supabase: Supabase,
	borrowerId: string,
	owes: boolean
): Promise<void> {
	const { error } = await supabase
		.from('lib_borrowers')
		.update({ is_delinquent: owes, updated_at: new Date().toISOString() })
		.eq('id', borrowerId)

	if (error) console.error('Could not update the borrower\'s outstanding-fine flag:', error.message)
}

/**
 * The join every screen uses to show who a loan, fine or hold belongs to.
 *
 * Named once here so the eight routes that read a borrower alongside something
 * else ask for exactly the same fields, and so the aliases the pages already
 * render against — `member.display_name`, `member.member_number` — keep
 * meaning what they meant when the row lived in `lib_members`.
 */
export const BORROWER_JOIN =
	'member:lib_borrowers(id, member_number, display_name, member_category, email, phone, myjkkn_id, person_kind, is_delinquent)'
