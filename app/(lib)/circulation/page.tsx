'use client'

import { useState, useCallback, useRef } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { BarcodeScannerInput } from '@/components/library/barcode-scanner-input'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
	CheckCircle, RefreshCw, RotateCcw, BookOpen, AlertTriangle, ArrowRightLeft, Loader2, UserPlus,
	Bookmark, IndianRupee, X,
} from 'lucide-react'
import { issueItem, returnItem, renewItem, cancelHold } from '@/services/library/lib-circulation-service'
import { collectPayment, waiveCharge } from '@/services/library/lib-late-charges-service'
import type { LibLendingTransaction, LibMemberCategory, LibItem } from '@/types/lib'

/** One book currently in a member's hands, as the desk lookup returns it. */
interface MemberLoan {
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
interface MemberHold {
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
interface MemberCharge {
	id: string
	overdue_days: number
	charge_per_day: number
	total_charge: number
	waiver_amount: number
	net_payable: number
	payment_status: 'unpaid' | 'partial'
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
interface DeskMember {
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

const rupees = (amount: number) =>
	`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/**
 * A copy as the desk lookup returns it.
 *
 * The route aliases the joined catalogue record as `catalogue`, and answers up
 * front whether this copy may go out at all — a reference-only book or one
 * already on loan is refused here, not after the librarian presses Confirm.
 */
interface DeskItem extends LibItem {
	catalogue?: { id?: string; title?: string; subtitle?: string; call_number?: string } | null
	can_issue?: boolean
	refusal?: string | null
}

const itemTitle = (item: DeskItem) =>
	item.catalogue?.title ?? item.catalogue_record?.title ?? item.accession_number ?? 'Unknown title'

const asDate = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const messageOf = (err: unknown, fallback: string) =>
	err instanceof Error && err.message ? err.message : fallback

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

/** The lookup calls what is owed `estimated_charge`; a stored row calls it `late_charge_amount`. */
const loanLateCharge = (tx: LibLendingTransaction) => {
	const withEstimate = tx as LibLendingTransaction & { estimated_charge?: number }
	return withEstimate.estimated_charge ?? tx.late_charge_amount ?? 0
}

/**
 * What the desk is doing right now, said on the page itself.
 *
 * A toast is easy to miss and gone in seconds, so a scan used to look like
 * nothing had happened at all — no wait, no result, no reason. This sits under
 * the box it belongs to and stays until the next scan replaces it.
 */
function ScanFeedback({ busy, code, error }: { busy: boolean; code: string | null; error: string | null }) {
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
	onChanged,
}: {
	loans: MemberLoan[]
	maxItems?: number | null
	institutionId: string | null
	onChanged: () => void
}) {
	const { toast } = useToast()
	const [busyId, setBusyId] = useState<string | null>(null)

	const act = async (loan: MemberLoan, action: 'return' | 'renew') => {
		try {
			setBusyId(loan.id)
			if (action === 'return') {
				await returnItem({ transaction_id: loan.id, institution_id: institutionId ?? '' })
				toast({
					title: `✅ Returned — ${loan.title}`,
					description: loan.estimated_charge > 0 ? `Late charge ₹${loan.estimated_charge}` : undefined,
					className: 'bg-green-50 border-green-200 text-green-800',
				})
			} else {
				const tx = await renewItem({ transaction_id: loan.id, institution_id: institutionId ?? '' })
				toast({
					title: `✅ Renewed — ${loan.title}`,
					description: tx?.due_date ? `New due date ${asDate(tx.due_date)}` : undefined,
					className: 'bg-green-50 border-green-200 text-green-800',
				})
			}
			onChanged()
		} catch (err) {
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

// ─── Issue Tab ────────────────────────────────────────────────────────────────

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
			toast({
				title: `✅ Hold cancelled — ${hold.title}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			onChanged()
		} catch (err) {
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
 * Collecting needs a reference and waiving needs a reason — both are what the
 * charges page asks for, and neither is invented here, so a fine settled at the
 * desk is recorded exactly as one settled from that page.
 */
function MemberChargesPanel({ charges, onChanged }: { charges: MemberCharge[]; onChanged: () => void }) {
	const { toast } = useToast()
	const [settling, setSettling] = useState<{ charge: MemberCharge; mode: 'collect' | 'waive' } | null>(null)
	const [reference, setReference] = useState('')
	const [reason, setReason] = useState('')
	const [amount, setAmount] = useState('')
	const [saving, setSaving] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	if (charges.length === 0) return null

	const owed = charges.reduce((sum, charge) => sum + charge.net_payable, 0)

	const open = (charge: MemberCharge, mode: 'collect' | 'waive') => {
		setSettling({ charge, mode })
		setReference('')
		setReason('')
		// The whole of what is still owed, which is what is waived most of the
		// time; a librarian letting off only part of it types over this.
		setAmount(String(charge.net_payable))
		setFormError(null)
	}

	const submit = async () => {
		if (!settling) return
		const { charge, mode } = settling

		if (mode === 'collect' && !reference.trim()) {
			setFormError('A receipt or reference number is needed to record the payment')
			return
		}
		if (mode === 'waive' && !reason.trim()) {
			setFormError('Say why the charge is being let off')
			return
		}

		try {
			setSaving(true)
			setFormError(null)
			if (mode === 'collect') {
				await collectPayment(charge.id, { payment_reference: reference.trim() })
				toast({
					title: `✅ ${rupees(charge.net_payable)} collected`,
					description: charge.title,
					className: 'bg-green-50 border-green-200 text-green-800',
				})
			} else {
				const asked = Number(amount)
				await waiveCharge(charge.id, {
					waiver_amount: Number.isFinite(asked) && asked > 0 ? asked : charge.net_payable,
					waiver_reason: reason.trim(),
				})
				toast({
					title: '✅ Charge waived',
					description: charge.title,
					className: 'bg-green-50 border-green-200 text-green-800',
				})
			}
			setSettling(null)
			onChanged()
		} catch (err) {
			setFormError(messageOf(err, 'Could not settle the charge'))
		} finally {
			setSaving(false)
		}
	}

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
							<Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => open(charge, 'waive')}>
								Waive
							</Button>
							<Button size="sm" className="h-8 text-xs" onClick={() => open(charge, 'collect')}>
								<IndianRupee className="mr-1 h-3 w-3" />
								Collect
							</Button>
						</div>
					</div>
				))}
			</div>

