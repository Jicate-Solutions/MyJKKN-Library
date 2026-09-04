'use client'

/**
 * Knowledge Community Members.
 *
 * Nobody is enrolled here any more. Every Active learner and every Active
 * staff member of this college is a member of its library, read live from
 * MyJKKN each time this page loads — so a learner admitted this morning is a
 * member this afternoon, and somebody who leaves stops being one without
 * anybody remembering to remove them.
 *
 * That is why there is no Add, no Edit and no Delete on this screen: a name, an
 * email or a person's status is changed in MyJKKN, and this page shows what
 * MyJKKN says. What the library itself knows is the last column — whether they
 * have ever borrowed, and whether they owe anything.
 *
 * Built (3 Sep 2026) for the hands that use it all day:
 *
 *   * a row opens the person — books out, fines, holds, last visits — with
 *     Issue / Return / Collect fine that carry them straight to the desk, so a
 *     number is never retyped on another screen;
 *   * the scorecards filter; chips narrow by what the library knows (borrowed,
 *     fine due, never borrowed, no card number, duplicate number); programme or
 *     designation is a pick, not a search;
 *   * the cursor is in the search box on open, `/` brings it back, Esc clears,
 *     and a card scanned into it opens that person at once;
 *   * search and every filter live in the address, so Back, refresh and a
 *     link to a colleague all keep them;
 *   * the list read last time is painted first from the browser's own copy and
 *     refreshed quietly behind, and a MyJKKN failure keeps that copy on screen
 *     rather than emptying the table;
 *   * the filtered list downloads to Excel as it stands.
 *
 * A librarian sees their own college. Only an admin or a super admin sees more
 * than one, and only by choosing "All Institutions".
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useInstitution } from '@/context/institution-context'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import {
	Users, GraduationCap, Briefcase, AlertTriangle,
	Search, RefreshCw, ChevronLeft, ChevronRight, Info,
	Copy, Download, BookOpen, RotateCcw, IndianRupee, DoorOpen, Clock, CreditCard, X,
} from 'lucide-react'
import type { LibDirectoryMember, LibMemberCategory } from '@/types/lib'
import { formatClockTime } from '@/lib/library/ist-clock'

const CATEGORIES = [
	{ value: 'learner', label: 'Learners' },
	{ value: 'facilitator', label: 'Staff' },
]

/**
 * What the library knows, as a filter.
 *
 * The first three are the Library column made choosable. The last two are the
 * data-quality checks: a person with no usable number cannot be scanned at the
 * desk, and two people answering to one number would have books issued to the
 * wrong person — both are things to fix in MyJKKN before they reach the counter.
 */
type LibraryStatus = 'all' | 'borrowed' | 'fine' | 'never' | 'nocard' | 'duplicate'

const LIBRARY_STATUS_LABELS: Record<Exclude<LibraryStatus, 'all'>, string> = {
	borrowed: 'Has borrowed',
	fine: 'Fine due',
	never: 'Never borrowed',
	nocard: 'No card number',
	duplicate: 'Duplicate number',
}

const DEFAULT_PER_PAGE = 50

const initials = (name: string): string =>
	name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'

const rupees = (amount: number) =>
	`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

const asDate = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** "just now", "4 min ago", "2 hr ago" — how old the list is, in the librarian's words. */
function ageOf(iso: string | null, now: number): string | null {
	if (!iso) return null
	const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
	if (seconds < 45) return 'just now'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes} min ago`
	const hours = Math.round(minutes / 60)
	return `${hours} hr ago`
}

// ── What is remembered between visits ───────────────────────────────────────

/**
 * The last list read, per college, kept in this tab's session storage.
 *
 * The server's own copy is already served from memory, so what a revisit used
 * to wait for was the whole roll travelling and being parsed again. Painted
 * from here first, the page is on screen at once; the fresh read replaces it
 * quietly a moment later. Cleared with the tab — it is a convenience, not a
 * record.
 */
interface RememberedList {
	rows: LibDirectoryMember[]
	readAt: string | null
	savedAt: number
}

const REMEMBER_PREFIX = 'lib:members:'

