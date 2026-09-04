'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { BarcodeScannerInput } from '@/components/library/barcode-scanner-input'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DeskMemberSearch } from '@/components/library/desk-member-search'
import { DeskLastResult } from '@/components/library/desk-last-result'
import { DeskTodayStrip } from '@/components/library/desk-today-strip'
import { SettleChargeDialog, type SettleMode, type SettleRequest } from '@/components/library/settle-charge-dialog'
import {
	CheckCircle, RefreshCw, RotateCcw, BookOpen, AlertTriangle, ArrowRightLeft, Loader2, UserPlus,
	Bookmark, IndianRupee, X, Volume2, VolumeX, Info,
} from 'lucide-react'
import {
	issueItem, returnItem, renewItem, cancelHold, undoDeskAction, fetchRecentDeskEvents,
} from '@/services/library/lib-circulation-service'
import {
	asDate, itemTitle, rupees, messageOf, eventKey, canUndo, readConfirmOnScan, writeConfirmOnScan,
	UNDO_WINDOW_MS,
	type DeskEvent, type DeskItem, type DeskMember, type MemberCharge, type MemberHold, type MemberLoan,
} from '@/lib/library/desk'
import { deskBeep, deskBuzz, isDeskMuted, setDeskMuted } from '@/lib/library/desk-sounds'
import type { LibLendingTransaction, LibItem, LibLateCharge } from '@/types/lib'

// ─── What the tabs share ──────────────────────────────────────────────────────

type TabName = 'issue' | 'return' | 'renew'

/** What Enter and Esc do on the tab in front of the librarian right now. */
interface KeyHandlers {
	confirm?: () => void
	cancel?: () => void
}

/**
 * A code scanned into the wrong box, sent to the right one.
 *
 * `nonce` changes on every hand-over so the same code scanned twice is acted
 * on twice — a plain string would look unchanged to the effect that reads it.
 */
interface Handoff {
	code: string
	nonce: number
}

/** What every tab is given by the page around it. */
interface DeskShared {
	institutionId: string | null
	active: boolean
	confirmOnScan: boolean
	/** Something was done: a line for the strip and the result line, and a beep. */
	onEvent: (event: DeskEvent) => void
	/** The code belongs to another tab — a card in the book box, a book in the card box. */
	redirect: (code: string, guess: 'member' | 'item' | 'loan') => void
	setKeys: (tab: TabName, handlers: KeyHandlers | null) => void
	/** The last action taken back anywhere on the desk, so a tab can drop its line. */
	lastUndone: DeskEvent | null
	/** Moves on whenever a charge is settled from the result line, so an open member card re-reads what is owed. */
	resyncNonce: number
}

/**
 * The book on an open loan, as the desk lookup returns it.
 *
 * That route flattens the copy to an id, an accession number and a title, so
 * reading it as a joined catalogue record found nothing and the card fell back
 * to printing the raw item id at the librarian.
 */
const loanItemTitle = (tx: LibLendingTransaction) => {
	const item = tx.item as (LibItem & { title?: string | null }) | undefined
	return item?.title ?? item?.catalogue_record?.title ?? item?.accession_number ?? tx.item_id
}

const loanAccession = (tx: LibLendingTransaction) =>
	(tx.item as (LibItem & { accession_number?: string }) | undefined)?.accession_number ?? null

/** The lookup calls what is owed `estimated_charge`; a stored row calls it `late_charge_amount`. */
const loanLateCharge = (tx: LibLendingTransaction) => {
	const withEstimate = tx as LibLendingTransaction & { estimated_charge?: number }
	return withEstimate.estimated_charge ?? tx.late_charge_amount ?? 0
}

/** A charge as the return route stores it, in the shape the desk settles. */
function chargeFromRow(
	row: LibLateCharge,
	about: { title: string; accession_number: string | null; due_date: string | null; returned_at: string | null }
): MemberCharge {
	return {
		id: row.id,
		overdue_days: row.overdue_days ?? 0,
		charge_per_day: Number(row.charge_per_day ?? 0),
		total_charge: Number(row.total_charge ?? 0),
		waiver_amount: Number(row.waiver_amount ?? 0),
		net_payable: Number(row.net_payable ?? 0),
		payment_status: row.payment_status,
		created_at: row.created_at,
		due_date: about.due_date,
		returned_at: about.returned_at,
		accession_number: about.accession_number,
		title: about.title,
	}
}

/** True while a dialog is open — Enter and Esc belong to it, not the desk. */
const dialogIsOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]')

/**
 * True when the key press is somebody typing, not somebody at the desk.
 *
 * An empty scan box is the desk: Enter there confirms. A box with text in it
 * is a code or a name being typed, and Enter belongs to it. A focused button
 * fires its own click on Enter, and must not be confirmed twice.
 */
function keyBelongsToField(target: EventTarget | null, key: string): boolean {
	const el = target as HTMLElement | null
	if (!el) return false
	const tag = el.tagName
	if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
	if (tag === 'INPUT') return (el as HTMLInputElement).value.trim().length > 0
	if (key === 'Enter' && (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'tab')) return true
	return false
}

/**
 * What the desk is doing right now, said on the page itself.
 *
 * A toast is easy to miss and gone in seconds, so a scan used to look like
 * nothing had happened at all — no wait, no result, no reason. This sits under
 * the box it belongs to and stays until the next scan replaces it.
 */
function ScanFeedback({
	busy,
	code,
	error,
	info,
}: {
	busy: boolean
	code: string | null
	error: string | null
	info?: string | null
}) {
	if (busy) {
		return (
			<p className="mt-2 flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-400">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				Checking {code ? <span className="font-mono">{code}</span> : 'that'}…
			</p>
		)
	}
	if (error) {
		return (
			<div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
				<AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
				<span>
					{error}
					{code ? <> — scanned <span className="font-mono">{code}</span></> : null}
				</span>
			</div>
		)
	}
	if (info) {
		return (
			<div className="mt-2 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
				<Info className="mt-px h-3.5 w-3.5 shrink-0" />
				<span>{info}</span>
			</div>
		)
	}
	return null
}

/**
 * The books a member is holding, with the two actions the desk needs on each.
 *
 * This is the first question asked at the counter — "what have I got out, and
 * when is it due" — so it belongs beside the member, not behind another search.
 */
