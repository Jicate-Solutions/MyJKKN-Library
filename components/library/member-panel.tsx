'use client'

/**
 * One person, opened in place — from the Members list or from a gate row.
 *
 * Who they are comes from MyJKKN; what this library knows about them — the
 * books in their hands, what they owe, what they are waiting for, when they
 * last walked in — comes from the one-member summary. Issue / Return / Collect
 * carry their number straight to the desk, so it is never retyped.
 *
 * The caller may hand over as little as an id, a college and a name: a gate
 * row knows no photo, email or fine status, and the summary fills those in the
 * moment it arrives. The Members list hands over everything it has, and the
 * panel is on screen complete before the summary comes back.
 *
 * Moved out of the Members page on 5 Sep 2026 so the gate could open the same
 * panel without leaving the door.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { OverflowText } from '@/components/library/overflow-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import { Copy, Check, BookOpen, RotateCcw, IndianRupee, DoorOpen, Clock, CreditCard } from 'lucide-react'
import type { LibDirectoryMember, LibMemberCategory } from '@/types/lib'
import { formatClockTime } from '@/lib/library/ist-clock'

const initials = (name: string): string =>
	name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'

const rupees = (amount: number) =>
	`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

const asDate = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ── Small pieces ────────────────────────────────────────────────────────────

/**
 * A member's photo, fetched only when its row is on screen.
 *
 * The avatar component used here before asked the browser for every photo on
 * the page the moment the page drew — fifty MyJKKN images at once. A plain
 * image with `loading="lazy"` is fetched when it scrolls into view, and the
 * initials stand in until then, or for good when MyJKKN has no photo.
 */
export function LazyPhoto({ src, name, className }: { src: string | null; name: string; className: string }) {
	const [failed, setFailed] = useState(false)
	useEffect(() => { setFailed(false) }, [src])

	if (!src || failed) {
		return (
			<div className={`${className} flex shrink-0 items-center justify-center rounded-full bg-brand-green-50 text-brand-green-700 font-medium dark:bg-brand-green-900/30 dark:text-brand-green-400`}>
				{initials(name)}
			</div>
		)
	}
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={src}
			alt={name}
			loading="lazy"
			decoding="async"
			onError={() => setFailed(true)}
			className={`${className} shrink-0 rounded-full object-cover`}
		/>
	)
}

/** How long the tick stays where the copy icon was. */
const COPIED_TICK_MS = 1600

/**
 * One click copies it. The number is what gets retyped at the desk.
 *
 * The answer is given where the click was: the icon turns into a tick for a
 * moment, and the tooltip says "Copied". No toast — one appeared bottom-right
 * for every copy, far from the eye, and had to be dismissed or waited out.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
	const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

	// The tick goes back to the icon on its own; a second click restarts it.
	useEffect(() => {
		if (state === 'idle') return
		const timer = setTimeout(() => setState('idle'), COPIED_TICK_MS)
		return () => clearTimeout(timer)
	}, [state])

	const copy = async (e: React.MouseEvent) => {
		e.stopPropagation()
		try {
			await navigator.clipboard.writeText(value)
			setState('copied')
		} catch {
			setState('failed')
		}
	}

	return (
		<Tooltip open={state === 'idle' ? undefined : true}>
			<TooltipTrigger asChild>
				<button
					type="button"
					className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded transition-opacity focus:opacity-100 group-hover:opacity-100 ${
						state === 'copied'
							? 'text-emerald-600 opacity-100 dark:text-emerald-400'
							: state === 'failed'
								? 'text-destructive opacity-100'
								: 'text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground'
					}`}
					onClick={copy}
					aria-label={state === 'copied' ? `Copied ${label}` : `Copy ${label}`}
					aria-live="polite"
				>
					{state === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
				</button>
			</TooltipTrigger>
			<TooltipContent>
				{state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : `Copy ${label}`}
			</TooltipContent>
		</Tooltip>
	)
}

export function LibraryBadge({ member }: { member: Pick<LibDirectoryMember, 'is_delinquent' | 'has_borrowed'> }) {
	if (member.is_delinquent) {
		return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Fine due</Badge>
	}
	if (member.has_borrowed) {
		return (
			<Badge variant="outline" className="bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/20 dark:text-brand-green-400 dark:border-brand-green-700">
				Has borrowed
			</Badge>
		)
	}
	return <span className="text-xs text-muted-foreground">—</span>
}

// ── The one-member panel ────────────────────────────────────────────────────

/**
 * The least a caller has to know to open somebody: which person, in which
 * library, and what to call them while the rest is being read. A full
 * `LibDirectoryMember` fits, and so does a gate row.
 */