function rememberedList(key: string): RememberedList | null {
	try {
		const raw = sessionStorage.getItem(REMEMBER_PREFIX + key)
		if (!raw) return null
		const parsed = JSON.parse(raw) as RememberedList
		return Array.isArray(parsed.rows) ? parsed : null
	} catch {
		return null
	}
}

function rememberList(key: string, list: RememberedList): void {
	try {
		sessionStorage.setItem(REMEMBER_PREFIX + key, JSON.stringify(list))
	} catch {
		// Storage full or blocked — the page simply reads fresh next time
	}
}

// ── What lives in the address ───────────────────────────────────────────────

interface ViewState {
	q: string
	cat: string
	lib: LibraryStatus
	prog: string
	page: number
	per: number
	/** A member to open straight away — the id from a link somebody sent. */
	open: string | null
}

const DEFAULT_VIEW: ViewState = { q: '', cat: 'all', lib: 'all', prog: 'all', page: 1, per: DEFAULT_PER_PAGE, open: null }

const LIBRARY_STATUSES: LibraryStatus[] = ['all', 'borrowed', 'fine', 'never', 'nocard', 'duplicate']

function readView(): ViewState {
	const params = new URLSearchParams(window.location.search)
	const lib = params.get('lib') as LibraryStatus | null
	return {
		q: params.get('q') ?? '',
		cat: params.get('cat') ?? 'all',
		lib: lib && LIBRARY_STATUSES.includes(lib) ? lib : 'all',
		prog: params.get('prog') ?? 'all',
		page: Math.max(1, Number(params.get('page')) || 1),
		per: Number(params.get('per')) || DEFAULT_PER_PAGE,
		open: params.get('open'),
	}
}