function MemberLoansPanel({
	loans,
	maxItems,
	institutionId,
	member,
	onChanged,
	onEvent,
}: {
	loans: MemberLoan[]
	maxItems?: number | null
	institutionId: string | null
	member: DeskMember
	onChanged: () => void
	onEvent: (event: DeskEvent) => void
}) {
	const { toast } = useToast()
	const [busyId, setBusyId] = useState<string | null>(null)

	const act = async (loan: MemberLoan, action: 'return' | 'renew') => {
		try {
			setBusyId(loan.id)
			if (action === 'return') {
				const result = await returnItem({ transaction_id: loan.id, institution_id: institutionId ?? '' })
				const returnedAt = result.transaction?.returned_at ?? new Date().toISOString()
				onEvent({
					key: eventKey('return', loan.id, returnedAt),
					kind: 'return',
					at: returnedAt,
					transaction_id: loan.id,
					title: loan.title,
					accession_number: loan.accession_number,
					member_name: member.display_name,
					member_number: member.member_number,
					due_date: loan.due_date,
					late_days: result.overdue_days ?? 0,
					charge: result.late_charge
						? chargeFromRow(result.late_charge, { title: loan.title, accession_number: loan.accession_number, due_date: loan.due_date, returned_at: returnedAt })
						: null,
					undoable_until: Date.now() + UNDO_WINDOW_MS,
				})
			} else {
				const result = await renewItem({ transaction_id: loan.id, institution_id: institutionId ?? '' })
				const renewedAt = result.transaction?.last_renewed_at ?? new Date().toISOString()
				onEvent({
					key: eventKey('renew', loan.id, renewedAt),
					kind: 'renew',
					at: renewedAt,
					transaction_id: loan.id,
					title: loan.title,
					accession_number: loan.accession_number,
					member_name: member.display_name,
					member_number: member.member_number,
					due_date: result.new_due_date ?? result.transaction?.due_date ?? null,
					previous_due_date: result.previous_due_date ?? loan.due_date,
					undoable_until: Date.now() + UNDO_WINDOW_MS,
				})
			}
			onChanged()
		} catch (err) {
			deskBuzz()
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Action failed'),
				variant: 'destructive',
			})
		} finally {
			setBusyId(null)
		}
	}

	if (loans.length === 0) {
		return (
			<div className="rounded-md border border-dashed px-4 py-6 text-center">
				<BookOpen className="mx-auto h-6 w-6 text-muted-foreground/40" />
				<p className="mt-1 text-sm text-muted-foreground">No books with this member right now</p>
			</div>
		)
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
					Books with this member
				</p>
				<span className="text-xs text-muted-foreground">
					{loans.length}{maxItems ? ` of ${maxItems}` : ''} out
				</span>
			</div>

			<div className="divide-y rounded-md border">
				{loans.map(loan => (
					<div key={loan.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{loan.title}</p>
							<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								{loan.accession_number && <span className="font-mono">{loan.accession_number}</span>}
								<span>Taken {asDate(loan.issued_at)}</span>
								<span className={loan.is_overdue ? 'font-medium text-destructive' : ''}>
									Due {asDate(loan.due_date)}
								</span>
								{loan.renewal_limit > 0 && (
									<span>Renewed {loan.renewal_count} of {loan.renewal_limit}</span>
								)}
							</div>
						</div>

						{loan.is_overdue && (
							<Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-xs text-destructive">
								<AlertTriangle className="mr-1 h-3 w-3" />
								{loan.overdue_days} day{loan.overdue_days === 1 ? '' : 's'} late
								{loan.estimated_charge > 0 ? ` · ₹${loan.estimated_charge}` : ''}
							</Badge>
						)}

						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								className="h-8 text-xs"
								disabled={busyId === loan.id || !loan.can_renew}
								title={loan.can_renew ? 'Extend the due date' : 'Renewal limit reached'}
								onClick={() => act(loan, 'renew')}
							>
								{busyId === loan.id
									? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
									: <RotateCcw className="mr-1 h-3 w-3" />}
								Renew
							</Button>
							<Button
								size="sm"
								className="h-8 text-xs"
								disabled={busyId === loan.id}
								onClick={() => act(loan, 'return')}
							>
								{busyId === loan.id
									? <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
									: <CheckCircle className="mr-1 h-3 w-3" />}
								Return
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

/**
 * What this member is waiting for, and the one action the desk has on it.
 *
 * A hold lives on its own page, but the question "am I still in the queue for
 * that book?" is asked at the counter with the card already in hand — so it is
 * answered here, and can be dropped here, rather than sending the librarian to
 * another screen with a member number written on a slip.
 *
 * Nothing is drawn when there are none: an empty section on every scan is
 * noise at a desk that is read at a glance.
 */
function MemberHoldsPanel({ holds, onChanged }: { holds: MemberHold[]; onChanged: () => void }) {
	const { toast } = useToast()
	const [busyId, setBusyId] = useState<string | null>(null)

	if (holds.length === 0) return null

	const drop = async (hold: MemberHold) => {
		try {
			setBusyId(hold.id)
			await cancelHold(hold.id, 'Cancelled at the desk')
			deskBeep()
			toast({
				title: `✅ Hold cancelled — ${hold.title}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			onChanged()
		} catch (err) {
			deskBuzz()
			toast({ title: '❌ ' + messageOf(err, 'Could not cancel the hold'), variant: 'destructive' })
		} finally {
			setBusyId(null)
		}
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
					Waiting for
				</p>
				<span className="text-xs text-muted-foreground">{holds.length} on hold</span>
			</div>

			<div className="divide-y rounded-md border">
				{holds.map(hold => (
					<div key={hold.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{hold.title}</p>
							<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								{hold.call_number && <span className="font-mono">{hold.call_number}</span>}
								<span>Since {asDate(hold.hold_placed_at)}</span>
								{hold.hold_expires_at && <span>Held until {asDate(hold.hold_expires_at)}</span>}
							</div>
						</div>

						{hold.hold_status === 'available' ? (
							<Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
								<Bookmark className="mr-1 h-3 w-3" />
								Ready to collect
							</Badge>
						) : (
							<Badge variant="outline" className="text-xs">In the queue</Badge>
						)}

						<Button
							size="sm"
							variant="outline"
							className="h-8 text-xs"
							disabled={busyId === hold.id}
							title="Take this member out of the queue"
							onClick={() => drop(hold)}
						>
							{busyId === hold.id
								? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
								: <X className="mr-1 h-3 w-3" />}
							Cancel
						</Button>
					</div>
				))}
			</div>
		</div>
	)
}

/**
 * What this member owes, settled where they are standing.
 *
 * The dialog that records the payment or the waiver is the one the result
 * line uses after a late return — one form, one set of rules, wherever the
 * fine is met.
 */
function MemberChargesPanel({ charges, onChanged }: { charges: MemberCharge[]; onChanged: () => void }) {
	const { toast } = useToast()
	const [settling, setSettling] = useState<SettleRequest | null>(null)

	if (charges.length === 0) return null

	const owed = charges.reduce((sum, charge) => sum + charge.net_payable, 0)

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
					Owing
				</p>
				<span className="text-xs font-medium text-destructive">{rupees(owed)} on {charges.length} {charges.length === 1 ? 'charge' : 'charges'}</span>
			</div>

			<div className="divide-y rounded-md border">
				{charges.map(charge => (
					<div key={charge.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{charge.title}</p>
							<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								{charge.accession_number && <span className="font-mono">{charge.accession_number}</span>}
								{charge.due_date && <span>Was due {asDate(charge.due_date)}</span>}
								{charge.overdue_days > 0 && (
									<span>{charge.overdue_days} day{charge.overdue_days === 1 ? '' : 's'} late</span>
								)}
								{charge.waiver_amount > 0 && <span>{rupees(charge.waiver_amount)} already let off</span>}
							</div>
						</div>

						<Badge
							variant="outline"
							className="border-destructive/30 bg-destructive/10 text-xs text-destructive"
						>
							{rupees(charge.net_payable)}
							{charge.payment_status === 'partial' ? ` of ${rupees(charge.total_charge)}` : ''}
						</Badge>

						<div className="flex items-center gap-2">
							<Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSettling({ charge, mode: 'waive' })}>
								Waive
							</Button>
							<Button size="sm" className="h-8 text-xs" onClick={() => setSettling({ charge, mode: 'collect' })}>
								<IndianRupee className="mr-1 h-3 w-3" />
								Collect
							</Button>
						</div>
					</div>
				))}
			</div>

			<SettleChargeDialog
				settling={settling}
				onClose={() => setSettling(null)}
				onSettled={(_saved, request) => {
					deskBeep()
					toast({
						title: request.mode === 'collect'
							? `✅ ${rupees(request.charge.net_payable)} collected`
							: '✅ Charge waived',
						description: request.charge.title,
						className: 'bg-green-50 border-green-200 text-green-800',
					})
					setSettling(null)
					onChanged()
				}}
			/>
		</div>
	)
}

// ─── Issue Tab ────────────────────────────────────────────────────────────────

/** One book handed over in this sitting, kept on screen as the pile grows. */
interface IssuedLine {
	key: string
	title: string
	accession_number: string
	due_date: string | null
}

function IssueTab({
	shared,
	memberHandoff,
	itemHandoff,
}: {
	shared: DeskShared
	memberHandoff: Handoff | null
	itemHandoff: Handoff | null
}) {
	const { institutionId, active, confirmOnScan, onEvent, redirect, setKeys, lastUndone, resyncNonce } = shared
	const { toast } = useToast()
	// The desk lookup returns more than the stored row: the MyJKKN photo and
	// what the member currently has out, so the librarian can decide at a glance.
	const [member, setMember] = useState<DeskMember | null>(null)
	const [item, setItem] = useState<DeskItem | null>(null)
	// A book scanned before any card. It waits here, and goes out the moment a
	// card is scanned — the order the two arrive in should not matter.
	const [pendingItem, setPendingItem] = useState<DeskItem | null>(null)
	// Books given to this member since their card was scanned. One sitting at
	// the counter is one member and however many books their limit allows.
	const [issued, setIssued] = useState<IssuedLine[]>([])
	// Books in their hands right now. Seeded from the lookup, moved on by each
	// issue and by every return made from the panel below, so the slots left
	// are right without waiting for a round trip.
	const [heldCount, setHeldCount] = useState(0)

	const [memberBusy, setMemberBusy] = useState(false)
	const [memberScan, setMemberScan] = useState<string | null>(null)
	const [memberError, setMemberError] = useState<string | null>(null)
	const [memberInfo, setMemberInfo] = useState<string | null>(null)

	const [itemBusy, setItemBusy] = useState(false)
	const [itemScan, setItemScan] = useState<string | null>(null)
	const [itemError, setItemError] = useState<string | null>(null)
	const [itemInfo, setItemInfo] = useState<string | null>(null)

	const [issuing, setIssuing] = useState(false)

	// Every issue moves this on. A background refresh already in flight when the
	// next book goes out is answering an older question, so its figures are
	// dropped rather than written over newer ones — the refresh that second book
	// starts carries the whole truth a moment later.
	const issueSeq = useRef(0)

	const memberRef = useRef<DeskMember | null>(null)
	memberRef.current = member

	const takeMember = useCallback((data: DeskMember) => {
		issueSeq.current += 1
		setMember(data)
		setHeldCount(data.items_on_loan ?? 0)
	}, [])

	/**
	 * A code that is not a card. A book on loan is a return and goes to that
	 * tab; a book on the shelf waits here for a card; anything else is said.
	 * True when the code was dealt with, false when it was nothing we know.
	 */
	const tryBookInstead = useCallback(async (code: string): Promise<boolean> => {
		const res = await fetch(`/api/lib/items/lookup?barcode=${encodeURIComponent(code)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
		const data = await res.json().catch(() => ({}))
		if (!res.ok) return false

		const found = data as DeskItem
		if (found.status === 'on_loan') {
			redirect(code, 'loan')
			return true
		}
		if (found.refusal) {
			setMemberError(`${itemTitle(found)}: ${found.refusal}`)
			deskBuzz()
			return true
		}
		setPendingItem(found)
		setMemberInfo(`${itemTitle(found)} is ready to go out — scan the member card to issue it. Esc to put it back.`)
		deskBeep()
		return true
	}, [institutionId, redirect])

	// Show the reason the server gave, not a blanket "not found". A broken query
	// and a genuinely unknown card look identical otherwise, and the desk cannot
	// tell whether to re-scan or call for help.
	//
	// `quiet` is the refresh that follows a return or a settled charge: the
	// figures are brought up to date without the scan box going busy under the
	// librarian's hand, because the next book can be scanned while it happens.
	const lookupMember = useCallback(async (barcode: string, quiet = false) => {
		const seq = issueSeq.current
		if (!quiet) {
			setMemberBusy(true)
			setMemberScan(barcode)
			setMemberError(null)
			setMemberInfo(null)
		}
		try {
			const res = await fetch(`/api/lib/members/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) {
				// Not a card. A book scanned into the card box is ordinary — the
				// desk works out which box it should have gone in.
				if (!quiet && res.status === 404 && data.reason === 'no_member' && await tryBookInstead(barcode)) return
				throw new Error(data.error || 'Member not found')
			}
			if (quiet && issueSeq.current !== seq) return
			if (quiet) {
				setMember(data)
				setHeldCount(data.items_on_loan ?? 0)
			} else {
				takeMember(data)
				deskBeep()
			}
		} catch (err) {
			if (!quiet) {
				const message = messageOf(err, 'Member not found')
				setMemberError(message)
				deskBuzz()
				toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
			}
		} finally {
			if (!quiet) setMemberBusy(false)
		}
	}, [institutionId, toast, takeMember, tryBookInstead])

	const refreshMember = useCallback(() => {
		const current = memberRef.current
		if (current) void lookupMember(current.member_number, true)
	}, [lookupMember])

	// A member handed over from the Members page: /circulation?member=<number>.
	// Their card is looked up as if it had just been scanned, once, and the
	// number is taken off the address so a refresh does not scan it again.
	const handedOver = useRef(false)
	useEffect(() => {
		if (handedOver.current || !institutionId) return
		const number = new URLSearchParams(window.location.search).get('member')?.trim()
		if (!number) return
		handedOver.current = true
		window.history.replaceState(null, '', window.location.pathname)
		lookupMember(number)
	}, [institutionId, lookupMember])

	const doIssue = useCallback(async (target: DeskItem) => {
		const current = memberRef.current
		if (!current) return
		const title = itemTitle(target)
		try {
			setIssuing(true)
			setItemError(null)
			// Issued against who they are in MyJKKN, not against a membership
			// row — the first book they take is what creates that row.
			const done = await issueItem({
				myjkkn_id: current.myjkkn_id,
				person_kind: current.person_kind,
				item_id: target.id,
				institution_id: institutionId ?? '',
			})

			const dueDate = done.due_date ?? null
			const transactionId = done.transaction?.id ?? target.id
			const issuedAt = done.transaction?.issued_at ?? new Date().toISOString()

			setIssued(prev => [...prev, {
				key: transactionId,
				title,
				accession_number: target.accession_number,
				due_date: dueDate,
			}])
			issueSeq.current += 1

			// The reply carries the new loan and the new count, so the member
			// card moves on here and now — there is nothing to read again.
			const newLoan = done.loan
			setHeldCount(count => done.items_on_loan ?? count + 1)
			setMember(m => m ? {
				...m,
				items_on_loan: done.items_on_loan ?? (m.items_on_loan ?? 0) + 1,
				loans: newLoan ? [...(m.loans ?? []).filter(l => l.id !== newLoan.id), newLoan] : m.loans,
				holds: done.fulfilled_hold_id ? (m.holds ?? []).filter(h => h.id !== done.fulfilled_hold_id) : m.holds,
			} : m)

			// Straight back to an empty scan box — the next book can go through.
			setItem(null)
			setItemScan(null)
			setItemInfo(null)
			deskBeep()
			onEvent({
				key: eventKey('issue', transactionId, issuedAt),
				kind: 'issue',
				at: issuedAt,
				transaction_id: transactionId,
				title,
				accession_number: target.accession_number,
				member_name: current.display_name,
				member_number: current.member_number,
				due_date: dueDate,
				undoable_until: Date.now() + UNDO_WINDOW_MS,
			})

			// A server that does not yet send the loan back: read the member again
			if (!newLoan) refreshMember()
		} catch (err) {
			const message = messageOf(err, 'Issue failed')
			setItemError(message)
			deskBuzz()
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setIssuing(false)
		}
	}, [institutionId, toast, onEvent, refreshMember])

	/** Everything about this sitting is over; the next card starts a new one. */
	const reset = useCallback(() => {
		issueSeq.current += 1
		setMember(null)
		setItem(null)
		setPendingItem(null)
		setIssued([])
		setHeldCount(0)
		setMemberScan(null)
		setMemberError(null)
		setMemberInfo(null)
		setItemScan(null)
		setItemError(null)
		setItemInfo(null)
	}, [])

	const lookupItem = useCallback(async (barcode: string) => {
		setItemBusy(true)
		setItemScan(barcode)
		setItemError(null)
		setItemInfo(null)
		try {
			const res = await fetch(`/api/lib/items/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) {
				// Not a book. The next member's card, scanned before "Done" was
				// pressed, is the usual reason — so that is what is tried.
				if (res.status === 404 && data.reason === 'no_item') {
					const asMember = await fetch(`/api/lib/members/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
					const person = await asMember.json().catch(() => ({}))
					if (asMember.ok) {
						reset()
						takeMember(person)
						deskBeep()
						return
					}
				}
				throw new Error(data.error || 'Item not found')
			}
			// The lookup already knows whether this copy can leave the building.
			// Saying so now saves the librarian confirming an issue that was
			// never going to be allowed — and a copy that is out is a return,
			// which the Return tab takes from here.
			if (data.refusal) {
				if (data.status === 'on_loan') {
					setItemInfo(`${itemTitle(data)} is out on loan — taking it as a return.`)
					redirect(barcode, 'loan')
					return
				}
				setItemError(data.refusal)
				deskBuzz()
				toast({ title: '❌ ' + data.refusal, description: `Scanned: ${barcode}`, variant: 'destructive' })
				return
			}
			setItem(data)
			if (confirmOnScan) await doIssue(data)
			else deskBeep()
		} catch (err) {
			const message = messageOf(err, 'Item not found')
			setItemError(message)
			deskBuzz()
			toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
		} finally {
			setItemBusy(false)
		}
	}, [institutionId, toast, confirmOnScan, doIssue, redirect, reset, takeMember])

	// A card arrives for a book already waiting: the book goes out now
	useEffect(() => {
		if (!member || !pendingItem) return
		const code = pendingItem.accession_number
		setPendingItem(null)
		setMemberInfo(null)
		void lookupItem(code)
	}, [member, pendingItem, lookupItem])

	// Codes sent here from the other tabs
	useEffect(() => {
		if (!memberHandoff) return
		if (memberRef.current && memberRef.current.member_number !== memberHandoff.code) reset()
		void lookupMember(memberHandoff.code)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [memberHandoff])

	useEffect(() => {
		if (!itemHandoff) return
		if (memberRef.current) void lookupItem(itemHandoff.code)
		else {
			setMemberScan(itemHandoff.code)
			void tryBookInstead(itemHandoff.code).then(handled => {
				if (!handled) setMemberError(`No book or member found for "${itemHandoff.code}"`)
			})
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [itemHandoff])

	// An issue taken back drops off the pile and off the member's list; a
	// return or renewal taken back changes what the member holds, so re-read.
	useEffect(() => {
		if (!lastUndone) return
		if (lastUndone.kind === 'issue') {
			setIssued(prev => prev.filter(line => line.key !== lastUndone.transaction_id))
			if (memberRef.current?.loans?.some(l => l.id === lastUndone.transaction_id)) {
				setHeldCount(c => Math.max(0, c - 1))
				setMember(m => m ? {
					...m,
					loans: (m.loans ?? []).filter(l => l.id !== lastUndone.transaction_id),
					items_on_loan: Math.max(0, (m.items_on_loan ?? 1) - 1),
				} : m)
			}
		} else {
			refreshMember()
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lastUndone])

	// A charge settled from the result line: what the card says is owed is stale
	useEffect(() => {
		if (resyncNonce > 0) refreshMember()
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resyncNonce])

	const cancelItem = () => {
		setItem(null)
		setItemScan(null)
		setItemError(null)
		setItemInfo(null)
	}

	const dropPending = () => {
		setPendingItem(null)
		setMemberInfo(null)
		setMemberScan(null)
	}

	// Enter and Esc, for whatever is in front of the librarian on this tab
	useEffect(() => {
		if (!active) return
		setKeys('issue', {
			confirm: item && !issuing ? () => { void doIssue(item) } : undefined,
			cancel: item ? cancelItem : pendingItem ? dropPending : member ? reset : undefined,
		})
	})

	// The limit is set on the member's category. Where a college has not set
	// one, the figure is unknown here and the issue route still refuses at its
	// own limit — so nothing is invented on screen either way.
	const limit = member?.max_items_allowed ?? null
	const atLimit = limit != null && heldCount >= limit

	return (
		<div className="space-y-4">
			{/* Step 1: Member */}
			<Card className={`transition-colors ${!member ? 'border-blue-400 shadow-sm' : 'border-emerald-300'}`}>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<div className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${member ? 'bg-emerald-500 text-white' : 'bg-blue-100 text-blue-700'}`}>
							{member ? '✓' : '1'}
						</div>
						Scan Member Card
						{member && (
							<Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 ml-auto text-xs">
								{member.member_number}
							</Badge>
						)}
					</CardTitle>
				</CardHeader>
				{!member && (
					<CardContent className="pt-0 pb-4 px-4 space-y-2">
						<BarcodeScannerInput
							onScan={code => { void lookupMember(code) }}
							busy={memberBusy}
							placeholder="Scan member card — or a book, the desk works out which…"
						/>
						<ScanFeedback busy={memberBusy} code={memberScan} error={memberError} info={memberInfo} />
						{/* The learner who forgot their card: name or roll number instead */}
						<DeskMemberSearch
							institutionId={institutionId}
							disabled={memberBusy}
							onPick={number => { void lookupMember(number) }}
						/>
					</CardContent>
				)}
				{member && (
					<CardContent className="pt-0 pb-3 px-4">
						{/* The photo is the check that matters: the person at the desk
						    and the person the card belongs to are not always the same. */}
						<div className="flex items-center gap-3 text-sm">
							<Avatar className="h-10 w-10 shrink-0">
								{member.photo_url && <AvatarImage src={member.photo_url} alt={member.display_name ?? ''} />}
								<AvatarFallback className="text-xs bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
									{(member.display_name ?? member.member_number ?? '?').slice(0, 2).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-medium truncate">{member.display_name}</span>
									<MemberCategoryBadge category={member.member_category} />
								</div>
								<div className="text-xs text-muted-foreground">
									{member.member_number}
									{limit != null ? ` · ${heldCount} of ${limit} books out` : ` · ${heldCount} books out`}
									{member.outstanding_charges ? ` · ₹${member.outstanding_charges} due` : ''}
								</div>
							</div>
						</div>

						{/* Everything the counter is asked about, on the one card: what
						    they are holding, what they are waiting for, what they owe —
						    each with the action that settles it, so the librarian never
						    leaves this page carrying a member number to another screen */}
						<div className="mt-3 space-y-3 border-t pt-3">
							<MemberLoansPanel
								loans={member.loans ?? []}
								maxItems={limit}
								institutionId={institutionId}
								member={member}
								onChanged={refreshMember}
								onEvent={onEvent}
							/>
							<MemberHoldsPanel
								holds={member.holds ?? []}
								onChanged={refreshMember}
							/>
							<MemberChargesPanel
								charges={member.charges ?? []}
								onChanged={refreshMember}
							/>
						</div>
					</CardContent>
				)}
			</Card>

			{/* Step 2: Item — stays open book after book until the limit is reached */}
			<Card className={`transition-colors ${!member ? 'opacity-60' : atLimit ? 'border-amber-300' : item ? 'border-emerald-300' : 'border-blue-400 shadow-sm'}`}>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<div className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${item ? 'bg-emerald-500 text-white' : member && !atLimit ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>
							{item ? '✓' : '2'}
						</div>
						Scan Item Barcode
						{limit != null && member && (
							<span className="ml-auto text-xs font-normal text-muted-foreground">
								{Math.max(limit - heldCount, 0)} of {limit} left
							</span>
						)}
					</CardTitle>
				</CardHeader>

				{member && atLimit && (
					<CardContent className="pt-0 pb-4 px-4">
						<div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
							<AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
							<span>
								Borrowing limit reached — {heldCount} of {limit} books out. Return one above
								before taking another.
							</span>
						</div>
					</CardContent>
				)}

				{member && !atLimit && !item && (
					<CardContent className="pt-0 pb-4 px-4">
						<BarcodeScannerInput
							onScan={code => { void lookupItem(code) }}
							busy={itemBusy || issuing}
							placeholder={confirmOnScan ? 'Scan item barcode — it goes out on the scan…' : 'Scan item barcode…'}
						/>
						<ScanFeedback busy={itemBusy || issuing} code={itemScan} error={itemError} info={itemInfo} />
					</CardContent>
				)}

				{member && item && (
					<CardContent className="pt-0 pb-4 px-4 space-y-3">
						<div className="text-sm">
							<p className="font-medium">{itemTitle(item)}</p>
							<div className="flex items-center gap-2 mt-1">
								<span className="text-muted-foreground text-xs font-mono">Acc. {item.accession_number}</span>
								<ResourceStatusBadge status={item.status} />
							</div>
						</div>
						{itemError && <ScanFeedback busy={false} code={null} error={itemError} />}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={cancelItem} disabled={issuing}>
								Cancel <kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground sm:inline">Esc</kbd>
							</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={() => { void doIssue(item) }} disabled={issuing}>
								{issuing ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Issuing…</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Issue <kbd className="ml-2 hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">Enter</kbd></>
								)}
							</Button>
						</div>
					</CardContent>
				)}
			</Card>

			{/* What has gone out in this sitting — in place of a screen that had to
			    be dismissed before the next book could be scanned */}
			{issued.length > 0 && (
				<Card className="border-emerald-300 bg-emerald-50/40 dark:bg-emerald-900/10">
					<CardHeader className="py-3 px-4">
						<CardTitle className="text-sm flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
							<CheckCircle className="h-4 w-4" />
							Issued now — {issued.length} book{issued.length === 1 ? '' : 's'}
						</CardTitle>
					</CardHeader>
					<CardContent className="pt-0 pb-4 px-4 space-y-2">
						<div className="divide-y rounded-md border bg-background">
							{issued.map((line, index) => (
								<div key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
									<span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
									<span className="min-w-0 flex-1 truncate font-medium">{line.title}</span>
									<span className="font-mono text-xs text-muted-foreground">{line.accession_number}</span>
									<span className="text-xs text-muted-foreground">Due {asDate(line.due_date)}</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{member && (
				<Button variant="outline" className="h-10 w-full" onClick={reset} disabled={issuing}>
					<UserPlus className="h-4 w-4 mr-2" />
					Done — next member
					<span className="ml-2 text-xs font-normal text-muted-foreground">or just scan the next card</span>
				</Button>
			)}
		</div>
	)
}

// ─── Return and Renew ─────────────────────────────────────────────────────────

/**
 * Finds the open loan behind a scanned book, or sends the code where it
 * belongs: a member card to Issue, a book nobody has out to Issue as well.
 *
 * Shared by the Return and Renew tabs, which differ only in what they do
 * with the loan once it is found.
 */
function useLoanScan(shared: DeskShared) {
	const { institutionId, redirect } = shared
	const { toast } = useToast()
	const [transaction, setTransaction] = useState<LibLendingTransaction | null>(null)
	const [busy, setBusy] = useState(false)
	const [scan, setScan] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [info, setInfo] = useState<string | null>(null)

	// The server says exactly what went wrong — no book of that number, or a
	// copy nobody has out. Both used to arrive as the same flat sentence, which
	// left the desk guessing whether to re-scan or look somewhere else.
	const lookup = useCallback(async (barcode: string): Promise<LibLendingTransaction | null> => {
		setBusy(true)
		setScan(barcode)
		setError(null)
		setInfo(null)
		try {
			const res = await fetch(`/api/lib/circulation/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) {
				if (res.status === 404 && data.reason === 'no_item') {
					// Not a book. A member card scanned here opens their card in
					// Issue, where every book they hold can be returned or renewed.
					const asMember = await fetch(`/api/lib/members/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
					if (asMember.ok) {
						setInfo('That is a member card — opening their card in Issue.')
						redirect(barcode, 'member')
						return null
					}
				}
				if (res.status === 404 && data.reason === 'not_on_loan') {
					// A book nobody has out cannot be returned or renewed, but it
					// can be issued — so it goes to wait for a card there.
					setInfo('Nobody has that copy out — sending it to Issue to wait for a member card.')
					redirect(barcode, 'item')
					return null
				}
				throw new Error(data.error || 'Active loan not found for this item')
			}
			setTransaction(data)
			return data as LibLendingTransaction
		} catch (err) {
			const message = messageOf(err, 'Lookup failed')
			setError(message)
			deskBuzz()
			toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
			return null
		} finally {
			setBusy(false)
		}
	}, [institutionId, toast, redirect])

	const clear = useCallback(() => {
		setTransaction(null)
		setScan(null)
		setError(null)
		setInfo(null)
	}, [])

	return { transaction, busy, scan, error, setError, info, lookup, clear }
}

/** The lines this sitting's returns or renewals make — read off the desk's own record. */
function DoneNowCard({
	kind,
	events,
}: {
	kind: 'return' | 'renew'
	events: DeskEvent[]
}) {
	const lines = events.filter(e => e.kind === kind && e.undoable_until !== undefined && !e.undone)
	if (lines.length === 0) return null

	return (
		<Card className="border-emerald-300 bg-emerald-50/40 dark:bg-emerald-900/10">
			<CardHeader className="py-3 px-4">
				<CardTitle className="text-sm flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
					<CheckCircle className="h-4 w-4" />
					{kind === 'return' ? 'Returned now' : 'Renewed now'} — {lines.length} book{lines.length === 1 ? '' : 's'}
				</CardTitle>
			</CardHeader>
			<CardContent className="pt-0 pb-4 px-4">
				<div className="divide-y rounded-md border bg-background">
					{[...lines].reverse().map((line, index) => {
						const owing = line.charge && line.charge.net_payable > 0
							&& (line.charge.payment_status === 'unpaid' || line.charge.payment_status === 'partial')
						return (
							<div key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
								<span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
								<span className="min-w-0 flex-1 truncate font-medium">{line.title}</span>
								{line.accession_number && <span className="font-mono text-xs text-muted-foreground">{line.accession_number}</span>}
								<span className="truncate text-xs text-muted-foreground">{line.member_name}</span>
								{kind === 'return' ? (
									line.late_days && line.late_days > 0 ? (
										<span className={`text-xs ${owing ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
											{line.late_days}d late
											{line.charge ? ` · ${owing ? `${rupees(line.charge.net_payable)} owing` : line.charge.payment_status === 'paid' ? 'collected' : 'waived'}` : ''}
										</span>
									) : (
										<span className="text-xs text-muted-foreground">on time</span>
									)
								) : (
									<span className="text-xs text-muted-foreground">Due {asDate(line.due_date)}</span>
								)}
							</div>
						)
					})}
				</div>
			</CardContent>
		</Card>
	)
}

function ReturnTab({
	shared,
	loanHandoff,
	events,
}: {
	shared: DeskShared
	loanHandoff: Handoff | null
	events: DeskEvent[]
}) {
	const { institutionId, active, confirmOnScan, onEvent, setKeys } = shared
	const { toast } = useToast()
	const { transaction, busy, scan, error, setError, info, lookup, clear } = useLoanScan(shared)
	const [returning, setReturning] = useState(false)

	const doReturn = useCallback(async (tx: LibLendingTransaction) => {
		const title = loanItemTitle(tx)
		const accession = loanAccession(tx)
		try {
			setReturning(true)
			setError(null)
			const result = await returnItem({ transaction_id: tx.id, institution_id: institutionId ?? '' })
			const returnedAt = result.transaction?.returned_at ?? new Date().toISOString()
			clear()
			deskBeep()
			onEvent({
				key: eventKey('return', tx.id, returnedAt),
				kind: 'return',
				at: returnedAt,
				transaction_id: tx.id,
				title,
				accession_number: accession,
				member_name: tx.member?.display_name ?? 'Unknown member',
				member_number: tx.member?.member_number ?? null,
				due_date: tx.due_date,
				late_days: result.overdue_days ?? 0,
				charge: result.late_charge
					? chargeFromRow(result.late_charge, { title, accession_number: accession, due_date: tx.due_date, returned_at: returnedAt })
					: null,
				undoable_until: Date.now() + UNDO_WINDOW_MS,
			})
		} catch (err) {
			const message = messageOf(err, 'Return failed')
			setError(message)
			deskBuzz()
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setReturning(false)
		}
	}, [institutionId, toast, onEvent, clear, setError])

	const scanBook = useCallback(async (barcode: string) => {
		const found = await lookup(barcode)
		if (!found) return
		if (confirmOnScan) await doReturn(found)
		else deskBeep()
	}, [lookup, confirmOnScan, doReturn])

	// A book on loan scanned into another tab lands here
	useEffect(() => {
		if (!loanHandoff) return
		void scanBook(loanHandoff.code)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loanHandoff])

	useEffect(() => {
		if (!active) return
		setKeys('return', {
			confirm: transaction && !returning ? () => { void doReturn(transaction) } : undefined,
			cancel: transaction ? clear : undefined,
		})
	})

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<RotateCcw className="h-4 w-4 text-muted-foreground" />
						Scan Item to Return
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0 pb-4 px-4">
					<BarcodeScannerInput
						onScan={code => { void scanBook(code) }}
						busy={busy || returning}
						placeholder={confirmOnScan ? 'Scan item barcode — it is returned on the scan…' : 'Scan item barcode to return…'}
					/>
					<ScanFeedback busy={busy || returning} code={scan} error={transaction ? null : error} info={info} />
					<p className="mt-2 text-[11px] text-muted-foreground">
						A member card scanned here opens their card in Issue, with a Return button on every book they hold.
					</p>
				</CardContent>
			</Card>

			{transaction && (
				<Card className="border-amber-300">
					<CardContent className="pt-4 pb-4 px-4 space-y-4">
						<div className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">Member</p>
								<p className="font-medium mt-0.5">{transaction.member?.display_name ?? transaction.member_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Item</p>
								<p className="font-medium mt-0.5 truncate">{loanItemTitle(transaction)}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Issued</p>
								<p className="mt-0.5">{new Date(transaction.issued_at).toLocaleDateString('en-IN')}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Due Date</p>
								<p className={`mt-0.5 ${(transaction.overdue_days ?? 0) > 0 ? 'text-red-600 font-medium' : ''}`}>
									{new Date(transaction.due_date).toLocaleDateString('en-IN')}
								</p>
							</div>
						</div>
						{/* `days && days > 0 && …` printed a bare 0 on every book that was
						    not late: the first term short-circuits to the number itself,
						    and React draws a 0 where it draws nothing for false. */}
						{(transaction.overdue_days ?? 0) > 0 && (
							<div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-red-700 text-sm">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>
									{transaction.overdue_days} day{transaction.overdue_days === 1 ? '' : 's'} overdue
									{' — '}Charge: ₹{loanLateCharge(transaction).toFixed(2)} — collect or waive it on the line above once returned
								</span>
							</div>
						)}
						{error && <ScanFeedback busy={false} code={null} error={error} />}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={clear} disabled={returning}>
								Cancel <kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground sm:inline">Esc</kbd>
							</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={() => { void doReturn(transaction) }} disabled={returning}>
								{returning ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Returning...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Return <kbd className="ml-2 hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">Enter</kbd></>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			<DoneNowCard kind="return" events={events} />
		</div>
	)
}

function RenewTab({
	shared,
	events,
}: {
	shared: DeskShared
	events: DeskEvent[]
}) {
	const { institutionId, active, confirmOnScan, onEvent, setKeys } = shared
	const { toast } = useToast()
	const { transaction, busy, scan, error, setError, info, lookup, clear } = useLoanScan(shared)
	const [renewing, setRenewing] = useState(false)

	const doRenew = useCallback(async (tx: LibLendingTransaction) => {
		const title = loanItemTitle(tx)
		try {
			setRenewing(true)
			setError(null)
			const result = await renewItem({ transaction_id: tx.id, institution_id: institutionId ?? '' })
			const renewedAt = result.transaction?.last_renewed_at ?? new Date().toISOString()
			clear()
			deskBeep()
			onEvent({
				key: eventKey('renew', tx.id, renewedAt),
				kind: 'renew',
				at: renewedAt,
				transaction_id: tx.id,
				title,
				accession_number: loanAccession(tx),
				member_name: tx.member?.display_name ?? 'Unknown member',
				member_number: tx.member?.member_number ?? null,
				due_date: result.new_due_date ?? result.transaction?.due_date ?? null,
				previous_due_date: result.previous_due_date ?? tx.due_date,
				undoable_until: Date.now() + UNDO_WINDOW_MS,
			})
		} catch (err) {
			const message = messageOf(err, 'Renewal failed')
			setError(message)
			deskBuzz()
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setRenewing(false)
		}
	}, [institutionId, toast, onEvent, clear, setError])

	const scanBook = useCallback(async (barcode: string) => {
		const found = await lookup(barcode)
		if (!found) return
		if (confirmOnScan) await doRenew(found)
		else deskBeep()
	}, [lookup, confirmOnScan, doRenew])

	useEffect(() => {
		if (!active) return
		setKeys('renew', {
			confirm: transaction && !renewing ? () => { void doRenew(transaction) } : undefined,
			cancel: transaction ? clear : undefined,
		})
	})

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<RefreshCw className="h-4 w-4 text-muted-foreground" />
						Scan Item to Renew
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0 pb-4 px-4">
					<BarcodeScannerInput
						onScan={code => { void scanBook(code) }}
						busy={busy || renewing}
						placeholder={confirmOnScan ? 'Scan item barcode — it is renewed on the scan…' : 'Scan item barcode to renew…'}
					/>
					<ScanFeedback busy={busy || renewing} code={scan} error={transaction ? null : error} info={info} />
					<p className="mt-2 text-[11px] text-muted-foreground">
						Renewing several for one member? Scan their card instead — it opens their card in Issue with a Renew button on every book they hold.
					</p>
				</CardContent>
			</Card>

			{transaction && (
				<Card className="border-blue-300">
					<CardContent className="pt-4 pb-4 px-4 space-y-4">
						<div className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">Member</p>
								<p className="font-medium mt-0.5">{transaction.member?.display_name ?? transaction.member_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Item</p>
								<p className="font-medium mt-0.5 truncate">{loanItemTitle(transaction)}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Current Due Date</p>
								<p className="font-medium mt-0.5">{new Date(transaction.due_date).toLocaleDateString('en-IN')}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Renewals Used</p>
								<p className="font-medium mt-0.5">{transaction.renewal_count}</p>
							</div>
						</div>
						{(transaction.overdue_days ?? 0) > 0 && (
							<div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-sm">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>
									Already {transaction.overdue_days} day{transaction.overdue_days === 1 ? '' : 's'} overdue — renewing counts from today, and the late days stand.
								</span>
							</div>
						)}
						{error && <ScanFeedback busy={false} code={null} error={error} />}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={clear} disabled={renewing}>
								Cancel <kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground sm:inline">Esc</kbd>
							</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={() => { void doRenew(transaction) }} disabled={renewing}>
								{renewing ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Renewing...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Renewal <kbd className="ml-2 hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">Enter</kbd></>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			<DoneNowCard kind="renew" events={events} />
		</div>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/** Midnight today, where the librarian is — the start of "today at this desk". */
const startOfToday = () => {
	const day = new Date()
	day.setHours(0, 0, 0, 0)
	return day
}

const TAB_KEYS: Record<string, TabName> = { '1': 'issue', '2': 'return', '3': 'renew', F1: 'issue', F2: 'return', F3: 'renew' }

export default function CirculationPage() {
	const { institutionId } = useInstitutionFilter()
	const { toast } = useToast()

	const [tab, setTab] = useState<TabName>('issue')
	const [confirmOnScan, setConfirmOnScan] = useState(false)
	const [muted, setMuted] = useState(false)

	// The desk's own record of the day: what came from the server when the page
	// opened, and everything done since, newest first.
	const [events, setEvents] = useState<DeskEvent[]>([])
	const [eventsLoading, setEventsLoading] = useState(false)
	const [lastResult, setLastResult] = useState<DeskEvent | null>(null)
	const [undoingKey, setUndoingKey] = useState<string | null>(null)
	const [lastUndone, setLastUndone] = useState<DeskEvent | null>(null)
	const [settling, setSettling] = useState<SettleRequest | null>(null)
	const [resyncNonce, setResyncNonce] = useState(0)

	const [memberHandoff, setMemberHandoff] = useState<Handoff | null>(null)
	const [itemHandoff, setItemHandoff] = useState<Handoff | null>(null)
	const [loanHandoff, setLoanHandoff] = useState<Handoff | null>(null)

	const keysRef = useRef<Record<TabName, KeyHandlers | null>>({ issue: null, return: null, renew: null })
	const tabRef = useRef<TabName>('issue')
	tabRef.current = tab

	// What this browser was last set to
	useEffect(() => {
		setConfirmOnScan(readConfirmOnScan())
		setMuted(isDeskMuted())
	}, [])

	// The college roll into memory before the first card, and today's work
	const loadEvents = useCallback(async () => {
		if (!institutionId) {
			setEvents([])
			return
		}
		setEventsLoading(true)
		try {
			const fetched = await fetchRecentDeskEvents(institutionId, startOfToday(), 50)
			// Lines made at this desk keep their Undo; the server's copy of the
			// same line does not know about it.
			setEvents(prev => {
				const mine = new Map(prev.filter(e => e.undoable_until !== undefined).map(e => [e.key, e]))
				const merged = fetched.map(e => mine.get(e.key) ?? e)
				const seen = new Set(merged.map(e => e.key))
				for (const e of mine.values()) if (!seen.has(e.key)) merged.push(e)
				return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
			})
		} catch {
			// The strip is a convenience; a failed read leaves whatever is there
		} finally {
			setEventsLoading(false)
		}
	}, [institutionId])

	useEffect(() => {
		if (!institutionId) return
		void fetch(`/api/lib/members/warm?institution_id=${institutionId}`).catch(() => {})
		void loadEvents()
	}, [institutionId, loadEvents])

	const onEvent = useCallback((event: DeskEvent) => {
		setEvents(prev => [event, ...prev.filter(e => e.key !== event.key)].slice(0, 200))
		setLastResult(event)
	}, [])

	const redirect = useCallback((code: string, guess: 'member' | 'item' | 'loan') => {
		const handoff = { code, nonce: Date.now() + Math.random() }
		if (guess === 'loan') {
			setTab('return')
			setLoanHandoff(handoff)
		} else {
			setTab('issue')
			if (guess === 'member') setMemberHandoff(handoff)
			else setItemHandoff(handoff)
		}
	}, [])

	const setKeys = useCallback((name: TabName, handlers: KeyHandlers | null) => {
		keysRef.current[name] = handlers
	}, [])

	const undo = useCallback(async (event: DeskEvent) => {
		if (!institutionId || !canUndo(event)) return
		setUndoingKey(event.key)
		try {
			await undoDeskAction({
				institution_id: institutionId,
				transaction_id: event.transaction_id,
				action: event.kind,
				previous_due_date: event.previous_due_date ?? null,
			})
			const undone: DeskEvent = { ...event, undone: true }
			setEvents(prev => prev.map(e => e.key === event.key ? undone : e))
			setLastResult(prev => prev?.key === event.key ? undone : prev)
			setLastUndone(undone)
			deskBeep()
		} catch (err) {
			deskBuzz()
			toast({ title: '❌ ' + messageOf(err, 'Could not take that back'), variant: 'destructive' })
		} finally {
			setUndoingKey(null)
		}
	}, [institutionId, toast])

	const settle = useCallback((charge: MemberCharge, mode: SettleMode) => {
		setSettling({ charge, mode })
	}, [])

	const onSettled = useCallback((saved: LibLateCharge, request: SettleRequest) => {
		const patch = (event: DeskEvent): DeskEvent =>
			event.charge && event.charge.id === saved.id
				? {
					...event,
					charge: {
						...event.charge,
						payment_status: saved.payment_status,
						net_payable: Number(saved.net_payable ?? 0),
						waiver_amount: Number(saved.waiver_amount ?? event.charge.waiver_amount),
					},
				}
				: event
		setEvents(prev => prev.map(patch))
		setLastResult(prev => prev ? patch(prev) : prev)
		setSettling(null)
		setResyncNonce(n => n + 1)
		deskBeep()
		toast({
			title: request.mode === 'collect'
				? `✅ ${rupees(request.charge.net_payable)} collected`
				: '✅ Charge waived',
			description: request.charge.title,
			className: 'bg-green-50 border-green-200 text-green-800',
		})
	}, [toast])

	// The keyboard at the desk: Alt+1/2/3 and F1/F2/F3 switch tabs; Enter
	// confirms and Esc cancels whatever is waiting on the tab in front.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.altKey && !e.ctrlKey && !e.metaKey && TAB_KEYS[e.key]) {
				e.preventDefault()
				setTab(TAB_KEYS[e.key])
				return
			}
			if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'F1' || e.key === 'F2' || e.key === 'F3')) {
				e.preventDefault()
				setTab(TAB_KEYS[e.key])
				return
			}
			if (e.key !== 'Enter' && e.key !== 'Escape') return
			if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
			if (dialogIsOpen()) return
			if (keyBelongsToField(e.target, e.key)) return

			const handlers = keysRef.current[tabRef.current]
			const handler = e.key === 'Enter' ? handlers?.confirm : handlers?.cancel
			if (!handler) return
			e.preventDefault()
			handler()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// Every tab stays mounted so a member scanned in Issue is still there after
	// a return; the scan box on the tab just shown takes the focus back.
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const box = document.querySelector<HTMLInputElement>(
				`[data-desk-tab="${tab}"] input:not([disabled])`
			)
			box?.focus()
		})
		return () => cancelAnimationFrame(frame)
	}, [tab])

	const shared = (name: TabName): DeskShared => ({
		institutionId,
		active: tab === name,
		confirmOnScan,
		onEvent,
		redirect,
		setKeys,
		lastUndone,
		resyncNonce,
	})

	const toggleConfirmOnScan = (on: boolean) => {
		setConfirmOnScan(on)
		writeConfirmOnScan(on)
	}

	const toggleSound = () => {
		const next = !muted
		setMuted(next)
		setDeskMuted(next)
		if (!next) deskBeep()
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Header */}
			<div className="flex-shrink-0">
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
						<ArrowRightLeft className="h-5 w-5 text-blue-600" />
					</div>
					<div className="min-w-0">
						<h1 className="text-base font-semibold">Circulation Desk</h1>
						<p className="text-xs text-muted-foreground">Issue, return, and renew library resources</p>
					</div>

					<div className="ml-auto flex items-center gap-3">
						{/* Scan = done. Off by default; a switch, so a cautious desk can leave it off. */}
						<label
							className="flex cursor-pointer items-center gap-2 text-xs"
							title="On: a scanned book is issued, returned or renewed at once, with Undo for two minutes. Off: the desk asks you to confirm each one."
						>
							<Switch checked={confirmOnScan} onCheckedChange={toggleConfirmOnScan} aria-label="Confirm on scan" />
							<span className="font-medium">Confirm on scan</span>
						</label>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={toggleSound}
							title={muted ? 'Sound is off — turn on the beep' : 'Sound is on — beep on success, buzz on refusal'}
							aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
						>
							{muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4" />}
						</Button>
					</div>
				</div>
			</div>

			{/* Tabs Card */}
			<Card className="flex-1">
				<CardContent className="p-4 sm:p-6">
					{/* 512px was tight once the member card carried loans, holds and
				    charges. 672px is the next step up and almost exactly a third
				    wider; it still centres, and still fits a narrow laptop. */}
					<div className="max-w-2xl mx-auto space-y-4">
						<DeskLastResult
							event={lastResult}
							undoingKey={undoingKey}
							onUndo={event => { void undo(event) }}
							onSettle={settle}
						/>

						<Tabs value={tab} onValueChange={value => setTab(value as TabName)}>
							<TabsList className="w-full grid grid-cols-3 h-9">
								<TabsTrigger value="issue" className="text-sm">
									<BookOpen className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Issue
									<kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground md:inline">Alt+1</kbd>
								</TabsTrigger>
								<TabsTrigger value="return" className="text-sm">
									<RotateCcw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Return
									<kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground md:inline">Alt+2</kbd>
								</TabsTrigger>
								<TabsTrigger value="renew" className="text-sm">
									<RefreshCw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Renew
									<kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground md:inline">Alt+3</kbd>
								</TabsTrigger>
							</TabsList>

							{/* Mounted always, shown one at a time — see the focus effect above */}
							<TabsContent value="issue" forceMount className="mt-5 data-[state=inactive]:hidden" data-desk-tab="issue">
								<IssueTab shared={shared('issue')} memberHandoff={memberHandoff} itemHandoff={itemHandoff} />
							</TabsContent>
							<TabsContent value="return" forceMount className="mt-5 data-[state=inactive]:hidden" data-desk-tab="return">
								<ReturnTab shared={shared('return')} loanHandoff={loanHandoff} events={events} />
							</TabsContent>
							<TabsContent value="renew" forceMount className="mt-5 data-[state=inactive]:hidden" data-desk-tab="renew">
								<RenewTab shared={shared('renew')} events={events} />
							</TabsContent>
						</Tabs>

						<p className="text-[11px] text-muted-foreground">
							<kbd className="rounded border px-1">Enter</kbd> confirms · <kbd className="rounded border px-1">Esc</kbd> cancels · <kbd className="rounded border px-1">Alt+1/2/3</kbd> or <kbd className="rounded border px-1">F1–F3</kbd> switch tabs · a card or a book scanned into any box is sent where it belongs
						</p>

						<DeskTodayStrip
							events={events}
							loading={eventsLoading}
							onRefresh={() => { void loadEvents() }}
							onUndo={event => { void undo(event) }}
							undoingKey={undoingKey}
						/>
					</div>
				</CardContent>
			</Card>

			<SettleChargeDialog
				settling={settling}
				onClose={() => setSettling(null)}
				onSettled={onSettled}
			/>
		</div>
	)
}
