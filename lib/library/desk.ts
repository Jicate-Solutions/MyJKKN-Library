/**
 * What the circulation desk works with, named once.
 *
 * The desk page, the search box beside its scanner, the line that says what
 * just happened and the strip of today's work all read the same member, the
 * same loan and the same event. Kept here so none of them keeps a private copy
 * that drifts from the others.
 */

import type { LibItem, LibMemberCategory } from '@/types/lib'

/** One book currently in a member's hands, as the desk lookup returns it. */
export interface MemberLoan {
	id: string
	item_id: string | null
	accession_number: string | null
	title: string
	call_number: string | null
	issued_at: string
	due_date: string
	renewal_count: number
	renewal_limit: number
	can_renew: boolean
	is_overdue: boolean
	overdue_days: number
	estimated_charge: number
}

/** A title this member is waiting for, still live. */
export interface MemberHold {
	id: string
	catalogue_record_id: string
	hold_status: 'pending' | 'available'
	hold_placed_at: string
	hold_expires_at: string | null
	notified_at: string | null
	title: string
	call_number: string | null
}

/** A late charge with money still on it — unpaid, or part paid. */
export interface MemberCharge {
	id: string
	overdue_days: number
	charge_per_day: number
	total_charge: number
	waiver_amount: number
	net_payable: number
	payment_status: 'unpaid' | 'partial' | 'paid' | 'waived'
	created_at: string
	due_date: string | null
	returned_at: string | null
	accession_number: string | null
	title: string
}

/**
 * Who the desk lookup found.
 *
 * A member is an Active learner or staff member in MyJKKN, so the identity
 * that matters is `myjkkn_id` — `id` is the borrower row, and that is null
 * until this person takes their first book. Issuing is therefore made against
 * MyJKKN's id, and the borrower row is created by the issue itself.
 */
export interface DeskMember {
	id: string | null
	myjkkn_id: string
	person_kind: 'learner' | 'facilitator'
	member_number: string
	member_category: LibMemberCategory
	display_name: string
	email: string | null
	phone: string | null
	photo_url: string | null
	role_label: string
	is_delinquent: boolean
	has_borrowed: boolean
	items_on_loan?: number
	max_items_allowed?: number | null
	outstanding_charges?: number
	category_name?: string
	loans?: MemberLoan[]
	holds?: MemberHold[]
	charges?: MemberCharge[]
}

/**
 * A copy as the desk lookup returns it.
 *
 * The route aliases the joined catalogue record as `catalogue`, and answers up
 * front whether this copy may go out at all — a reference-only book or one
 * already on loan is refused here, not after the librarian presses Confirm.
 */
export interface DeskItem extends LibItem {
	catalogue?: { id?: string; title?: string; subtitle?: string; call_number?: string } | null
	can_issue?: boolean
	refusal?: string | null
}

export const itemTitle = (item: DeskItem) =>
	item.catalogue?.title ?? item.catalogue_record?.title ?? item.accession_number ?? 'Unknown title'

export const rupees = (amount: number) =>
	`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

export const asDate = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const asTime = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'

export const messageOf = (err: unknown, fallback: string) =>
	err instanceof Error && err.message ? err.message : fallback

// ── What happened at the desk ────────────────────────────────────────────────

export type DeskEventKind = 'issue' | 'return' | 'renew'

/**
 * One thing done at the counter: a book went out, came back, or was renewed.
 *
 * Built from the reply of the action that did it, so the line that says what
 * just happened and the strip of today's work cost no further request. The
 * same shape comes back from the `recent` route for what was done before this
 * page was opened; `key` is derived the same way on both sides so the two
 * lists merge without repeating a line.
 */
export interface DeskEvent {
	key: string
	kind: DeskEventKind
	/** When it happened, ISO. */
	at: string
	transaction_id: string
	title: string
	accession_number: string | null
	member_name: string
	member_number: string | null
	/** The due date after an issue or a renewal; the date it had been due on a return. */
	due_date: string | null
	/** Renew only — what the due date was before, which is what an undo restores. */
	previous_due_date?: string | null
	/** Return only — how late it came back. */
	late_days?: number
	/** Return only — the charge the return raised, if it raised one. */
	charge?: MemberCharge | null
	/** Set on events made at this desk in this sitting: until when they can be taken back. */
	undoable_until?: number
	undone?: boolean
}

/**
 * How long the desk offers to take an action back.
 *
 * Long enough to notice the wrong book was scanned for the learner still
 * standing there; short enough that a loan is not quietly unmade after they
 * have walked off with it. The server allows a little more than this so a
 * click at the last second is not refused for the time the request took.
 */
export const UNDO_WINDOW_MS = 2 * 60 * 1000

export const eventKey = (kind: DeskEventKind, transactionId: string, at: string) =>
	`${kind}:${transactionId}:${at}`

export const canUndo = (event: DeskEvent, now = Date.now()) =>
	!event.undone && event.undoable_until !== undefined && event.undoable_until > now

/** The line the desk prints for an event, in words a librarian would use. */
export function describeEvent(event: DeskEvent): string {
	switch (event.kind) {
		case 'issue':
			return `Issued to ${event.member_name}${event.due_date ? ` — due ${asDate(event.due_date)}` : ''}`
		case 'return': {
			const late = event.late_days && event.late_days > 0
				? ` — ${event.late_days} day${event.late_days === 1 ? '' : 's'} late`
				: ' — on time'
			const owed = event.charge && event.charge.net_payable > 0 && (event.charge.payment_status === 'unpaid' || event.charge.payment_status === 'partial')
				? `, ${rupees(event.charge.net_payable)} to collect`
				: event.charge?.payment_status === 'paid'
					? `, ${rupees(event.charge.total_charge)} collected`
					: event.charge?.payment_status === 'waived'
						? ', charge waived'
						: ''
			return `Returned by ${event.member_name}${late}${owed}`
		}
		case 'renew':
			return `Renewed for ${event.member_name}${event.due_date ? ` — now due ${asDate(event.due_date)}` : ''}`
	}
}

/** What an undo puts back, said before the librarian presses it. */
export function describeUndo(event: DeskEvent): string {
	switch (event.kind) {
		case 'issue': return 'Take the issue back — the book goes back on the shelf as if never lent'
		case 'return': return 'Take the return back — the book goes back to the member, and any charge it raised is removed'
		case 'renew': return 'Take the renewal back — the old due date returns'
	}
}

// ── Desk preferences, kept in this browser ───────────────────────────────────

const CONFIRM_ON_SCAN_KEY = 'lib:desk:confirm-on-scan'

export function readConfirmOnScan(): boolean {
	try {
		return window.localStorage.getItem(CONFIRM_ON_SCAN_KEY) === '1'
	} catch {
		return false
	}
}

export function writeConfirmOnScan(on: boolean): void {
	try {
		window.localStorage.setItem(CONFIRM_ON_SCAN_KEY, on ? '1' : '0')
	} catch {
		// A browser that refuses storage still gets the switch for this visit
	}
}