/** Only what differs from the defaults is written, so a plain visit has a plain address. */
function writeView(view: ViewState): void {
	const params = new URLSearchParams()
	if (view.q) params.set('q', view.q)
	if (view.cat !== 'all') params.set('cat', view.cat)
	if (view.lib !== 'all') params.set('lib', view.lib)
	if (view.prog !== 'all') params.set('prog', view.prog)
	if (view.page > 1) params.set('page', String(view.page))
	if (view.per !== DEFAULT_PER_PAGE) params.set('per', String(view.per))
	if (view.open) params.set('open', view.open)
	const query = params.toString()
	window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

// ── Small pieces ────────────────────────────────────────────────────────────

/**
 * A member's photo, fetched only when its row is on screen.
 *
 * The avatar component used here before asked the browser for every photo on
 * the page the moment the page drew — fifty MyJKKN images at once. A plain
 * image with `loading="lazy"` is fetched when it scrolls into view, and the
 * initials stand in until then, or for good when MyJKKN has no photo.
 */
function LazyPhoto({ src, name, className }: { src: string | null; name: string; className: string }) {
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

/** One click copies it. The number is what gets retyped at the desk. */
function CopyButton({ value, label }: { value: string; label: string }) {
	const { toast } = useToast()
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
					onClick={async e => {
						e.stopPropagation()
						try {
							await navigator.clipboard.writeText(value)
							toast({ title: `Copied ${label}`, description: value, className: 'bg-green-50 border-green-200 text-green-800' })
						} catch {
							toast({ title: 'Could not copy', variant: 'destructive' })
						}
					}}
					aria-label={`Copy ${label}`}
				>
					<Copy className="h-3 w-3" />
				</button>
			</TooltipTrigger>
			<TooltipContent>Copy {label}</TooltipContent>
		</Tooltip>
	)
}

function LibraryBadge({ member }: { member: LibDirectoryMember }) {
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

interface MemberSummary {
	phone: string | null
	first_borrowed_at: string | null
	outstanding_charges: number
	loans: { id: string; title: string; accession_number: string | null; due_date: string; is_overdue: boolean; overdue_days: number }[]
	charges: { id: string; title: string; accession_number: string | null; net_payable: number; payment_status: string }[]
	holds: { id: string; hold_status: string; title: string }[]
	visits: { visit_date: string; entry_time: string | null; exit_time: string | null }[]
}

function MemberPanel({
	member,
	institutionCode,
	deskReady,
	onClose,
}: {
	member: LibDirectoryMember | null
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

	const toDesk = () => {
		if (!member?.member_number) return
		router.push(`/circulation?member=${encodeURIComponent(member.member_number)}`)
	}

	const canGo = deskReady && !!member?.member_number
	const whyNot = !deskReady
		? 'Choose the college in the header first — the desk serves one library at a time'
		: !member?.member_number
			? 'This person has no card number in MyJKKN, so the desk cannot look them up'
			: null

	return (
		<Sheet open={!!member} onOpenChange={open => { if (!open) onClose() }}>
			<SheetContent className="w-full sm:max-w-md overflow-y-auto">
				{member && (
					<>
						<SheetHeader className="text-left">
							<div className="flex items-start gap-3">
								<LazyPhoto src={member.photo_url} name={member.display_name} className="h-14 w-14 text-base" />
								<div className="min-w-0 flex-1">
									<SheetTitle className="text-base leading-tight">{member.display_name}</SheetTitle>
									<SheetDescription className="mt-0.5 text-xs">{member.role_label}</SheetDescription>
									<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
										<MemberCategoryBadge category={member.member_category as LibMemberCategory} />
										<LibraryBadge member={member} />
										{institutionCode && <Badge variant="secondary" className="text-xs">{institutionCode}</Badge>}
									</div>
								</div>
							</div>
						</SheetHeader>

						<div className="mt-4 space-y-1.5 text-sm">
							<div className="group flex items-center gap-2">
								<CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
								{member.member_number
									? <><span className="font-mono">{member.member_number}</span><CopyButton value={member.member_number} label="number" /></>
									: <span className="text-amber-700 dark:text-amber-400">No card number in MyJKKN</span>}
							</div>
							{member.email && (
								<div className="group flex items-center gap-2 min-w-0">
									<span className="text-muted-foreground text-xs w-3.5 text-center">@</span>
									<span className="truncate">{member.email}</span>
									<CopyButton value={member.email} label="email" />
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
																<div className="font-medium leading-tight truncate">{charge.title}</div>
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
														<span className="truncate">{hold.title}</span>
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

// ── The page ────────────────────────────────────────────────────────────────

export default function MembersPage() {
	const { isReady, appendToUrl, institutionId, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { availableInstitutions } = useInstitution()
	const { toast } = useToast()

	const [members, setMembers] = useState<LibDirectoryMember[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [loadError, setLoadError] = useState<string | null>(null)
	/** True when what is on screen came from the browser's copy after MyJKKN could not be read. */
	const [showingRemembered, setShowingRemembered] = useState(false)
	const [readAt, setReadAt] = useState<string | null>(null)
	const [now, setNow] = useState(() => Date.now())

	const [view, setView] = useState<ViewState>(DEFAULT_VIEW)
	const [viewReady, setViewReady] = useState(false)
	const [openMember, setOpenMember] = useState<LibDirectoryMember | null>(null)

	const searchRef = useRef<HTMLInputElement>(null)
	const rememberKey = institutionId ?? 'all'
	/** How many rows are on screen, readable from inside a failed fetch without re-rendering. */
	const membersOnScreen = useRef(0)
	useEffect(() => { membersOnScreen.current = members.length }, [members])

	const patchView = useCallback((patch: Partial<ViewState>) => {
		setView(prev => ({ ...prev, ...patch }))
	}, [])

	// Filters change what is on the page, so the page goes back to the first one
	const setFilter = useCallback((patch: Partial<ViewState>) => {
		setView(prev => ({ ...prev, ...patch, page: 1 }))
	}, [])

	// ── The address, read once and then kept up to date ──
	useEffect(() => {
		setView(readView())
		setViewReady(true)
		searchRef.current?.focus()
	}, [])

	useEffect(() => {
		if (viewReady) writeView(view)
	}, [view, viewReady])

	// ── The list ──
	const fetchData = useCallback(async (quiet = false) => {
		if (!isReady) return
		try {
			if (quiet) setRefreshing(true)
			else setLoading(true)
			setLoadError(null)
			const res = await fetch(appendToUrl('/api/lib/members'))
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Failed to read the member list')
			const rows: LibDirectoryMember[] = Array.isArray(data) ? data : []
			const stamp = res.headers.get('x-roll-read-at')
			setMembers(rows)
			setReadAt(stamp)
			setShowingRemembered(false)
			rememberList(rememberKey, { rows, readAt: stamp, savedAt: Date.now() })
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load members'
			setLoadError(message)
			// What was on screen stays on screen. An empty table says "this
			// college has nobody", which is never what a failed read means.
			if (membersOnScreen.current > 0) setShowingRemembered(true)
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [isReady, appendToUrl, toast, rememberKey])

	// Paint what this tab already had for the college, then read afresh behind it
	useEffect(() => {
		if (!isReady) return
		const remembered = rememberedList(rememberKey)
		if (remembered && remembered.rows.length > 0) {
			setMembers(remembered.rows)
			setReadAt(remembered.readAt)
			setLoading(false)
			fetchData(true)
		} else {
			setMembers([])
			fetchData(false)
		}
	}, [isReady, rememberKey, fetchData])

	// Switching college starts the list again from page one — but not on the
	// first render, where the page number has just been read from the address
	const filterSeen = useRef(shouldFilter)
	useEffect(() => {
		if (filterSeen.current === shouldFilter) return
		filterSeen.current = shouldFilter
		setView(prev => ({ ...prev, page: 1 }))
	}, [shouldFilter])

	// "4 min ago" moves on its own
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30_000)
		return () => clearInterval(timer)
	}, [])

	// A member named in the address opens once the list can find them
	useEffect(() => {
		if (!view.open || members.length === 0) return
		const target = members.find(m => m.id === view.open)
		if (target) setOpenMember(target)
	}, [view.open, members])

	// ── What the college's list says about itself ──
	const institutionCodeOf = useMemo(() => {
		const map = new Map<string, string>()
		for (const inst of availableInstitutions) {
			if (inst.id && inst.institution_code) map.set(inst.id, inst.institution_code)
		}
		return map
	}, [availableInstitutions])

	/** Numbers two or more people answer to — a fault to fix in MyJKKN. */
	const duplicateNumbers = useMemo(() => {
		const seen = new Map<string, number>()
		for (const m of members) {
			const key = m.member_number.trim().toLowerCase()
			if (!key) continue
			seen.set(key, (seen.get(key) ?? 0) + 1)
		}
		return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k))
	}, [members])

	const isDuplicate = useCallback(
		(m: LibDirectoryMember) => duplicateNumbers.has(m.member_number.trim().toLowerCase()),
		[duplicateNumbers]
	)

	// Scorecards count the whole college, not the filtered page
	const scorecardData = useMemo(() => ({
		total: members.length,
		learners: members.filter(m => m.member_category === 'learner').length,
		staff: members.filter(m => m.member_category === 'facilitator').length,
		owing: members.filter(m => m.is_delinquent).length,
		nocard: members.filter(m => !m.member_number).length,
		duplicate: members.filter(isDuplicate).length,
	}), [members, isDuplicate])

	/** Programmes or designations, as MyJKKN names them, within the chosen category. */
	const programmeOptions = useMemo(() => {
		const counts = new Map<string, number>()
		for (const m of members) {
			if (view.cat !== 'all' && m.member_category !== view.cat) continue
			counts.set(m.role_label, (counts.get(m.role_label) ?? 0) + 1)
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([label, count]) => ({ label, count }))
	}, [members, view.cat])

	const filtered = useMemo(() => {
		const term = view.q.trim().toLowerCase()
		return members.filter(m => {
			if (view.cat !== 'all' && m.member_category !== view.cat) return false
			if (view.prog !== 'all' && m.role_label !== view.prog) return false
			switch (view.lib) {
				case 'borrowed': if (!m.has_borrowed) return false; break
				case 'fine': if (!m.is_delinquent) return false; break
				case 'never': if (m.has_borrowed) return false; break
				case 'nocard': if (m.member_number) return false; break
				case 'duplicate': if (!isDuplicate(m)) return false; break
			}
			if (!term) return true
			return m.member_number.toLowerCase().includes(term)
				|| m.display_name.toLowerCase().includes(term)
				|| (m.email?.toLowerCase().includes(term) ?? false)
				|| m.role_label.toLowerCase().includes(term)
		})
	}, [members, view.q, view.cat, view.prog, view.lib, isDuplicate])

	const pageSizeOptions = useMemo(() => {
		const options = [25, 50, 100, 200]
		if (filtered.length > 200) options.push(filtered.length)
		return options
	}, [filtered.length])

	const effectivePerPage = view.per > filtered.length ? filtered.length : view.per
	const totalPages = Math.max(1, Math.ceil(filtered.length / Math.max(effectivePerPage, 1)))
	const currentPage = Math.min(view.page, totalPages)
	const paginated = effectivePerPage > 0
		? filtered.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: filtered
	const colCount = mustSelectInstitution ? 7 : 6

	const goToPage = useCallback((page: number) => {
		patchView({ page: Math.min(Math.max(1, page), totalPages) })
	}, [patchView, totalPages])

	const open = useCallback((m: LibDirectoryMember) => {
		setOpenMember(m)
		patchView({ open: m.id })
	}, [patchView])

	const close = useCallback(() => {
		setOpenMember(null)
		patchView({ open: null })
	}, [patchView])

	/**
	 * Enter in the search box: a card scanned in, or a number typed whole,
	 * opens that person. One match left after filtering opens too — the
	 * librarian has already found who they wanted.
	 */
	const openFromSearch = () => {
		const term = view.q.trim().toLowerCase()
		if (!term) return
		const exact = members.find(m => m.member_number.toLowerCase() === term)
		if (exact) { open(exact); return }
		if (filtered.length === 1) open(filtered[0])
	}

	// `/` brings the cursor back to the box, ← → turn the page — unless a box
	// already has the cursor, where those keys mean what they always mean
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null
			const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
			if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
			if (typing || openMember) return
			if (e.key === 'ArrowLeft') goToPage(currentPage - 1)
			if (e.key === 'ArrowRight') goToPage(currentPage + 1)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [goToPage, currentPage, openMember])

	/** The list as it stands on screen — same filters, every page. */
	const exportList = () => {
		if (filtered.length === 0) {
			toast({ title: 'Nothing to download for these filters', variant: 'destructive' })
			return
		}
		const rows = filtered.map(m => ({
			'Member #': m.member_number || '',
			Name: m.display_name,
			Category: m.member_category === 'learner' ? 'Learner' : 'Staff',
			'Programme / Role': m.role_label,
			Email: m.email ?? '',
			...(mustSelectInstitution ? { College: institutionCodeOf.get(m.institution_id) ?? '' } : {}),
			Library: m.is_delinquent ? 'Fine due' : m.has_borrowed ? 'Has borrowed' : '',
			'Card issue': !m.member_number ? 'No card number' : isDuplicate(m) ? 'Duplicate number' : '',
		}))
		const sheet = XLSX.utils.json_to_sheet(rows)
		sheet['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 10 }, { wch: 36 }, { wch: 34 }, ...(mustSelectInstitution ? [{ wch: 8 }] : []), { wch: 14 }, { wch: 18 }]
		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, sheet, 'Members')
		const college = institutionId ? (institutionCodeOf.get(institutionId) ?? 'college') : 'all-colleges'
		const parts = [college, view.cat !== 'all' ? view.cat : null, view.lib !== 'all' ? view.lib : null].filter(Boolean)
		XLSX.writeFile(book, `members-${parts.join('-')}-${new Date().toISOString().split('T')[0]}.xlsx`)
	}

	const age = ageOf(readAt, now)
	const activeCard = 'ring-2 ring-offset-1 ring-brand-green/60 dark:ring-brand-green-400/60'
	const scorecardButton = 'text-left w-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green'
	const hasFilters = view.q || view.cat !== 'all' || view.lib !== 'all' || view.prog !== 'all'

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards — each one is the filter it names */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<button type="button" className={scorecardButton} onClick={() => setFilter({ cat: 'all', lib: 'all', prog: 'all' })} aria-label="Show everyone">
					<Card className={`border-l-4 border-l-brand-green dark:border-l-brand-green-400 hover-lift ${!hasFilters ? activeCard : ''}`}>
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight font-heading text-brand-green dark:text-brand-green-400">{loading ? <Skeleton className="h-7 w-14" /> : scorecardData.total}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Members</p>
								</div>
								<Users className="h-5 w-5 text-brand-green/40 dark:text-brand-green-400/40" />
							</div>
						</CardContent>
					</Card>
				</button>
				<button type="button" className={scorecardButton} onClick={() => setFilter({ cat: view.cat === 'learner' ? 'all' : 'learner', prog: 'all' })} aria-label="Show learners only">
					<Card className={`border-l-4 border-l-blue-400 hover-lift ${view.cat === 'learner' ? activeCard : ''}`}>
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight font-heading text-blue-700 dark:text-blue-400">{loading ? <Skeleton className="h-7 w-14" /> : scorecardData.learners}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Learners</p>
								</div>
								<GraduationCap className="h-5 w-5 text-blue-400/50" />
							</div>
						</CardContent>
					</Card>
				</button>
				<button type="button" className={scorecardButton} onClick={() => setFilter({ cat: view.cat === 'facilitator' ? 'all' : 'facilitator', prog: 'all' })} aria-label="Show staff only">
					<Card className={`border-l-4 border-l-purple-400 hover-lift ${view.cat === 'facilitator' ? activeCard : ''}`}>
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight font-heading text-purple-700 dark:text-purple-400">{loading ? <Skeleton className="h-7 w-14" /> : scorecardData.staff}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Staff</p>
								</div>
								<Briefcase className="h-5 w-5 text-purple-400/50" />
							</div>
						</CardContent>
					</Card>
				</button>
				<button type="button" className={scorecardButton} onClick={() => setFilter({ lib: view.lib === 'fine' ? 'all' : 'fine' })} aria-label="Show members owing a fine">
					<Card className={`border-l-4 border-l-destructive hover-lift ${view.lib === 'fine' ? activeCard : ''}`}>
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight font-heading text-destructive">{loading ? <Skeleton className="h-7 w-14" /> : scorecardData.owing}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Owing a Fine</p>
								</div>
								<AlertTriangle className="h-5 w-5 text-destructive/40" />
							</div>
						</CardContent>
					</Card>
				</button>
			</div>

			{/* MyJKKN could not be read — what is on screen is the last good list */}
			{showingRemembered && (
				<div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					<span>MyJKKN could not be read{age ? ` — showing the list read ${age}` : ''}. {loadError}</span>
					<Button variant="outline" size="sm" className="h-6 ml-auto text-xs" onClick={() => fetchData(true)} disabled={refreshing}>Try again</Button>
				</div>
			)}

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						{/* Row 1: Title */}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold font-heading">Knowledge Community Members</h2>
								<p className="text-xs text-muted-foreground">
									{filtered.length} member{filtered.length !== 1 ? 's' : ''}
									{hasFilters && members.length !== filtered.length ? ` of ${members.length}` : ''}
								</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
								<Info className="h-3.5 w-3.5" />
								<span className="hidden sm:inline">Everyone Active in MyJKKN is a member — nothing to add here</span>
								<span className="sm:hidden">From MyJKKN</span>
							</div>
						</div>

						{/* Row 2: Filters */}
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={view.cat} onValueChange={v => setFilter({ cat: v, prog: 'all' })}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Category" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Categories</SelectItem>
									{CATEGORIES.map(c => (
										<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={view.prog} onValueChange={v => setFilter({ prog: v })}>
								<SelectTrigger className="h-8 text-sm w-[240px]"><SelectValue placeholder="Programme / role" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">{view.cat === 'facilitator' ? 'All roles' : view.cat === 'learner' ? 'All programmes' : 'All programmes & roles'}</SelectItem>
									{programmeOptions.map(p => (
										<SelectItem key={p.label} value={p.label}>{p.label} <span className="text-muted-foreground">· {p.count}</span></SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 min-w-[200px] max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									ref={searchRef}
									placeholder="Name, number, email, programme…  ( / )"
									value={view.q}
									onChange={e => setFilter({ q: e.target.value })}
									onKeyDown={e => {
										if (e.key === 'Enter') { e.preventDefault(); openFromSearch() }
										if (e.key === 'Escape') { e.preventDefault(); setFilter({ q: '' }) }
									}}
									className="pl-8 pr-7 h-8 text-sm"
								/>
								{view.q && (
									<button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setFilter({ q: '' }); searchRef.current?.focus() }}>
										<X className="h-3.5 w-3.5" />
									</button>
								)}
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={exportList} disabled={filtered.length === 0}>
										<Download className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Download this list to Excel — {filtered.length} member{filtered.length !== 1 ? 's' : ''}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={() => fetchData(true)} disabled={refreshing}>
										<RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Read again from MyJKKN</TooltipContent>
							</Tooltip>
							{age && (
								<span className="text-[11px] text-muted-foreground whitespace-nowrap">Read from MyJKKN {age}</span>
							)}
						</div>

						{/* Row 3: what the library knows, as chips */}
						<div className="flex items-center gap-1.5 flex-wrap mt-2">
							{(['all', 'borrowed', 'fine', 'never'] as LibraryStatus[]).map(status => (
								<button
									key={status}
									type="button"
									onClick={() => setFilter({ lib: status })}
									className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
										view.lib === status
											? 'border-brand-green bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400 dark:border-brand-green-600'
											: 'border-border text-muted-foreground hover:bg-muted'
									}`}
								>
									{status === 'all' ? 'All' : LIBRARY_STATUS_LABELS[status]}
								</button>
							))}
							{/* The two faults, shown only while there is one to fix */}
							{scorecardData.nocard > 0 && (
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() => setFilter({ lib: view.lib === 'nocard' ? 'all' : 'nocard' })}
											className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
												view.lib === 'nocard'
													? 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300'
													: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700'
											}`}
										>
											<AlertTriangle className="inline h-3 w-3 mr-1 -mt-px" />No card number · {scorecardData.nocard}
										</button>
									</TooltipTrigger>
									<TooltipContent>No roll, register, application or staff number in MyJKKN — they cannot be scanned at the desk until one is given there</TooltipContent>
								</Tooltip>
							)}
							{scorecardData.duplicate > 0 && (
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() => setFilter({ lib: view.lib === 'duplicate' ? 'all' : 'duplicate' })}
											className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
												view.lib === 'duplicate'
													? 'border-destructive bg-destructive/15 text-destructive'
													: 'border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10'
											}`}
										>
											<AlertTriangle className="inline h-3 w-3 mr-1 -mt-px" />Duplicate number · {scorecardData.duplicate}
										</button>
									</TooltipTrigger>
									<TooltipContent>Two or more people answer to the same number — a book scanned against it could be issued to the wrong person. Fix in MyJKKN.</TooltipContent>
								</Tooltip>
							)}
						</div>
					</CardHeader>

					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* Desktop Table */}
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px] max-h-[600px] hidden md:block">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Member #</TableHead>
											<TableHead className="text-xs font-semibold">Name</TableHead>
											<TableHead className="text-xs font-semibold">Category</TableHead>
											<TableHead className="text-xs font-semibold">Role in MyJKKN</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">College</TableHead>}
											<TableHead className="text-xs font-semibold">Email</TableHead>
											<TableHead className="text-xs font-semibold">Library</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											Array.from({ length: 8 }, (_, i) => (
												<TableRow key={i}>
													<TableCell><Skeleton className="h-4 w-20" /></TableCell>
													<TableCell><div className="flex items-center gap-2.5"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-40" /></div></TableCell>
													<TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
													<TableCell><Skeleton className="h-4 w-48" /></TableCell>
													{mustSelectInstitution && <TableCell><Skeleton className="h-4 w-10" /></TableCell>}
													<TableCell><Skeleton className="h-4 w-52" /></TableCell>
													<TableCell><Skeleton className="h-4 w-8" /></TableCell>
												</TableRow>
											))
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Users className="h-8 w-8 opacity-20" />
														<span className="text-sm">{loadError && members.length === 0 ? loadError : 'No members found'}</span>
														<span className="text-xs">
															{loadError && members.length === 0
																? 'Members are read from MyJKKN — try again in a moment'
																: hasFilters ? 'Try clearing a filter' : 'Nobody Active in MyJKKN for this college'}
														</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(m => (
											<TableRow
												key={m.id}
												className="group cursor-pointer hover:bg-muted/50"
												onClick={() => open(m)}
												onKeyDown={e => { if (e.key === 'Enter') open(m) }}
												tabIndex={0}
											>
												<TableCell className="text-sm font-mono font-medium whitespace-nowrap">
													{m.member_number
														? <><span>{m.member_number}</span><CopyButton value={m.member_number} label="number" /></>
														: <Badge variant="outline" className="text-[10px] font-sans border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">No card</Badge>}
													{isDuplicate(m) && (
														<Tooltip>
															<TooltipTrigger asChild><AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-destructive" /></TooltipTrigger>
															<TooltipContent>Another member has this number too</TooltipContent>
														</Tooltip>
													)}
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-2.5">
														<LazyPhoto src={m.photo_url} name={m.display_name} className="h-7 w-7 text-[10px]" />
														<span className="text-sm font-medium truncate">{m.display_name}</span>
													</div>
												</TableCell>
												<TableCell><MemberCategoryBadge category={m.member_category as LibMemberCategory} /></TableCell>
												<TableCell className="text-sm text-muted-foreground">{m.role_label}</TableCell>
												{mustSelectInstitution && <TableCell className="text-sm">{institutionCodeOf.get(m.institution_id) ?? '—'}</TableCell>}
												<TableCell className="text-sm">
													{m.email ? <><span>{m.email}</span><CopyButton value={m.email} label="email" /></> : '—'}
												</TableCell>
												<TableCell><LibraryBadge member={m} /></TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>

						{/* Mobile Cards */}
						<div className="md:hidden mt-3 space-y-3 overflow-auto max-h-[600px]">
							{loading ? (
								<div className="space-y-3">
									{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<Users className="h-8 w-8 opacity-20" />
									<span className="text-sm">{loadError && members.length === 0 ? loadError : 'No members found'}</span>
								</div>
							) : paginated.map(m => (
								<button type="button" key={m.id} className="w-full text-left rounded-lg border p-4 space-y-2 hover:bg-muted/50" onClick={() => open(m)}>
									<div className="flex items-start gap-3">
										<LazyPhoto src={m.photo_url} name={m.display_name} className="h-9 w-9 text-xs" />
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">{m.display_name}</p>
											<p className="text-xs text-muted-foreground font-mono">
												{m.member_number || <span className="font-sans text-amber-700 dark:text-amber-400">No card number</span>}
												{isDuplicate(m) && <AlertTriangle className="inline h-3 w-3 ml-1 text-destructive" />}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<MemberCategoryBadge category={m.member_category as LibMemberCategory} />
										{m.is_delinquent && (
											<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Fine due</Badge>
										)}
										{mustSelectInstitution && <Badge variant="secondary" className="text-xs">{institutionCodeOf.get(m.institution_id) ?? '—'}</Badge>}
									</div>
									<p className="text-xs text-muted-foreground">{m.role_label}</p>
									{m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
								</button>
							))}
						</div>

						{/* Pagination */}
						<div className="flex flex-wrap items-center justify-between gap-2 pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground hidden sm:inline">Rows per page</span>
								<Select value={String(view.per)} onValueChange={v => setFilter({ per: Number(v) })}>
									<SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
									<SelectContent>
										{pageSizeOptions.map(n => (
											<SelectItem key={n} value={String(n)}>{n === filtered.length && n > 200 ? 'All' : n}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{filtered.length === 0 ? '0 of 0' : `${(currentPage - 1) * effectivePerPage + 1}–${Math.min(currentPage * effectivePerPage, filtered.length)} of ${filtered.length}`}
								</span>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} aria-label="Previous page">
									<ChevronLeft className="h-4 w-4" />
								</Button>
								{totalPages > 1 && (
									<span className="flex items-center gap-1 text-xs text-muted-foreground">
										<Input
											type="number"
											min={1}
											max={totalPages}
											value={currentPage}
											onChange={e => goToPage(Number(e.target.value) || 1)}
											className="h-7 w-14 text-xs text-center px-1"
											aria-label="Go to page"
										/>
										<span>/ {totalPages}</span>
									</span>
								)}
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Next page">
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>

				<MemberPanel
					member={openMember}
					institutionCode={openMember ? (institutionCodeOf.get(openMember.institution_id) ?? null) : null}
					deskReady={!mustSelectInstitution && !!institutionId}
					onClose={close}
				/>
			</TooltipProvider>
		</div>
	)
}