export interface MemberPanelSubject {
	/** `learner:<id>` or `facilitator:<id>` — what the summary route is asked for. */
	id: string
	institution_id: string
	display_name: string
	member_number?: string | null
	member_category?: string | null
	role_label?: string | null
	photo_url?: string | null
	email?: string | null
	is_delinquent?: boolean
	has_borrowed?: boolean
}

/** What /api/lib/members/[id] answers: the person again, and the library's side of them. */
interface MemberSummary {
	display_name: string
	member_number: string
	member_category: string
	role_label: string
	email: string | null
	phone: string | null
	photo_url: string | null
	is_delinquent: boolean
	has_borrowed: boolean
	first_borrowed_at: string | null
	outstanding_charges: number
	loans: { id: string; title: string; accession_number: string | null; due_date: string; is_overdue: boolean; overdue_days: number }[]
	charges: { id: string; title: string; accession_number: string | null; net_payable: number; payment_status: string }[]
	holds: { id: string; hold_status: string; title: string }[]
	visits: { visit_date: string; entry_time: string | null; exit_time: string | null }[]
}

export function MemberPanel({
	member,
	institutionCode,
	deskReady,
	onClose,
}: {
	member: MemberPanelSubject | null
	institutionCode: string | null
	/** The desk serves one college at a time; with every college showing there is nobody to hand over to. */
	deskReady: boolean
	onClose: () => void
}) {
	const router = useRouter()
	const [summary, setSummary] = useState<MemberSummary | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!member) return
		let cancelled = false
		setSummary(null)
		setError(null)
		setLoading(true)
		fetch(`/api/lib/members/${encodeURIComponent(member.id)}?institution_id=${encodeURIComponent(member.institution_id)}`)
			.then(async res => {
				const data = await res.json()
				if (!res.ok) throw new Error(data.error || 'Could not read this member')
				if (!cancelled) setSummary(data)
			})
			.catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read this member') })
			.finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [member])

	// What the caller knew, completed by what the summary says. A gate row
	// arrives with a name and a number; the photo, the email and the fine
	// status appear when the summary does.
	const shown = member ? {
		display_name: summary?.display_name ?? member.display_name,
		role_label: summary?.role_label ?? member.role_label ?? '',
		member_category: summary?.member_category ?? member.member_category ?? null,
		member_number: summary?.member_number ?? member.member_number ?? '',
		photo_url: summary?.photo_url ?? member.photo_url ?? null,
		email: summary?.email ?? member.email ?? null,
		is_delinquent: summary?.is_delinquent ?? member.is_delinquent ?? false,
		has_borrowed: summary?.has_borrowed ?? member.has_borrowed ?? false,
	} : null

	const toDesk = () => {
		if (!shown?.member_number) return
		router.push(`/circulation?member=${encodeURIComponent(shown.member_number)}`)
	}

	const canGo = deskReady && !!shown?.member_number
	const whyNot = !deskReady
		? 'Choose the college in the header first — the desk serves one library at a time'
		: !shown?.member_number
			? 'This person has no card number in MyJKKN, so the desk cannot look them up'
			: null

	return (
		<Sheet open={!!member} onOpenChange={open => { if (!open) onClose() }}>
			<SheetContent className="w-full sm:max-w-md overflow-y-auto">
				{shown && (
					<>
						<SheetHeader className="text-left">
							<div className="flex items-start gap-3">
								<LazyPhoto src={shown.photo_url} name={shown.display_name} className="h-14 w-14 text-base" />
								<div className="min-w-0 flex-1">
									<SheetTitle className="text-base leading-tight">{shown.display_name}</SheetTitle>
									<SheetDescription className="mt-0.5 text-xs">{shown.role_label}</SheetDescription>
									<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
										{shown.member_category && <MemberCategoryBadge category={shown.member_category as LibMemberCategory} />}
										<LibraryBadge member={shown} />
										{institutionCode && <Badge variant="secondary" className="text-xs">{institutionCode}</Badge>}
									</div>
								</div>
							</div>
						</SheetHeader>

						<div className="mt-4 space-y-1.5 text-sm">
							<div className="group flex items-center gap-2">
								<CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
								{shown.member_number
									? <><span className="font-mono">{shown.member_number}</span><CopyButton value={shown.member_number} label="number" /></>
									: <span className="text-amber-700 dark:text-amber-400">No card number in MyJKKN</span>}
							</div>
							{shown.email && (
								<div className="group flex items-center gap-2 min-w-0">
									<span className="text-muted-foreground text-xs w-3.5 text-center">@</span>
									<span className="truncate">{shown.email}</span>
									<CopyButton value={shown.email} label="email" />
								</div>
							)}
							{summary?.phone && (
								<div className="group flex items-center gap-2">
									<span className="text-muted-foreground text-xs w-3.5 text-center">☏</span>
									<span>{summary.phone}</span>
									<CopyButton value={summary.phone} label="phone" />
								</div>
							)}
						</div>

						{/* The three things the counter does, one press each. The number
						    goes with them, so nobody types it again at the desk. */}
						<div className="mt-4 grid grid-cols-3 gap-2">
							<Button size="sm" className="h-9 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900" disabled={!canGo} onClick={toDesk}>
								<BookOpen className="h-3.5 w-3.5 mr-1.5" />Issue
							</Button>
							<Button size="sm" variant="outline" className="h-9" disabled={!canGo} onClick={toDesk}>
								<RotateCcw className="h-3.5 w-3.5 mr-1.5" />Return
							</Button>
							<Button size="sm" variant="outline" className="h-9" disabled={!canGo} onClick={toDesk}>
								<IndianRupee className="h-3.5 w-3.5 mr-1.5" />Collect
							</Button>
						</div>
						{whyNot && <p className="mt-1.5 text-xs text-muted-foreground">{whyNot}</p>}

						<div className="mt-5 space-y-5">
							{loading && (
								<div className="space-y-2">
									<Skeleton className="h-4 w-1/3" />
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
								</div>
							)}
							{error && <p className="text-sm text-destructive">{error}</p>}

							{summary && (
								<>
									<section>
										<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
											<BookOpen className="h-3.5 w-3.5" /> Books out now · {summary.loans.length}
										</h3>
										{summary.loans.length === 0
											? <p className="mt-1.5 text-sm text-muted-foreground">Nothing in hand</p>
											: (
												<ul className="mt-1.5 divide-y rounded-md border">
													{summary.loans.map(loan => (
														<li key={loan.id} className="px-3 py-2 text-sm">
															<div className="font-medium leading-tight">{loan.title}</div>
															<div className="mt-0.5 text-xs text-muted-foreground">
																{loan.accession_number ?? '—'} · due {asDate(loan.due_date)}
																{loan.is_overdue && <span className="ml-1.5 text-destructive font-medium">{loan.overdue_days} days late</span>}
															</div>
														</li>
													))}
												</ul>
											)}
									</section>

									<section>
										<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
											<IndianRupee className="h-3.5 w-3.5" /> Owing · {rupees(summary.outstanding_charges)}
										</h3>
										{summary.charges.length === 0
											? <p className="mt-1.5 text-sm text-muted-foreground">Nothing owed</p>
											: (
												<ul className="mt-1.5 divide-y rounded-md border">
													{summary.charges.map(charge => (
														<li key={charge.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
															<div className="min-w-0">
																<OverflowText as="div" text={charge.title} className="font-medium leading-tight" />
																<div className="text-xs text-muted-foreground">{charge.accession_number ?? '—'}{charge.payment_status === 'partial' ? ' · part paid' : ''}</div>
															</div>
															<span className="shrink-0 font-medium text-destructive">{rupees(charge.net_payable)}</span>
														</li>
													))}
												</ul>
											)}
									</section>

									{summary.holds.length > 0 && (
										<section>
											<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Waiting for · {summary.holds.length}</h3>
											<ul className="mt-1.5 space-y-1 text-sm">
												{summary.holds.map(hold => (
													<li key={hold.id} className="flex items-center gap-2">
														<OverflowText text={hold.title} className="min-w-0" />
														<Badge variant="outline" className="text-[10px] capitalize">{hold.hold_status}</Badge>
													</li>
												))}
											</ul>
										</section>
									)}

									<section>
										<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
											<DoorOpen className="h-3.5 w-3.5" /> Last visits
										</h3>
										{summary.visits.length === 0
											? <p className="mt-1.5 text-sm text-muted-foreground">Never recorded at the gate</p>
											: (
												<ul className="mt-1.5 space-y-1 text-sm tabular-nums">
													{summary.visits.map((visit, i) => (
														<li key={i} className="flex items-center gap-2 text-muted-foreground">
															<Clock className="h-3 w-3" />
															<span className="text-foreground">{asDate(visit.visit_date)}</span>
															<span>{formatClockTime(visit.entry_time)} → {formatClockTime(visit.exit_time)}</span>
														</li>
													))}
												</ul>
											)}
									</section>

									{summary.first_borrowed_at && (
										<p className="text-xs text-muted-foreground">Borrowing here since {asDate(summary.first_borrowed_at)}</p>
									)}
								</>
							)}
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	)
}
