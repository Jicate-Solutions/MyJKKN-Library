'use client'

/**
 * Stock Check — Knowledge Registry → Stock Check.
 *
 * Somebody walks the shelves with a scanner; every copy that answers is ticked
 * off the college's stock. What is left at the end is the pending list, which
 * is the only thing anybody actually wanted to know.
 *
 * Built for five or six people doing it at once, so the screen is arranged
 * around never making the person with the scanner wait:
 *
 *   * the box never blocks. A scan appears in the list the moment it is read,
 *     while the request is still on its way, and settles into Checked, Already
 *     checked or Not in this library when the answer lands.
 *   * the counts come from the server, not from this tab's own tally, because
 *     the other four people's scans count too.
 *   * a scan that dies on a weak signal is simply sent again. The round refuses
 *     a copy it has already seen, so sending twice can never count twice —
 *     which is what makes retrying safe here and not at the gate.
 *
 * Open to the assistant librarian, and to a temporary stock check helper who
 * has this page and nothing else.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useLibraryRole } from '@/hooks/use-library-role'
import { useToast } from '@/hooks/common/use-toast'
import { deskFetch } from '@/lib/library/desk-fetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { OverflowText } from '@/components/library/overflow-text'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import { CameraScanner } from '@/components/library/camera-scanner'
import { StockCheckHelpers } from '@/components/library/stock-check-helpers'
import {
	ClipboardCheck, RefreshCw, AlertTriangle, CheckCircle2, Copy, HelpCircle,
	Play, Lock, LockOpen, Loader2,
} from 'lucide-react'
import type { LibItemStatus } from '@/types/lib'

interface StockSession {
	id: string
	name: string
	status: 'open' | 'closed'
	started_by_name: string | null
	started_at: string
	closed_at: string | null
	closed_by_name: string | null
	scans?: number
}

interface StockProgress {
	total: number
	checked: number
	pending: number
	unknown: number
}

interface RecentScan {
	id: string
	accession_number: string
	outcome: 'checked' | 'unknown'
	title: string | null
	item_status: string | null
	scanned_by_name: string | null
	scanned_at: string
}

interface PendingItem {
	id: string
	accession_number: string | null
	status: LibItemStatus
	catalogue: { id: string; title: string | null; author: string | null } | null
}

interface UnknownScan {
	id: string
	accession_number: string
	scanned_by_name: string | null
	scanned_at: string
}

/** One line in the live feed: a scan of this tab's own, at whatever stage. */
interface FeedLine {
	key: string
	scanned: string
	state: 'sending' | 'checked' | 'repeat' | 'unknown' | 'failed'
	title: string | null
	itemStatus: string | null
	firstBy: string | null
	error: string | null
}

interface ScanReply {
	results?: {
		scanned: string
		accession_number: string | null
		outcome: 'checked' | 'repeat' | 'unknown'
		title: string | null
		item_status: string | null
		first_by: string | null
	}[]
	error?: string
}

/** The server is asked again this often, so the other scanners' work shows up. */
const REFRESH_MS = 15_000

/** And this soon after a scan of our own, which is what the person is waiting for. */
const AFTER_SCAN_MS = 1_500

/** Long enough for a slow phone signal, short enough to try again inside a scan. */
const SCAN_TIMEOUT_MS = 12_000

/** The feed is a running record of this session at the shelf, not a report. */
const FEED_LINES = 150

const stamp = new Intl.DateTimeFormat('en-IN', {
	timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function when(value: string | null): string {
	return value ? stamp.format(new Date(value)) : '—'
}

/** What a new round is called unless the library says otherwise. */
function defaultName(): string {
	const now = new Date()
	return `Stock check ${MONTHS[now.getMonth()]} ${now.getFullYear()}`
}

function numbersIn(text: string): string[] {
	return [...new Set(text.split(/[\s,;]+/).map(n => n.trim()).filter(Boolean))]
}

/** A short buzz when a scan is not a clean tick — the phone in a quiet stack room. */
function buzz(pattern: number | number[]) {
	try {
		navigator.vibrate?.(pattern)
	} catch {
		// Not every browser has it, and none of this depends on it
	}
}

function StateBadge({ line }: { line: FeedLine }) {
	if (line.state === 'sending') {
		return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Sending</span>
	}
	if (line.state === 'checked') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-green dark:text-brand-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Checked</span>
	}
	if (line.state === 'repeat') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><Copy className="h-3.5 w-3.5" /> Already checked</span>
	}
	if (line.state === 'unknown') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><HelpCircle className="h-3.5 w-3.5" /> Not in this library</span>
	}
	return <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Not sent</span>
}