			<Dialog open={settling !== null} onOpenChange={o => { if (!o && !saving) setSettling(null) }}>
				<DialogContent className="sm:max-w-[440px]">
					<DialogHeader>
						<DialogTitle>
							{settling?.mode === 'collect' ? 'Collect payment' : 'Waive the charge'}
						</DialogTitle>
						<DialogDescription>
							{settling?.charge.title} — {settling ? rupees(settling.charge.net_payable) : ''} owing
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						{settling?.mode === 'collect' ? (
							<div className="space-y-2">
								<Label htmlFor="charge-reference">Receipt or reference number</Label>
								<Input
									id="charge-reference"
									value={reference}
									onChange={e => setReference(e.target.value)}
									placeholder="e.g. RCPT/2026/0148"
									autoFocus
								/>
							</div>
						) : (
							<>
								<div className="space-y-2">
									<Label htmlFor="charge-amount">How much to let off</Label>
									<Input
										id="charge-amount"
										type="number"
										min="0"
										step="0.01"
										value={amount}
										onChange={e => setAmount(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Less than the full amount leaves the rest still owed.
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="charge-reason">Why</Label>
									<Textarea
										id="charge-reason"
										value={reason}
										onChange={e => setReason(e.target.value)}
										placeholder="e.g. Library was closed for three of those days"
										rows={3}
									/>
								</div>
							</>
						)}

						{formError && <ScanFeedback busy={false} code={null} error={formError} />}
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setSettling(null)} disabled={saving}>Cancel</Button>
						<Button onClick={submit} disabled={saving}>
							{saving
								? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
								: settling?.mode === 'collect' ? 'Record payment' : 'Waive'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

/** One book handed over in this sitting, kept on screen as the pile grows. */
interface IssuedLine {
	key: string
	title: string
	accession_number: string
	due_date: string | null
}

function IssueTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	// The desk lookup returns more than the stored row: the MyJKKN photo and
	// what the member currently has out, so the librarian can decide at a glance.
	const [member, setMember] = useState<DeskMember | null>(null)
	const [item, setItem] = useState<DeskItem | null>(null)
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

	const [itemBusy, setItemBusy] = useState(false)
	const [itemScan, setItemScan] = useState<string | null>(null)
	const [itemError, setItemError] = useState<string | null>(null)

	const [issuing, setIssuing] = useState(false)

	// Every issue moves this on. A background refresh already in flight when the
	// next book goes out is answering an older question, so its figures are
	// dropped rather than written over newer ones — the refresh that second book
	// starts carries the whole truth a moment later.
	const issueSeq = useRef(0)

	// Show the reason the server gave, not a blanket "not found". A broken query
	// and a genuinely unknown card look identical otherwise, and the desk cannot
	// tell whether to re-scan or call for help.
	//
	// `quiet` is the refresh that follows an issue or a return: the figures are
	// brought up to date without the scan box going busy under the librarian's
	// hand, because the next book can be scanned while it happens.
	const lookupMember = useCallback(async (barcode: string, quiet = false) => {
		const seq = issueSeq.current
		if (!quiet) {
			setMemberBusy(true)
			setMemberScan(barcode)
			setMemberError(null)
		}
		try {
			const res = await fetch(`/api/lib/members/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Member not found')
			if (quiet && issueSeq.current !== seq) return
			setMember(data)
			setHeldCount(data.items_on_loan ?? 0)
		} catch (err) {
			if (!quiet) {
				const message = messageOf(err, 'Member not found')
				setMemberError(message)
				toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
			}
		} finally {
			if (!quiet) setMemberBusy(false)
		}
	}, [institutionId, toast])

	const lookupItem = useCallback(async (barcode: string) => {
		setItemBusy(true)
		setItemScan(barcode)
		setItemError(null)
		try {
			const res = await fetch(`/api/lib/items/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Item not found')
			// The lookup already knows whether this copy can leave the building.
			// Saying so now saves the librarian confirming an issue that was
			// never going to be allowed.
			if (data.refusal) {
				setItemError(data.refusal)
				toast({ title: '❌ ' + data.refusal, description: `Scanned: ${barcode}`, variant: 'destructive' })
				return
			}
			setItem(data)
		} catch (err) {
			const message = messageOf(err, 'Item not found')
			setItemError(message)
			toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
		} finally {
			setItemBusy(false)
		}
	}, [institutionId, toast])

	const handleIssue = async () => {
		if (!member || !item) return
		const title = itemTitle(item)
		try {
			setIssuing(true)
			setItemError(null)
			// Issued against who they are in MyJKKN, not against a membership
			// row — the first book they take is what creates that row.
			const done = (await issueItem({
				myjkkn_id: member.myjkkn_id,
				person_kind: member.person_kind,
				item_id: item.id,
				institution_id: institutionId ?? '',
			})) as unknown as { due_date?: string | null; transaction?: { id?: string } }

			const dueDate = done.due_date ?? null
			setIssued(prev => [...prev, {
				key: done.transaction?.id ?? item.id,
				title,
				accession_number: item.accession_number,
				due_date: dueDate,
			}])
			setHeldCount(count => count + 1)
			issueSeq.current += 1

			// Straight back to an empty scan box — the next book can go through
			// while the panel above catches up in the background.
			setItem(null)
			setItemScan(null)
			toast({
				title: `✅ Issued — ${title}`,
				description: dueDate ? `Due ${asDate(dueDate)}` : undefined,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			lookupMember(member.member_number, true)
		} catch (err) {
			const message = messageOf(err, 'Issue failed')
			setItemError(message)
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setIssuing(false)
		}
	}

	const cancelItem = () => {
		setItem(null)
		setItemScan(null)
		setItemError(null)
	}

	const reset = () => {
		issueSeq.current += 1
		setMember(null)
		setItem(null)
		setIssued([])
		setHeldCount(0)
		setMemberScan(null)
		setMemberError(null)
		setItemScan(null)
		setItemError(null)
	}

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
					<CardContent className="pt-0 pb-4 px-4">
						<BarcodeScannerInput
							onScan={lookupMember}
							busy={memberBusy}
							placeholder="Scan member barcode or enter member number..."
						/>
						<ScanFeedback busy={memberBusy} code={memberScan} error={memberError} />
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
								onChanged={() => lookupMember(member.member_number, true)}
							/>
							<MemberHoldsPanel
								holds={member.holds ?? []}
								onChanged={() => lookupMember(member.member_number, true)}
							/>
							<MemberChargesPanel
								charges={member.charges ?? []}
								onChanged={() => lookupMember(member.member_number, true)}
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
							onScan={lookupItem}
							busy={itemBusy}
							placeholder="Scan item barcode..."
						/>
						<ScanFeedback busy={itemBusy} code={itemScan} error={itemError} />
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
								Cancel
							</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleIssue} disabled={issuing}>
								{issuing ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Issuing…</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Issue</>
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
				</Button>
			)}
		</div>
	)
}

// ─── Return Tab ───────────────────────────────────────────────────────────────

function ReturnTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	const [transaction, setTransaction] = useState<LibLendingTransaction | null>(null)
	const [returning, setReturning] = useState(false)
	const [result, setResult] = useState<LibLendingTransaction | null>(null)
	const [busy, setBusy] = useState(false)
	const [scan, setScan] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	// The server says exactly what went wrong — no book of that number, or a
	// copy nobody has out. Both used to arrive as the same flat sentence, which
	// left the desk guessing whether to re-scan or look somewhere else.
	const lookupItem = useCallback(async (barcode: string) => {
		setBusy(true)
		setScan(barcode)
		setError(null)
		try {
			const res = await fetch(`/api/lib/circulation/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Active loan not found for this item')
			setTransaction(data)
		} catch (err) {
			const message = messageOf(err, 'Lookup failed')
			setError(message)
			toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
		} finally {
			setBusy(false)
		}
	}, [institutionId, toast])

	const handleReturn = async () => {
		if (!transaction) return
		try {
			setReturning(true)
			setError(null)
			const tx = await returnItem({ transaction_id: transaction.id, institution_id: institutionId ?? '' })
			setResult(tx)
			toast({ title: '✅ Item returned successfully', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			const message = messageOf(err, 'Return failed')
			setError(message)
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setReturning(false)
		}
	}

	const reset = () => { setTransaction(null); setResult(null); setScan(null); setError(null) }

	if (result) {
		return (
			<div className="space-y-4">
				<div className="flex flex-col items-center gap-3 py-10">
					<CheckCircle className="h-16 w-16 text-emerald-500" />
					<h3 className="text-xl font-semibold text-emerald-700">Returned Successfully</h3>
					<p className="text-muted-foreground text-sm">Item has been checked in</p>
				</div>
				<Button className="h-10 px-6 w-full" onClick={reset}>Return Another</Button>
			</div>
		)
	}

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
					<BarcodeScannerInput onScan={lookupItem} busy={busy} placeholder="Scan item barcode to return..." />
					<ScanFeedback busy={busy} code={scan} error={transaction ? null : error} />
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
								<p className={`mt-0.5 ${transaction.overdue_days && transaction.overdue_days > 0 ? 'text-red-600 font-medium' : ''}`}>
									{new Date(transaction.due_date).toLocaleDateString('en-IN')}
								</p>
							</div>
						</div>
						{transaction.overdue_days && transaction.overdue_days > 0 && (
							<div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-red-700 text-sm">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>{transaction.overdue_days} days overdue — Charge: ₹{loanLateCharge(transaction).toFixed(2)}</span>
							</div>
						)}
						{error && <ScanFeedback busy={false} code={null} error={error} />}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={reset}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleReturn} disabled={returning}>
								{returning ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Returning...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Return</>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}

// ─── Renew Tab ────────────────────────────────────────────────────────────────

function RenewTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	const [transaction, setTransaction] = useState<LibLendingTransaction | null>(null)
	const [renewing, setRenewing] = useState(false)
	const [result, setResult] = useState<LibLendingTransaction | null>(null)
	const [busy, setBusy] = useState(false)
	const [scan, setScan] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const lookupItem = useCallback(async (barcode: string) => {
		setBusy(true)
		setScan(barcode)
		setError(null)
		try {
			const res = await fetch(`/api/lib/circulation/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Active loan not found for this item')
			setTransaction(data)
		} catch (err) {
			const message = messageOf(err, 'Lookup failed')
			setError(message)
			toast({ title: '❌ ' + message, description: `Scanned: ${barcode}`, variant: 'destructive' })
		} finally {
			setBusy(false)
		}
	}, [institutionId, toast])

	const handleRenew = async () => {
		if (!transaction) return
		try {
			setRenewing(true)
			setError(null)
			const tx = await renewItem({ transaction_id: transaction.id, institution_id: institutionId ?? '' })
			setResult(tx)
			toast({ title: '✅ Item renewed successfully', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			const message = messageOf(err, 'Renewal failed')
			setError(message)
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setRenewing(false)
		}
	}

	const reset = () => { setTransaction(null); setResult(null); setScan(null); setError(null) }

	if (result) {
		return (
			<div className="space-y-4">
				<div className="flex flex-col items-center gap-3 py-10">
					<CheckCircle className="h-16 w-16 text-emerald-500" />
					<h3 className="text-xl font-semibold text-emerald-700">Renewed Successfully</h3>
					<p className="text-muted-foreground text-sm text-center">
						New due date: <strong>{result.due_date ? new Date(result.due_date).toLocaleDateString('en-IN') : '—'}</strong>
					</p>
				</div>
				<Button className="h-10 px-6 w-full" onClick={reset}>Renew Another</Button>
			</div>
		)
	}

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
					<BarcodeScannerInput onScan={lookupItem} busy={busy} placeholder="Scan item barcode to renew..." />
					<ScanFeedback busy={busy} code={scan} error={transaction ? null : error} />
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
						{error && <ScanFeedback busy={false} code={null} error={error} />}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={reset}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleRenew} disabled={renewing}>
								{renewing ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Renewing...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Renewal</>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CirculationPage() {
	const { institutionId } = useInstitutionFilter()

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Header */}
			<div className="flex-shrink-0">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
						<ArrowRightLeft className="h-5 w-5 text-blue-600" />
					</div>
					<div className="min-w-0">
						<h1 className="text-base font-semibold">Circulation Desk</h1>
						<p className="text-xs text-muted-foreground">Issue, return, and renew library resources</p>
					</div>
				</div>
			</div>

			{/* Tabs Card */}
			<Card className="flex-1">
				<CardContent className="p-4 sm:p-6">
					<div className="max-w-lg mx-auto">
						<Tabs defaultValue="issue">
							<TabsList className="w-full grid grid-cols-3 h-9">
								<TabsTrigger value="issue" className="text-sm">
									<BookOpen className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Issue
								</TabsTrigger>
								<TabsTrigger value="return" className="text-sm">
									<RotateCcw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Return
								</TabsTrigger>
								<TabsTrigger value="renew" className="text-sm">
									<RefreshCw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Renew
								</TabsTrigger>
							</TabsList>
							<TabsContent value="issue" className="mt-5">
								<IssueTab institutionId={institutionId} />
							</TabsContent>
							<TabsContent value="return" className="mt-5">
								<ReturnTab institutionId={institutionId} />
							</TabsContent>
							<TabsContent value="renew" className="mt-5">
								<RenewTab institutionId={institutionId} />
							</TabsContent>
						</Tabs>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
