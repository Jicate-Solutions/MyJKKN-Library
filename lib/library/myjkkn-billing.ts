/**
 * A library fine put on the learner's MyJKKN bill.
 *
 * A fine used to be settled at the counter and nowhere else: cash in hand and
 * Paid, or Waive. A learner with nothing on them went away and came back, and
 * the book stayed out until they did.
 *
 * MyJKKN already bills them for tuition, hostel and transport, and they already
 * pay those online. So a fine can go on the same bill. The library writes one
 * row into `billing_student_bills` in the MyJKKN project — the same database
 * this app already reads the calendar and the identity cards from — and from
 * then on MyJKKN owns it: the learner sees it under My Bills, pays it with the
 * rest, and MyJKKN marks the bill paid. The library only ever reads that back.
 *
 * What this file will and will not touch in MyJKKN:
 *
 *   * writes  — `billing_student_bills`, one row per fine, and nothing else;
 *   * reads   — `billing_categories` to find the Library Fine category's id,
 *               and `learners_profiles` to confirm the learner and take the
 *               institution the bill belongs to.
 *
 * Nothing else over there is read or changed, and no row this file wrote is
 * ever deleted: a bill that should not stand is cancelled through MyJKKN's own
 * flow by the people whose books it is.
 *
 * Tolerant, like the calendar. Without the MyJKKN key, or before somebody
 * creates the Library Fine category, `billingReady()` is false, the desk does
 * not offer to bill, and every fine is settled at the counter exactly as it was
 * before this existed.
 *
 * Learners only. `billing_student_bills.student_id` points at
 * `learners_profiles`, so a facilitator's fine has no bill to go on and is
 * refused here rather than written wrongly.
 *
 * Server side only — it carries the service key.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { getSupabaseServer } from '@/lib/supabase-server'

/** Our own database, as the caller already holds it. */
type LibraryDb = ReturnType<typeof getSupabaseServer>

const BILLING_URL = process.env.NEXT_PUBLIC_SUPABASE_URL1 ?? ''
const BILLING_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY1 ?? ''

/** The category a library fine is billed under, by name, as MyJKKN spells it. */
const CATEGORY_NAME = 'Library Fine'

/** How long the category's id is reused. It is created once and never renamed. */
const CATEGORY_TTL_MS = 30 * 60 * 1000
/** A category that is not there yet is looked for again soon, not in half an hour. */
const MISSING_TTL_MS = 60 * 1000

let client: SupabaseClient | null = null