/**
 * The last few scans, small enough to sit under the camera picture.
 *
 * On a phone the camera dialog is the whole screen, so without this the person
 * counting a shelf cannot see whether the book they just pointed at was
 * counted, already counted, or not in this library at all.
 */
function CameraFeed({ lines }: { lines: FeedLine[] }) {
	if (lines.length === 0) {
		return <p className="text-xs text-muted-foreground">Point the camera at a book to start</p>
	}

	return (
		<ul className="space-y-1">
			{lines.slice(0, 6).map(line => (
				<li key={line.key} className="flex items-center justify-between gap-2 text-xs">
					<span className="shrink-0 font-mono">{line.scanned}</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground">{line.title ?? ''}</span>
					<StateBadge line={line} />
				</li>
			))}
		</ul>
	)
}

export default function StockCheckPage() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	// A temporary helper may scan, and nothing else — so they are not offered a
	// Start or a Close button that the API would refuse them anyway.
	const { limitedToPages: helperOnly, role } = useLibraryRole()
	const { toast } = useToast()

	const [sessions, setSessions] = useState<StockSession[]>([])
	const [sessionId, setSessionId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [setupError, setSetupError] = useState<string | null>(null)

	const [newName, setNewName] = useState(defaultName)
	const [starting, setStarting] = useState(false)
	const [closing, setClosing] = useState(false)
	const [confirmClose, setConfirmClose] = useState(false)

	const [progress, setProgress] = useState<StockProgress | null>(null)
	const [recent, setRecent] = useState<RecentScan[]>([])
	const [feed, setFeed] = useState<FeedLine[]>([])

	const [tab, setTab] = useState('feed')
	const [pending, setPending] = useState<PendingItem[]>([])
	const [pendingPage, setPendingPage] = useState(0)
	const [pendingTotal, setPendingTotal] = useState(0)
	const [pendingMore, setPendingMore] = useState(false)
	const [pendingLoading, setPendingLoading] = useState(false)
	const [unknown, setUnknown] = useState<UnknownScan[]>([])

	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const session = useMemo(() => sessions.find(s => s.id === sessionId) ?? null, [sessions, sessionId])
	const isOpen = session?.status === 'open'

	// ── The rounds ────────────────────────────────────────────────────────────

	const loadSessions = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			const res = await fetch(appendToUrl('/api/lib/stock/sessions'))
			const body = await res.json()
			if (!res.ok) {
				setSetupError(body.error ?? 'Could not load the stock checks')
				setSessions([])
				return
			}
			setSetupError(null)
			const list: StockSession[] = body.data ?? []
			setSessions(list)
			// The open round is the one being worked on; failing that, the newest
			setSessionId(previous =>
				(previous && list.some(s => s.id === previous))
					? previous
					: (list.find(s => s.status === 'open') ?? list[0])?.id ?? null
			)
		} catch {
			setSetupError('Could not load the stock checks')
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, appendToUrl])

	useEffect(() => { void loadSessions() }, [loadSessions])

	// Another college's round, feed and lists must not linger after switching
	useEffect(() => {
		setFeed([])
		setProgress(null)
		setRecent([])
		setPending([])
		setUnknown([])
	}, [institutionId])

	// ── The counts ────────────────────────────────────────────────────────────

	const loadProgress = useCallback(async (id: string) => {
		try {
			const res = await fetch(`/api/lib/stock/sessions/${id}`)
			const body = await res.json()
			if (!res.ok) return
			setProgress(body.progress ?? null)
			setRecent(body.recent ?? [])
		} catch {
			// A missed refresh is nothing: the next one is seconds away, and the
			// scan box has never depended on it.
		}
	}, [])

	useEffect(() => {
		if (!sessionId) return
		void loadProgress(sessionId)
		const timer = setInterval(() => { void loadProgress(sessionId) }, REFRESH_MS)
		return () => clearInterval(timer)
	}, [sessionId, loadProgress])

	/** Asked again shortly after our own scan, without stacking up requests. */
	const refreshSoon = useCallback((id: string) => {
		if (refreshTimer.current) clearTimeout(refreshTimer.current)
		refreshTimer.current = setTimeout(() => { void loadProgress(id) }, AFTER_SCAN_MS)
	}, [loadProgress])

	useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }, [])

	// ── Scanning ──────────────────────────────────────────────────────────────

	const settle = useCallback((keys: string[], apply: (key: string, index: number) => Partial<FeedLine>) => {
		setFeed(prev => prev.map(line => {
			const index = keys.indexOf(line.key)
			return index === -1 ? line : { ...line, ...apply(line.key, index) }
		}))
	}, [])

	const send = useCallback(async (numbers: string[], keys: string[], id: string) => {
		try {
			const res = await deskFetch('/api/lib/stock/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, session_id: id, numbers }),
				timeoutMs: SCAN_TIMEOUT_MS,
				// Safe to repeat: a round counts a copy once, however many times it
				// is sent. See the note at the top of the scan route.
				retries: 2,
			})
			const body: ScanReply = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not save the scan')

			const byNumber = new Map((body.results ?? []).map(r => [r.scanned, r]))
			settle(keys, (_key, index) => {
				const result = byNumber.get(numbers[index])
				if (!result) return { state: 'failed', error: 'No answer for this number' }
				return {
					state: result.outcome,
					title: result.title,
					itemStatus: result.item_status,
					firstBy: result.first_by,
					error: null,
				}
			})

			const results = body.results ?? []
			if (results.some(r => r.outcome !== 'checked')) buzz([40, 60, 40])
			refreshSoon(id)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not save the scan'
			settle(keys, () => ({ state: 'failed', error: message }))
			buzz([40, 60, 40])
		}
	}, [institutionId, settle, refreshSoon])

	/**
	 * A copy is ticked by reading its barcode and no other way.
	 *
	 * There was a box here to type the number into, and it is gone on purpose:
	 * a stock check is a count of what is actually on the shelf, and a number
	 * typed from memory or copied off a list is exactly the thing a count is
	 * supposed to catch. The camera has to see the book.
	 */
	const scan = useCallback((text: string) => {
		const numbers = numbersIn(text)
		if (numbers.length === 0 || !sessionId || !isOpen) return

		const batch = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
		const keys = numbers.map((n, i) => `${batch}-${i}-${n}`)

		// On screen before the request leaves, so the next book can be picked up
		setFeed(prev => [
			...numbers.map((scanned, i) => ({
				key: keys[i], scanned, state: 'sending' as const,
				title: null, itemStatus: null, firstBy: null, error: null,
			})),
			...prev,
		].slice(0, FEED_LINES))

		void send(numbers, keys, sessionId)
	}, [sessionId, isOpen, send])

	/** One line sent again by hand, after the network let it down. */
	const retry = useCallback((line: FeedLine) => {
		if (!sessionId) return
		settle([line.key], () => ({ state: 'sending', error: null }))
		void send([line.scanned], [line.key], sessionId)
	}, [sessionId, send, settle])

	// ── Starting and closing a round ──────────────────────────────────────────

	const start = async () => {
		if (!institutionId || !newName.trim()) return
		try {
			setStarting(true)
			const res = await fetch('/api/lib/stock/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, name: newName.trim() }),
			})
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not start the stock check')

			setSessions(prev => [body.data, ...prev])
			setSessionId(body.data.id)
			setFeed([])
			setProgress(null)
			toast({
				title: `${body.data.name} started`,
				description: 'Every copy starts unchecked — scan away',
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
		} catch (error) {
			toast({ title: error instanceof Error ? error.message : 'Could not start the stock check', variant: 'destructive' })
		} finally {
			setStarting(false)
		}
	}

	const setStatus = async (status: 'open' | 'closed') => {
		if (!sessionId) return
		try {
			setClosing(true)
			const res = await fetch('/api/lib/stock/sessions', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sessionId, status }),
			})
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not update the stock check')

			setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, ...body.data } : s)))
			setConfirmClose(false)
			toast({
				title: status === 'closed' ? 'Stock check closed' : 'Stock check open again',
				description: status === 'closed' ? 'Everything it counted is kept' : undefined,
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
		} catch (error) {
			toast({ title: error instanceof Error ? error.message : 'Could not update the stock check', variant: 'destructive' })
		} finally {
			setClosing(false)
		}
	}

	// ── The two lists ─────────────────────────────────────────────────────────

	const loadPending = useCallback(async (id: string, page: number) => {
		try {
			setPendingLoading(true)
			const res = await fetch(`/api/lib/stock/sessions/${id}?view=pending&page=${page}`)
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not load the pending list')
			setPending(prev => (page === 0 ? body.data ?? [] : [...prev, ...(body.data ?? [])]))
			setPendingTotal(body.total ?? 0)
			setPendingMore(Boolean(body.has_more))
			setPendingPage(page)
		} catch (error) {
			toast({ title: error instanceof Error ? error.message : 'Could not load the pending list', variant: 'destructive' })
		} finally {
			setPendingLoading(false)
		}
	}, [toast])

	const loadUnknown = useCallback(async (id: string) => {
		try {
			const res = await fetch(`/api/lib/stock/sessions/${id}?view=unknown`)
			const body = await res.json()
			if (res.ok) setUnknown(body.data ?? [])
		} catch {
			// The count beside the tab already says there are some
		}
	}, [])

	useEffect(() => {
		if (!sessionId) return
		if (tab === 'pending' && pending.length === 0) void loadPending(sessionId, 0)
		if (tab === 'unknown' && unknown.length === 0) void loadUnknown(sessionId)
		// Only when the tab is opened; the lists are not what the scanner waits on
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab, sessionId])

	const done = progress && progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0

	// ── The screen ────────────────────────────────────────────────────────────

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Header */}
			<div className="flex-shrink-0">
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-50 dark:bg-brand-green-900/30">
						<ClipboardCheck className="h-5 w-5 text-brand-green dark:text-brand-green-400" />
					</div>
					<div className="min-w-0">
						<h1 className="text-base font-semibold">Stock Check</h1>
						<p className="text-xs text-muted-foreground">
							Scan the shelves — everyone scanning into the same round counts together, and a copy already seen is never counted twice
						</p>
					</div>
				</div>
			</div>

			{isReady && !institutionId ? (
				<Card>
					<CardContent className="py-12 text-center text-sm text-muted-foreground">
						Select an institution to run its stock check
					</CardContent>
				</Card>
			) : setupError ? (
				<Card>
					<CardContent className="py-10">
						<div className="mx-auto flex max-w-lg items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{setupError}</span>
						</div>
					</CardContent>
				</Card>
			) : (
				<>
					{/* The round */}
					<Card className="flex-shrink-0">
						<CardContent className="p-4">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
								<div className="min-w-0 space-y-1.5">
									<label className="text-xs font-medium text-muted-foreground">Stock check round</label>
									{sessions.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											{loading ? 'Loading…' : helperOnly
												? 'No stock check has been started yet — ask the librarian to start one'
												: 'No stock check yet — start the first one'}
										</p>
									) : (
										<Select value={sessionId ?? undefined} onValueChange={setSessionId}>
											<SelectTrigger className="h-11 w-full sm:w-[320px] text-sm">
												<SelectValue placeholder="Pick a round" />
											</SelectTrigger>
											<SelectContent>
												{sessions.map(s => (
													<SelectItem key={s.id} value={s.id}>
														{s.name} — {s.status === 'open' ? 'open' : 'closed'}
														{typeof s.scans === 'number' ? ` · ${s.scans} scanned` : ''}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
									{session && (
										<p className="text-xs text-muted-foreground">
											Started {when(session.started_at)}
											{session.started_by_name ? ` by ${session.started_by_name}` : ''}
											{session.status === 'closed' && session.closed_at ? ` · closed ${when(session.closed_at)}` : ''}
										</p>
									)}
								</div>

								{!helperOnly && (
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
										{session && (
											session.status === 'open' ? (
												<Button variant="outline" className="h-11 sm:h-9 text-sm" onClick={() => setConfirmClose(true)} disabled={closing}>
													<Lock className="mr-1.5 h-4 w-4" />
													Close round
												</Button>
											) : (
												<Button variant="outline" className="h-11 sm:h-9 text-sm" onClick={() => { void setStatus('open') }} disabled={closing}>
													<LockOpen className="mr-1.5 h-4 w-4" />
													Open again
												</Button>
											)
										)}
										<div className="flex gap-2">
											<Input
												value={newName}
												onChange={e => setNewName(e.target.value)}
												placeholder="New round name"
												className="h-11 sm:h-9 w-full sm:w-[200px] text-sm"
												aria-label="New stock check name"
											/>
											<Button
												className="h-11 sm:h-9 shrink-0 bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
												onClick={() => { void start() }}
												disabled={starting || !newName.trim()}
											>
												<Play className="mr-1.5 h-4 w-4" />
												Start
											</Button>
										</div>
									</div>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Who else may scan. A super admin's to decide, and only theirs —
					    the route refuses everybody else as well, because a helper can
					    read anything under /api/lib/stock and a hidden button has
					    never shut a door. */}
					{role === 'super_admin' && institutionId && (
						<StockCheckHelpers institutionId={institutionId} />
					)}

					{session && (
						<>
							{/* Where the round has got to */}
							<Card className="flex-shrink-0">
								<CardContent className="p-4 space-y-3">
									<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
										{[
											{ label: 'Copies in stock', value: progress?.total ?? null },
											{ label: 'Checked', value: progress?.checked ?? null, tone: 'text-brand-green dark:text-brand-green-400' },
											{ label: 'Still to find', value: progress?.pending ?? null, tone: 'text-amber-700 dark:text-amber-400' },
											{ label: 'Unknown numbers', value: progress?.unknown ?? null },
										].map(card => (
											<div key={card.label} className="rounded-lg border p-3">
												<p className="text-xs text-muted-foreground">{card.label}</p>
												<p className={`text-xl font-semibold ${card.tone ?? ''}`}>
													{card.value === null ? '—' : card.value.toLocaleString('en-IN')}
												</p>
											</div>
										))}
									</div>
									<div className="space-y-1">
										<Progress value={done} className="h-2" />
										<p className="text-xs text-muted-foreground">
											{done}% of this college&apos;s copies seen in this round
										</p>
									</div>
								</CardContent>
							</Card>

							{/* The scan box */}
							<Card className="flex-shrink-0">
								<CardHeader className="border-b px-4 py-3">
									<h2 className="text-base font-semibold">Scan</h2>
									<p className="text-xs text-muted-foreground">
										Open the camera and point it at each book&apos;s barcode — it keeps counting until you press Done
									</p>
								</CardHeader>
								{/* The phone in the stacks, and the only way in. Opened once, it
								    keeps reading until Done is pressed, and a book it has already
								    read this time round is never sent twice. */}
								<CardContent className="p-4">
									{isOpen ? (
										<CameraScanner
											continuous
											className="h-14 w-full text-base"
											buttonText="Scan a book"
											label="Point the camera at each book's barcode — it keeps counting until you press Done"
											onScan={scan}
											feed={<CameraFeed lines={feed} />}
										/>
									) : (
										<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
											<Lock className="mt-0.5 h-4 w-4 shrink-0" />
											<span>
												This round is closed. {helperOnly ? 'Ask the librarian to open it again.' : 'Open it again to carry on scanning.'}
											</span>
										</div>
									)}
								</CardContent>
							</Card>

							{/* What has been seen */}
							<Card className="flex min-h-0 flex-1 flex-col">
								<CardContent className="p-4">
									<div className="min-w-0">
										<Tabs value={tab} onValueChange={setTab} className="w-full">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<TabsList>
													<TabsTrigger value="feed" className="text-xs sm:text-sm">My scans</TabsTrigger>
													<TabsTrigger value="all" className="text-xs sm:text-sm">Everyone&apos;s</TabsTrigger>
													<TabsTrigger value="pending" className="text-xs sm:text-sm">
														Still to find{progress ? ` (${progress.pending.toLocaleString('en-IN')})` : ''}
													</TabsTrigger>
													<TabsTrigger value="unknown" className="text-xs sm:text-sm">
														Unknown{progress && progress.unknown > 0 ? ` (${progress.unknown})` : ''}
													</TabsTrigger>
												</TabsList>
												<Button
													variant="outline"
													size="icon"
													className="h-9 w-9 shrink-0 p-0"
													onClick={() => {
														if (!sessionId) return
														void loadProgress(sessionId)
														if (tab === 'pending') void loadPending(sessionId, 0)
														if (tab === 'unknown') void loadUnknown(sessionId)
													}}
													aria-label="Refresh"
												>
													<RefreshCw className="h-4 w-4" />
												</Button>
											</div>

											{/* This tab's own scans, newest first */}
											<TabsContent value="feed" className="mt-3">
												<div className="max-h-[420px] overflow-y-auto rounded-md border">
													<Table>
														<TableHeader className="sticky top-0 z-10 bg-muted/50">
															<TableRow>
																<TableHead className="text-xs font-semibold">Number</TableHead>
																<TableHead className="text-xs font-semibold">Title</TableHead>
																<TableHead className="text-xs font-semibold">Result</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{feed.length === 0 ? (
																<TableRow>
																	<TableCell colSpan={3} className="h-28 text-center text-sm text-muted-foreground">
																		Nothing scanned on this device yet
																	</TableCell>
																</TableRow>
															) : feed.map(line => (
																<TableRow key={line.key} className="hover:bg-muted/50">
																	<TableCell className="whitespace-nowrap font-mono text-sm">{line.scanned}</TableCell>
																	<TableCell className="max-w-[260px]">
																		<OverflowText as="div" text={line.title ?? '—'} className="text-sm" />
																		{line.firstBy && (
																			<p className="text-xs text-muted-foreground">already by {line.firstBy}</p>
																		)}
																		{line.error && <p className="text-xs text-destructive">{line.error}</p>}
																	</TableCell>
																	<TableCell className="whitespace-nowrap">
																		<div className="flex items-center gap-2">
																			<StateBadge line={line} />
																			{line.state === 'failed' && (
																				<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => retry(line)}>
																					Try again
																				</Button>
																			)}
																		</div>
																	</TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												</div>
											</TabsContent>

											{/* Everybody's, from the server */}
											<TabsContent value="all" className="mt-3">
												<div className="max-h-[420px] overflow-y-auto rounded-md border">
													<Table>
														<TableHeader className="sticky top-0 z-10 bg-muted/50">
															<TableRow>
																<TableHead className="text-xs font-semibold">Number</TableHead>
																<TableHead className="text-xs font-semibold">Title</TableHead>
																<TableHead className="text-xs font-semibold">Scanned by</TableHead>
																<TableHead className="text-xs font-semibold">At</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{recent.length === 0 ? (
																<TableRow>
																	<TableCell colSpan={4} className="h-28 text-center text-sm text-muted-foreground">
																		No scans in this round yet
																	</TableCell>
																</TableRow>
															) : recent.map(row => (
																<TableRow key={row.id} className="hover:bg-muted/50">
																	<TableCell className="whitespace-nowrap font-mono text-sm">{row.accession_number}</TableCell>
																	<TableCell className="max-w-[260px]">
																		<OverflowText as="div" text={row.title ?? (row.outcome === 'unknown' ? 'Not in this library' : '—')} className="text-sm" />
																	</TableCell>
																	<TableCell className="whitespace-nowrap text-sm">{row.scanned_by_name ?? '—'}</TableCell>
																	<TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(row.scanned_at)}</TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												</div>
											</TabsContent>

											{/* What the round has not seen */}
											<TabsContent value="pending" className="mt-3 space-y-2">
												<div className="max-h-[420px] overflow-y-auto rounded-md border">
													<Table>
														<TableHeader className="sticky top-0 z-10 bg-muted/50">
															<TableRow>
																<TableHead className="text-xs font-semibold">Accession No</TableHead>
																<TableHead className="text-xs font-semibold">Title</TableHead>
																<TableHead className="text-xs font-semibold">Status</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{pending.length === 0 ? (
																<TableRow>
																	<TableCell colSpan={3} className="h-28 text-center text-sm text-muted-foreground">
																		{pendingLoading ? 'Loading…' : 'Nothing left to find'}
																	</TableCell>
																</TableRow>
															) : pending.map(item => (
																<TableRow key={item.id} className="hover:bg-muted/50">
																	<TableCell className="whitespace-nowrap font-mono text-sm">{item.accession_number}</TableCell>
																	<TableCell className="max-w-[280px]">
																		{item.catalogue?.id ? (
																			<Link href={`/registry/${item.catalogue.id}`} className="block min-w-0 hover:underline">
																				<OverflowText as="div" text={item.catalogue.title ?? 'Unknown title'} className="text-sm font-medium" />
																			</Link>
																		) : (
																			<OverflowText as="div" text={item.catalogue?.title ?? 'Unknown title'} className="text-sm font-medium" />
																		)}
																	</TableCell>
																	<TableCell><ResourceStatusBadge status={item.status} /></TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												</div>
												<div className="flex items-center justify-between gap-2">
													<p className="text-xs text-muted-foreground">
														Showing {pending.length.toLocaleString('en-IN')} of {pendingTotal.toLocaleString('en-IN')}
													</p>
													{pendingMore && (
														<Button
															variant="outline"
															size="sm"
															className="h-9 text-sm"
															onClick={() => { if (sessionId) void loadPending(sessionId, pendingPage + 1) }}
															disabled={pendingLoading}
														>
															{pendingLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
															Load more
														</Button>
													)}
												</div>
											</TabsContent>

											{/* Numbers nobody can account for */}
											<TabsContent value="unknown" className="mt-3">
												<div className="max-h-[420px] overflow-y-auto rounded-md border">
													<Table>
														<TableHeader className="sticky top-0 z-10 bg-muted/50">
															<TableRow>
																<TableHead className="text-xs font-semibold">Number</TableHead>
																<TableHead className="text-xs font-semibold">Scanned by</TableHead>
																<TableHead className="text-xs font-semibold">At</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{unknown.length === 0 ? (
																<TableRow>
																	<TableCell colSpan={3} className="h-28 text-center text-sm text-muted-foreground">
																		Every number scanned is a copy in this library
																	</TableCell>
																</TableRow>
															) : unknown.map(row => (
																<TableRow key={row.id} className="hover:bg-muted/50">
																	<TableCell className="whitespace-nowrap font-mono text-sm">{row.accession_number}</TableCell>
																	<TableCell className="whitespace-nowrap text-sm">{row.scanned_by_name ?? '—'}</TableCell>
																	<TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(row.scanned_at)}</TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												</div>
											</TabsContent>
										</Tabs>
									</div>
								</CardContent>
							</Card>
						</>
					)}
				</>
			)}

			{/* Confirm: close the round */}
			<AlertDialog open={confirmClose} onOpenChange={o => { if (!closing) setConfirmClose(o) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">Close this stock check?</AlertDialogTitle>
						<AlertDialogDescription>
							No more scans can be added until it is opened again. Everything it counted is kept, and
							nothing about the copies themselves changes — marking what was never found is done by
							hand on the Missing Books page.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={e => { e.preventDefault(); void setStatus('closed') }}
							disabled={closing}
							className="bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
						>
							{closing ? 'Closing…' : 'Close round'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