/** One client, made once. It carries no session, so it is shareable. */
function getBilling(): SupabaseClient | null {
	if (!BILLING_URL || !BILLING_KEY) return null
	if (!client) {
		client = createClient(BILLING_URL, BILLING_KEY, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	}
	return client
}

let categoryCache: { id: string | null; expiresAt: number } | null = null

/**
 * The Library Fine category's id, or null while nobody has made one.
 *
 * Looked up by name rather than kept in an env var so that creating the
 * category in MyJKKN is the only step: the next fine finds it. Null is a
 * normal answer and simply means fines are not billable yet.
 */
export async function libraryFineCategoryId(): Promise<string | null> {
	const billing = getBilling()
	if (!billing) return null

	const now = Date.now()
	if (categoryCache && categoryCache.expiresAt > now) return categoryCache.id

	// `category_name`, not `name` — MyJKKN spells it that way, and asking for a
	// column that is not there is an error, not an empty answer.
	const { data, error } = await billing
		.from('billing_categories')
		.select('id, category_name')
		.eq('category_name', CATEGORY_NAME)
		.limit(1)

	if (error) {
		console.error('[billing] Could not read the billing categories:', error.message)
		categoryCache = { id: null, expiresAt: now + MISSING_TTL_MS }
		return null
	}

	const id = (data?.[0]?.id as string | undefined) ?? null
	categoryCache = { id, expiresAt: now + (id ? CATEGORY_TTL_MS : MISSING_TTL_MS) }
	return id
}

/** Whether a fine can be billed at all: the key is set and the category exists. */
export async function billingReady(): Promise<boolean> {
	return (await libraryFineCategoryId()) !== null
}

/** One fine per key, forever: the charge row it belongs to. */
export const billingKeyFor = (chargeId: string) => `library-fine:${chargeId}`

export interface FineBillRequest {
	/** Our own `lib_late_charges.id` — what the key is built from. */
	charge_id: string
	/** The learner's MyJKKN id, which is `learners_profiles.id`. */
	learner_id: string
	amount: number
	/** The day the library wants it paid by. */
	due_date: string
	/** "Library fine — <book> — <n> days late". What the learner reads. */
	description: string
}

export interface FineBillResult {
	bill_id: string
	idempotency_key: string
}

/**
 * Raises the bill for one fine, or hands back the one already raised.
 *
 * The key is checked first and the insert carries it, so a retry, a double
 * click or a second desk cannot charge the same fine twice — whichever call
 * arrives second finds the first bill and returns it.
 *
 * Throws with a plain message the desk can show. It never half-writes: either
 * a bill exists at the end of this or nothing was written.
 */
export async function raiseFineBill(request: FineBillRequest): Promise<FineBillResult> {
	const billing = getBilling()
	if (!billing) throw new Error('MyJKKN billing is not configured on this server')

	const categoryId = await libraryFineCategoryId()
	if (!categoryId) {
		throw new Error(`MyJKKN has no "${CATEGORY_NAME}" billing category yet — create it there first`)
	}

	const amount = Math.round(Number(request.amount) * 100) / 100
	if (!(amount > 0)) throw new Error('A bill cannot be raised for nothing')

	const key = billingKeyFor(request.charge_id)

	// Already billed? Then that bill is the answer.
	//
	// The key is kept on our own charge row, as the transport module keeps its
	// own, and it is written into the bill's `remarks` as well. That second
	// copy is what makes "one fine, one bill" true rather than hoped for: if
	// the bill is written and the reply never arrives, our row has no bill id
	// and the desk tries again — and this read finds the bill that already
	// exists instead of charging the learner a second time. `remarks` is free
	// text on the bill and no other column of MyJKKN's is touched.
	const { data: existing } = await billing
		.from('billing_student_bills')
		.select('id')
		.eq('remarks', key)
		.limit(1)
	if (existing?.[0]?.id) return { bill_id: String(existing[0].id), idempotency_key: key }

	// The learner's own institution, from their own row. Taking it from here
	// rather than from our mapping means the bill can never land against a
	// college the learner does not belong to, and it proves the learner exists
	// before anything is written.
	const { data: learner, error: learnerError } = await billing
		.from('learners_profiles')
		.select('id, institution_id')
		.eq('id', request.learner_id)
		.maybeSingle()

	if (learnerError) throw new Error('Could not reach MyJKKN to raise the bill')
	if (!learner) throw new Error('This member is not a learner in MyJKKN, so no bill can be raised')

	const { data: bill, error } = await billing
		.from('billing_student_bills')
		.insert({
			student_id: learner.id,
			institution_id: learner.institution_id,
			item_category_id: categoryId,
			bill_description: request.description,
			due_date: request.due_date,
			quantity: 1,
			unit_amount: amount,
			total_amount: amount,
			tax_amount: 0,
			final_amount: amount,
			// What is still owed on the bill. The column defaults to 0, and a bill
			// left at 0 reads as nothing outstanding — MyJKKN showed the first
			// library fine as fully paid the moment it was raised. A new bill owes
			// all of itself.
			balance_amount: amount,
			status: 'unpaid',
			fee_source: 'academic',
			remarks: key,
		})
		.select('id')
		.single()

	if (error || !bill) {
		console.error('[billing] Could not raise a library fine bill:', error?.message)
		throw new Error('MyJKKN would not accept the bill — nothing was charged')
	}

	return { bill_id: String(bill.id), idempotency_key: key }
}

export interface BillState {
	status: string
	payment_date: string | null
	final_amount: number
	balance_amount: number
}

/**
 * What MyJKKN says about bills the library raised.
 *
 * Read, never written. An unreachable MyJKKN gives an empty map, and every
 * fine simply stays as the library last knew it.
 */
export async function billStates(billIds: string[]): Promise<Map<string, BillState>> {
	const wanted = [...new Set(billIds.filter(Boolean))]
	if (wanted.length === 0) return new Map()

	const billing = getBilling()
	if (!billing) return new Map()

	const { data, error } = await billing
		.from('billing_student_bills')
		.select('id, status, payment_date, final_amount, balance_amount')
		.in('id', wanted)

	if (error) {
		console.error('[billing] Could not read the bills back:', error.message)
		return new Map()
	}

	return new Map(
		(data ?? []).map(row => [
			String(row.id),
			{
				status: String(row.status ?? ''),
				payment_date: (row.payment_date as string | null) ?? null,
				final_amount: Number(row.final_amount ?? 0),
				balance_amount: Number(row.balance_amount ?? 0),
			},
		])
	)
}

/** A bill MyJKKN counts as settled: paid, or nothing left owing on it. */
export const isBillPaid = (state: BillState | undefined): boolean =>
	!!state && (state.status === 'paid' || (state.status === 'partially_paid' && state.balance_amount <= 0))

/** The columns this file needs off one of our own charge rows. */
export interface BilledChargeRow {
	id: string
	member_id?: string | null
	payment_status: string
	billing_student_bill_id?: string | null
	total_charge?: number | string | null
}

/**
 * Brings fines that were billed in MyJKKN up to date with what MyJKKN says.
 *
 * The learner pays under My Bills and MyJKKN marks the bill paid; nothing
 * reaches this database on its own. So every screen that shows a billed fine
 * asks here first, and a bill that has been paid is written back as paid on
 * our side too — which is what the desk's "clear the fine before the book
 * moves" check reads, and what the Late Charges page shows.
 *
 * Cheap and quiet: it does nothing at all unless some fine on the screen is
 * both billed and still unpaid here, it never writes anything back to MyJKKN,
 * and an unreachable MyJKKN leaves every fine exactly as it was.
 *
 * Returns the ids it changed, so a caller holding rows in hand can patch them
 * rather than reading them again.
 */
export async function syncBilledCharges(
	supabase: LibraryDb,
	charges: BilledChargeRow[]
): Promise<Set<string>> {
	const waiting = charges.filter(
		charge => charge.billing_student_bill_id && charge.payment_status !== 'paid' && charge.payment_status !== 'waived'
	)
	if (waiting.length === 0) return new Set()

	const states = await billStates(waiting.map(charge => String(charge.billing_student_bill_id)))
	const paid = waiting.filter(charge => isBillPaid(states.get(String(charge.billing_student_bill_id))))
	if (paid.length === 0) return new Set()

	const changed = new Set<string>()
	for (const charge of paid) {
		const state = states.get(String(charge.billing_student_bill_id))
		const { error } = await supabase
			.from('lib_late_charges')
			.update({
				payment_status: 'paid',
				net_payable: 0,
				payment_date: state?.payment_date?.slice(0, 10) ?? new Date().toISOString().split('T')[0],
				updated_at: new Date().toISOString(),
			})
			.eq('id', charge.id)
		if (error) {
			console.error('[billing] Could not mark a billed fine as paid:', error.message)
			continue
		}
		changed.add(charge.id)
	}

	return changed
}

/**
 * Brings every billed fine in one college, or for one member, up to date.
 *
 * The screens that show fines call this before they read, so what they show is
 * what MyJKKN says. It costs nothing until there is something to do: no
 * billing category means no bills, and it returns before asking the database
 * anything. A database where the billing migration has not been run answers
 * 42703 and is treated the same way.
 */
export async function syncBilledForScope(
	supabase: LibraryDb,
	scope: { institutionId?: string | null; memberId?: string | null }
): Promise<Set<string>> {
	if (!(await billingReady())) return new Set()

	let query = supabase
		.from('lib_late_charges')
		.select('id, member_id, payment_status, billing_student_bill_id, total_charge')
		.not('billing_student_bill_id', 'is', null)
		.in('payment_status', ['unpaid', 'partial'])
		.limit(500)

	if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)
	if (scope.memberId) query = query.eq('member_id', scope.memberId)

	const { data, error } = await query
	// 42703: the billing columns are not there yet. Nothing to sync, and nothing
	// is wrong — the migration simply has not been run.
	if (error) return new Set()

	return syncBilledCharges(supabase, (data ?? []) as BilledChargeRow[])
}

/**
 * The fines in this scope that are already sitting on a MyJKKN bill.
 *
 * The Late Charges page asks so it can show them as billed rather than offer
 * to bill them again. Tolerant in the same way as everything else here: no
 * billing columns yet, or no billing at all, and the answer is simply none.
 */
export async function billedChargeIds(
	supabase: LibraryDb,
	scope: { institutionId?: string | null; memberId?: string | null }
): Promise<Set<string>> {
	let query = supabase
		.from('lib_late_charges')
		.select('id')
		.not('billing_student_bill_id', 'is', null)
		.limit(2000)

	if (scope.institutionId) query = query.eq('institution_id', scope.institutionId)
	if (scope.memberId) query = query.eq('member_id', scope.memberId)

	const { data, error } = await query
	if (error) return new Set()
	return new Set((data ?? []).map(row => String(row.id)))
}
