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
import { useBorrowedCollege } from '@/hooks/use-borrowed-college'
import { useToast } from '@/hooks/common/use-toast'
import { deskFetch } from '@/lib/library/desk-fetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
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
import { StockCheckTable, type StockColumn, type StockFacet } from '@/components/library/stock-check-table'
import {
	ClipboardCheck, RefreshCw, AlertTriangle, CheckCircle2, Copy, HelpCircle,
	Play, Lock, LockOpen, Loader2, CloudOff, UploadCloud, BookCopy, ScanSearch,
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

/** One line in the live feed: a scan of this tab's own, at whatever stage. */
interface FeedLine {
	key: string
	scanned: string
	/** `queued`: saved on this phone, to be sent when the internet is back */
	state: 'sending' | 'queued' | 'checked' | 'repeat' | 'unknown' | 'failed'
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

/**
 * And this long after the last scan of our own. The counts on screen already
 * moved when the scan was answered, so this only folds in the other scanners —
 * waiting for a pause keeps the recount off the line while the shelf is being
 * counted, where it would be queued alongside every book.
 */
const AFTER_SCAN_MS = 5_000

/**
 * Long enough for a slow phone signal. Past it the scan is not lost: it goes
 * to the outbox on the phone and is sent again from there.
 */
const SCAN_TIMEOUT_MS = 8_000

/** How often a waiting outbox is tried again, besides the browser saying "online". */
const OUTBOX_RETRY_MS = 8_000

/** The most numbers the scan route takes in one request. */
const OUTBOX_BATCH = 200

/** Where scans wait on the phone while the internet is away. Survives a reload. */
const OUTBOX_KEY = 'lib-stock-outbox'

/** One scan that has not reached the server yet. */
interface OutboxEntry {
	key: string
	scanned: string
	sessionId: string
	institutionId: string
}

function loadOutbox(): OutboxEntry[] {
	try {
		const raw = localStorage.getItem(OUTBOX_KEY)
		const list = raw ? JSON.parse(raw) : []
		return Array.isArray(list) ? list.filter(e => e?.key && e?.scanned && e?.sessionId && e?.institutionId) : []
	} catch {
		return []
	}
}

function saveOutbox(entries: OutboxEntry[]) {
	try {
		if (entries.length === 0) localStorage.removeItem(OUTBOX_KEY)
		else localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries))
	} catch {
		// Private mode or a full disk: the scans still wait in memory until sent
	}
}

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
	if (line.state === 'queued') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400"><CloudOff className="h-3.5 w-3.5" /> Saved offline</span>
	}
	if (line.state === 'checked') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-green dark:text-brand-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Checked</span>
	}
	if (line.state === 'repeat') {
		return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><Copy className="h-3.5 w-3.5" /> Already checked</span>
	}
	if (line.state === 'unknown') {
		return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" /> Skipped — not in this library</span>
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
function CameraFeed({ lines, queued }: { lines: FeedLine[]; queued: number }) {
	if (lines.length === 0) {
		return <p className="text-xs text-muted-foreground">Point the camera at a book to start</p>
	}

	return (
		<ul className="space-y-1">
			{queued > 0 && (
				<li className="flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400">
					<CloudOff className="h-3.5 w-3.5" />
					{queued} saved on this phone — sent when the internet is back
				</li>
			)}
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

/** What each line in My scans came to, in words — the filter and the report. */
const FEED_LABEL: Record<FeedLine['state'], string> = {
	sending: 'Sending',
	queued: 'Saved offline',
	checked: 'Checked',
	repeat: 'Already checked',
	unknown: 'Skipped — not in this library',
	failed: 'Not sent',
}

/** The coloured edge down each line of My scans. */
const FEED_TONE: Record<FeedLine['state'], string> = {
	sending: 'border-l-muted-foreground/30',
	queued: 'border-l-sky-400',
	checked: 'border-l-emerald-500',
	repeat: 'border-l-brand-yellow-700',
	unknown: 'border-l-muted-foreground/40',
	failed: 'border-l-red-500',
}

const FEED_FACET: StockFacet<FeedLine> = {
	label: 'Results',
	options: (['checked', 'repeat', 'unknown', 'queued', 'failed'] as const)
		.map(state => ({ value: state, label: FEED_LABEL[state] })),
	get: line => line.state,
}

function statusLabel(status: string): string {
	return status.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

function count(value: number | null | undefined): string {
	return value === null || value === undefined ? '—' : value.toLocaleString('en-IN')
}

const SCAN_COLUMNS: StockColumn<RecentScan>[] = [
	{
		key: 'number',
		header: 'Number',
		cell: row => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.accession_number}</span>,
		sort: row => row.accession_number,
		excel: row => row.accession_number,
	},
	{
		key: 'title',
		header: 'Title',
		className: 'max-w-[140px] sm:max-w-[320px]',
		cell: row => <OverflowText as="div" text={row.title ?? '—'} className="text-sm" />,
		sort: row => row.title ?? '',
		excel: row => row.title ?? '',
	},
	{
		key: 'by',
		header: 'Scanned by',
		cell: row => (
			<div className="whitespace-nowrap text-sm">
				<span className="inline-flex items-center rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-300">
					{row.scanned_by_name ?? '—'}
				</span>
				<p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{when(row.scanned_at)}</p>
			</div>
		),
		sort: row => row.scanned_by_name ?? '',
		excel: row => row.scanned_by_name ?? '',
	},
	{
		key: 'at',
		header: 'At',
		hideOnMobile: true,
		cell: row => <span className="whitespace-nowrap text-xs text-muted-foreground">{when(row.scanned_at)}</span>,
		sort: row => row.scanned_at,
		excel: row => when(row.scanned_at),
	},
]

const PENDING_COLUMNS: StockColumn<PendingItem>[] = [
	{
		key: 'accession',
		header: 'Accession No',
		cell: item => <span className="whitespace-nowrap font-mono text-sm font-medium">{item.accession_number ?? '—'}</span>,
		sort: item => item.accession_number ?? '',
		excel: item => item.accession_number ?? '',
	},
	{
		key: 'title',
		header: 'Title',
		className: 'max-w-[160px] sm:max-w-[320px]',
		cell: item => item.catalogue?.id ? (
			<Link href={`/registry/${item.catalogue.id}`} className="block min-w-0 hover:underline">
				<OverflowText as="div" text={item.catalogue.title ?? 'Unknown title'} className="text-sm font-medium" />
			</Link>
		) : (
			<OverflowText as="div" text={item.catalogue?.title ?? 'Unknown title'} className="text-sm font-medium" />
		),
		sort: item => item.catalogue?.title ?? '',
		excel: item => item.catalogue?.title ?? '',
	},
	{
		key: 'author',
		header: 'Author',
		hideOnMobile: true,
		className: 'max-w-[200px]',
		cell: item => <OverflowText as="div" text={item.catalogue?.author ?? '—'} className="text-sm text-muted-foreground" />,
		sort: item => item.catalogue?.author ?? '',
		excel: item => item.catalogue?.author ?? '',
	},
	{
		key: 'status',
		header: 'Status',
		cell: item => <ResourceStatusBadge status={item.status} />,
		sort: item => item.status,
		excel: item => statusLabel(item.status),
	},
]

export default function StockCheckPage() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	// A temporary helper may scan, and nothing else — so they are not offered a
	// Start or a Close button that the API would refuse them anyway.
	const { limitedToPages, role } = useLibraryRole()
	// Lent to this college for the counting: they scan, and the round is
	// somebody else's to start and to close — the same as a helper who has no
	// library role at all, which is what `helperOnly` has always meant here.
	const borrowed = useBorrowedCollege()
	const helperOnly = limitedToPages || borrowed
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
	const [pendingLoading, setPendingLoading] = useState(false)
	const [scans, setScans] = useState<RecentScan[]>([])
	const [scansLoading, setScansLoading] = useState(false)

	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Scans the server has not got yet, kept on the phone
	const outboxRef = useRef<OutboxEntry[]>([])
	const flushingRef = useRef(false)
	const [queued, setQueued] = useState(0)
	const [flushing, setFlushing] = useState(false)
	const [online, setOnline] = useState(true)

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
		// …except this college's scans still waiting on the phone, from before a
		// reload or a dropped signal, which come back as they were
		outboxRef.current = loadOutbox()
		const waiting = outboxRef.current.filter(entry => entry.institutionId === institutionId)
		setQueued(waiting.length)
		setFeed(waiting.slice(-FEED_LINES).reverse().map(entry => ({
			key: entry.key, scanned: entry.scanned, state: 'queued' as const,
			title: null, itemStatus: null, firstBy: null, error: null,
		})))
		setProgress(null)
		setRecent([])
		setPending([])
	}, [institutionId])

	// ── The counts ────────────────────────────────────────────────────────────

	const loadProgress = useCallback(async (id: string) => {
		try {
			const res = await fetch(`/api/lib/stock/sessions/${id}`)
			const body = await res.json()
			if (!res.ok) return
			const server: StockProgress | null = body.progress ?? null
			// An open round only ever counts up. A recount that left before our
			// latest scans landed would pull the number back for a moment, so the
			// higher of the two is kept until the server catches up.
			setProgress(prev => {
				if (!server || !prev) return server
				const checked = Math.max(server.checked, prev.checked)
				return {
					total: server.total,
					checked,
					pending: Math.max(0, server.total - checked),
				}
			})
			setRecent(body.recent ?? [])
		} catch {
			// A missed refresh is nothing: the next one is seconds away, and the
			// scan box has never depended on it.
		}
	}, [])

	useEffect(() => {
		if (!sessionId) return
		// Another round's counts must not be kept as the "higher" ones, nor its lists
		setProgress(null)
		setScans([])
		setPending([])
		loadedFor.current = { scans: null, pending: null }
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

	// ── Saved on the phone while the internet is away ─────────────────────────

	/** Puts scans in the outbox, kept across a reload, and says so on their lines. */
	const queue = useCallback((numbers: string[], keys: string[], id: string) => {
		if (!institutionId) return
		const have = new Set(outboxRef.current.map(entry => entry.key))
		const added = numbers
			.map((scanned, i) => ({ key: keys[i], scanned, sessionId: id, institutionId }))
			.filter(entry => !have.has(entry.key))
		if (added.length > 0) {
			outboxRef.current = [...outboxRef.current, ...added]
			saveOutbox(outboxRef.current)
			setQueued(outboxRef.current.filter(entry => entry.institutionId === institutionId).length)
		}
		settle(keys, () => ({ state: 'queued', error: null }))
	}, [institutionId, settle])

	/** Takes scans out of the outbox once the server has them, or has refused them. */
	const unqueue = useCallback((keys: string[]) => {
		if (!outboxRef.current.some(entry => keys.includes(entry.key))) return
		outboxRef.current = outboxRef.current.filter(entry => !keys.includes(entry.key))
		saveOutbox(outboxRef.current)
		setQueued(outboxRef.current.filter(entry => entry.institutionId === institutionId).length)
	}, [institutionId])

	const send = useCallback(async (numbers: string[], keys: string[], id: string) => {
		// No network at all: straight into the outbox, without waiting on a
		// request that cannot leave — the next book is already in shot.
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			queue(numbers, keys, id)
			return
		}

		let res: Response
		let body: ScanReply
		try {
			res = await deskFetch('/api/lib/stock/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, session_id: id, numbers }),
				timeoutMs: SCAN_TIMEOUT_MS,
				// Not retried here: a scan the network drops goes to the outbox at
				// once and is sent again from there, which is safe — a round counts
				// a copy once, however many times it is sent (see the scan route).
				retries: 0,
			})
			body = await res.json()
		} catch {
			queue(numbers, keys, id)
			return
		}

		// The server itself in trouble is waited out like the network
		if (res.status >= 500) {
			queue(numbers, keys, id)
			return
		}

		try {
			// A plain refusal — the round closed, say — is not going to change by
			// sending it again, so it leaves the outbox and is shown
			if (!res.ok) {
				unqueue(keys)
				throw new Error(body.error ?? 'Could not save the scan')
			}
			unqueue(keys)

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
			// A number that is not a copy here is skipped quietly — no buzz, nothing
			// kept — so the next book is simply read
			if (results.some(r => r.outcome === 'repeat')) buzz([40, 60, 40])

			// The counts move the moment the answer is in, not after a recount of
			// the whole college: the person is already reaching for the next book.
			const ticked = new Set(results
				.filter(r => r.outcome === 'checked')
				.map(r => r.accession_number ?? r.scanned))
			if (ticked.size > 0) {
				setProgress(prev => prev && {
					...prev,
					checked: prev.checked + ticked.size,
					pending: Math.max(0, prev.pending - ticked.size),
				})
			}
			if (ticked.size > 0) {
				setPending(prev => prev.filter(item => !ticked.has(item.accession_number ?? '')))
			}

			refreshSoon(id)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not save the scan'
			settle(keys, () => ({ state: 'failed', error: message }))
			buzz([40, 60, 40])
		}
	}, [institutionId, settle, refreshSoon, queue, unqueue])

	/**
	 * Sends what the outbox holds for this college, a request per round and up
	 * to 200 numbers each — the most the scan route takes at once.
	 */
	const flush = useCallback(async () => {
		if (flushingRef.current || !institutionId) return
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return
		const waiting = outboxRef.current.filter(entry => entry.institutionId === institutionId)
		if (waiting.length === 0) return

		flushingRef.current = true
		setFlushing(true)
		try {
			const bySession = new Map<string, OutboxEntry[]>()
			for (const entry of waiting) {
				bySession.set(entry.sessionId, [...(bySession.get(entry.sessionId) ?? []), entry])
			}
			for (const [id, entries] of bySession) {
				for (let i = 0; i < entries.length; i += OUTBOX_BATCH) {
					const batch = entries.slice(i, i + OUTBOX_BATCH)
					settle(batch.map(e => e.key), () => ({ state: 'sending', error: null }))
					await send(batch.map(e => e.scanned), batch.map(e => e.key), id)
					// Still offline after all: the rest waits for the next go
					if (outboxRef.current.some(entry => entry.key === batch[0].key)) return
				}
			}
		} finally {
			flushingRef.current = false
			setFlushing(false)
		}
	}, [institutionId, send, settle])

	// The internet coming back is the moment to send
	useEffect(() => {
		const onOnline = () => { setOnline(true); void flush() }
		const onOffline = () => setOnline(false)
		setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
		window.addEventListener('online', onOnline)
		window.addEventListener('offline', onOffline)
		return () => {
			window.removeEventListener('online', onOnline)
			window.removeEventListener('offline', onOffline)
		}
	}, [flush])

	// The browser's "online" is not always told about a weak signal coming back,
	// so a waiting outbox is tried again every few seconds as well. Keyed on
	// there being any, not on how many, so a weak signal is not hit with the
	// whole outbox again every time one more book is added to it.
	const hasQueued = queued > 0
	useEffect(() => {
		if (!hasQueued) return
		void flush()
		const timer = setInterval(() => { void flush() }, OUTBOX_RETRY_MS)
		return () => clearInterval(timer)
	}, [hasQueued, flush])

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

	// ── The lists ─────────────────────────────────────────────────────────────

	// Which round each list was last read for, so opening a tab reads it once
	const loadedFor = useRef<{ scans: string | null; pending: string | null }>({ scans: null, pending: null })

	/** Every copy not yet seen, in one answer — the table sorts, filters and pages it. */
	const loadPending = useCallback(async (id: string) => {
		try {
			setPendingLoading(true)
			const res = await fetch(`/api/lib/stock/sessions/${id}?view=pending&all=1`)
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not load the pending list')
			setPending(body.data ?? [])
			loadedFor.current.pending = id
		} catch (error) {
			toast({ title: error instanceof Error ? error.message : 'Could not load the pending list', variant: 'destructive' })
		} finally {
			setPendingLoading(false)
		}
	}, [toast])

	/** Every scan in the round, not just the latest few. */
	const loadScans = useCallback(async (id: string) => {
		try {
			setScansLoading(true)
			const res = await fetch(`/api/lib/stock/sessions/${id}?view=scans`)
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Could not load the scans')
			setScans(body.data ?? [])
			loadedFor.current.scans = id
		} catch (error) {
			toast({ title: error instanceof Error ? error.message : 'Could not load the scans', variant: 'destructive' })
		} finally {
			setScansLoading(false)
		}
	}, [toast])

	// Only when a tab is opened; the lists are not what the scanner waits on
	useEffect(() => {
		if (!sessionId) return
		if (tab === 'pending' && loadedFor.current.pending !== sessionId) void loadPending(sessionId)
		if (tab === 'all' && loadedFor.current.scans !== sessionId) void loadScans(sessionId)
	}, [tab, sessionId, loadPending, loadScans])

	// The latest scans arrive with every refresh of the counts, so they are laid
	// over the full list — Everyone's stays live without reading the round again
	const everyone = useMemo(() => {
		const seen = new Set<string>()
		return [...recent, ...scans].filter(row => {
			if (seen.has(row.id)) return false
			seen.add(row.id)
			return true
		})
	}, [recent, scans])

	const scannerFacet = useMemo<StockFacet<RecentScan>>(() => ({
		label: 'Scanners',
		options: [...new Set(everyone.map(row => row.scanned_by_name ?? '—'))]
			.sort((a, b) => a.localeCompare(b))
			.map(name => ({ value: name, label: name })),
		get: row => row.scanned_by_name ?? '—',
	}), [everyone])

	const statusFacet = useMemo<StockFacet<PendingItem>>(() => ({
		label: 'Statuses',
		options: [...new Set(pending.map(item => item.status as string))]
			.sort()
			.map(status => ({ value: status, label: statusLabel(status) })),
		get: item => item.status,
	}), [pending])

	const feedColumns = useMemo<StockColumn<FeedLine>[]>(() => [
		{
			key: 'number',
			header: 'Number',
			cell: line => <span className="whitespace-nowrap font-mono text-sm font-medium">{line.scanned}</span>,
			sort: line => line.scanned,
			excel: line => line.scanned,
		},
		{
			key: 'title',
			header: 'Title',
			className: 'max-w-[140px] sm:max-w-[320px]',
			cell: line => (
				<>
					<OverflowText as="div" text={line.title ?? '—'} className="text-sm" />
					{line.firstBy && <p className="text-xs text-muted-foreground">already by {line.firstBy}</p>}
					{line.error && <p className="text-xs text-destructive">{line.error}</p>}
				</>
			),
			sort: line => line.title ?? '',
			excel: line => line.title ?? '',
		},
		{
			key: 'result',
			header: 'Result',
			cell: line => (
				<div className="flex items-center gap-2 whitespace-nowrap">
					<StateBadge line={line} />
					{line.state === 'failed' && (
						<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => retry(line)}>
							Try again
						</Button>
					)}
				</div>
			),
			sort: line => FEED_LABEL[line.state],
			excel: line => FEED_LABEL[line.state],
		},
	], [retry])

	// The Excel report: the people who run the library, not a helper lent for the counting
	const canExport = !helperOnly && (role === 'super_admin' || role === 'library_admin' || role === 'librarian')

	const done = progress && progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0

	// ── The screen ────────────────────────────────────────────────────────────

	return (
		<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0">
			{/* Header */}
			<div className="flex-shrink-0">
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-50 dark:bg-brand-green-900/30">
						<ClipboardCheck className="h-5 w-5 text-brand-green dark:text-brand-green-400" />
					</div>
					<div className="min-w-0">
						<h1 className="text-base font-semibold">Stock Check</h1>
						<p className="text-xs text-muted-foreground sm:hidden">
							Scan the shelves — each copy counts once
						</p>
						<p className="hidden text-xs text-muted-foreground sm:block">
							Scan the shelves — everyone scanning into the same round counts together, and a copy already seen is never counted twice
						</p>
					</div>
				</div>
			</div>

			{isReady && !institutionId ? (
				<>
					<Card>
						<CardContent className="py-12 text-center text-sm text-muted-foreground">
							Select an institution to run its stock check
						</CardContent>
					</Card>
					{/* All Institutions: helpers can still be bulk assigned, each
					    row of the sheet naming its own college */}
					{role === 'super_admin' && <StockCheckHelpers institutionId="" />}
				</>
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
							{/* Where the round has got to. On a phone it sits under the
							    scan button, which is what the person came for. */}
							<Card className="flex-shrink-0 max-sm:order-1">
								<CardContent className="space-y-3 p-3 sm:p-4">
									<div className="grid grid-cols-3 gap-2 sm:gap-3">
										{/* In stock: the whole college, in the brand's own green */}
										<div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand-green-500 to-brand-green-700 p-2.5 text-white shadow-sm sm:p-4">
											<BookCopy className="absolute -right-2 -top-2 h-12 w-12 opacity-20 sm:h-16 sm:w-16" />
											<p className="text-xs font-medium text-white/85">
												<span className="sm:hidden">In stock</span>
												<span className="hidden sm:inline">Copies in stock</span>
											</p>
											<p className="text-lg font-bold tabular-nums sm:text-2xl">{count(progress?.total)}</p>
										</div>
										{/* Checked: what this round has seen */}
										<div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-2.5 shadow-sm dark:border-emerald-800 dark:from-emerald-900/30 dark:to-emerald-900/10 sm:p-4">
											<CheckCircle2 className="absolute -right-2 -top-2 h-12 w-12 text-emerald-500 opacity-20 sm:h-16 sm:w-16" />
											<p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Checked</p>
											<p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300 sm:text-2xl">{count(progress?.checked)}</p>
										</div>
										{/* Still to find: the shelves still to walk */}
										<div className="relative overflow-hidden rounded-xl border border-brand-yellow-400 bg-gradient-to-br from-brand-yellow-50 to-brand-yellow-200 p-2.5 shadow-sm dark:border-brand-yellow-900 dark:from-brand-yellow-900/20 dark:to-brand-yellow-900/10 sm:p-4">
											<ScanSearch className="absolute -right-2 -top-2 h-12 w-12 text-brand-yellow-900 opacity-20 sm:h-16 sm:w-16" />
											<p className="text-xs font-medium text-brand-yellow-900 dark:text-brand-yellow-600">
												<span className="sm:hidden">To find</span>
												<span className="hidden sm:inline">Still to find</span>
											</p>
											<p className="text-lg font-bold tabular-nums text-brand-yellow-900 dark:text-brand-yellow-600 sm:text-2xl">{count(progress?.pending)}</p>
										</div>
									</div>
									<div className="space-y-1">
										<div className="flex items-center justify-between gap-2 text-xs">
											<span className="text-muted-foreground">Of this college&apos;s copies seen in this round</span>
											<span className="font-semibold tabular-nums text-brand-green dark:text-brand-green-400">{done}%</span>
										</div>
										<Progress
											value={done}
											className="h-2.5 bg-brand-yellow-100 dark:bg-brand-yellow-900/20 [&>div]:bg-gradient-to-r [&>div]:from-brand-green-400 [&>div]:to-brand-green-600"
										/>
									</div>
								</CardContent>
							</Card>

							{/* The scan box */}
							<Card className="flex-shrink-0">
								<CardHeader className="hidden border-b px-4 py-3 sm:block">
									<h2 className="text-base font-semibold">Scan</h2>
									<p className="text-xs text-muted-foreground">
										Open the camera and point it at each book&apos;s barcode — it keeps counting until you press Done
									</p>
								</CardHeader>
								{/* The phone in the stacks, and the only way in. Opened once, it
								    keeps reading until Done is pressed, and a book it has already
								    read this time round is never sent twice. */}
								<CardContent className="space-y-2 p-3 sm:p-4">
									{/* On a phone the counts sit further down, so the one line
									    that matters is kept beside the button */}
									{progress && (
										<div className="space-y-1 sm:hidden">
											<div className="flex items-baseline justify-between text-xs">
												<span className="text-muted-foreground">
													<span className="font-semibold tabular-nums text-brand-green dark:text-brand-green-400">
														{progress.checked.toLocaleString('en-IN')}
													</span>
													{' '}of {progress.total.toLocaleString('en-IN')} checked
												</span>
												<span className="font-medium tabular-nums">{done}%</span>
											</div>
											<Progress value={done} className="h-1.5" />
										</div>
									)}

									{/* No internet, or scans still waiting for it */}
									{(!online || queued > 0) && (
										<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-300">
											<span className="flex min-w-0 items-start gap-2">
												{flushing
													? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
													: <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />}
												<span>
													{flushing
														? `Sending ${queued.toLocaleString('en-IN')} saved ${queued === 1 ? 'scan' : 'scans'}…`
														: queued > 0
															? `${queued.toLocaleString('en-IN')} ${queued === 1 ? 'scan is' : 'scans are'} saved on this phone — ${online ? 'sending again shortly' : 'they will be sent when the internet is back'}. Keep scanning.`
															: 'No internet — keep scanning, every book is saved on this phone and sent when it is back.'}
												</span>
											</span>
											{queued > 0 && online && !flushing && (
												<Button variant="outline" size="sm" className="h-8 shrink-0 bg-white text-xs dark:bg-transparent" onClick={() => { void flush() }}>
													<UploadCloud className="mr-1.5 h-3.5 w-3.5" />
													Send now
												</Button>
											)}
										</div>
									)}
									{isOpen ? (
										<CameraScanner
											continuous
											className="h-14 w-full text-base"
											buttonText="Scan a book"
											label="Point the camera at each book's barcode — it keeps counting until you press Done"
											onScan={scan}
											feed={<CameraFeed lines={feed} queued={queued} />}
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
							<Card className="flex min-h-0 flex-1 flex-col max-sm:order-1">
								<CardContent className="p-3 sm:p-4">
									<div className="min-w-0">
										<Tabs value={tab} onValueChange={setTab} className="w-full">
											<div className="flex items-center justify-between gap-2">
												{/* Three even tabs on a phone, with the short names */}
												<TabsList className="grid h-auto min-w-0 flex-1 grid-cols-3 bg-brand-green-50 dark:bg-brand-green-900/20 sm:inline-flex sm:h-10 sm:flex-none [&>button[data-state=active]]:bg-brand-green [&>button[data-state=active]]:text-white">
													<TabsTrigger value="feed" className="px-1 text-xs sm:px-3 sm:text-sm">
														<span className="sm:hidden">Mine</span>
														<span className="hidden sm:inline">My scans</span>
													</TabsTrigger>
													<TabsTrigger value="all" className="px-1 text-xs sm:px-3 sm:text-sm">
														<span className="sm:hidden">All</span>
														<span className="hidden sm:inline">Everyone&apos;s</span>
													</TabsTrigger>
													<TabsTrigger value="pending" className="px-1 text-xs sm:px-3 sm:text-sm">
														<span className="sm:hidden">To find</span>
														<span className="hidden sm:inline">
															Still to find{progress ? ` (${progress.pending.toLocaleString('en-IN')})` : ''}
														</span>
													</TabsTrigger>
												</TabsList>
												<Button
													variant="outline"
													size="icon"
													className="h-9 w-9 shrink-0 p-0"
													onClick={() => {
														if (!sessionId) return
														void loadProgress(sessionId)
														if (tab === 'pending') void loadPending(sessionId)
														if (tab === 'all') void loadScans(sessionId)
													}}
													aria-label="Refresh"
												>
													<RefreshCw className="h-4 w-4" />
												</Button>
											</div>

											{/* This device's own scans, newest first */}
											<TabsContent value="feed" className="mt-3">
												<StockCheckTable
													rows={feed}
													rowKey={line => line.key}
													columns={feedColumns}
													searchText={line => `${line.scanned} ${line.title ?? ''}`}
													searchPlaceholder="Search number or title"
													facet={FEED_FACET}
													rowTone={line => FEED_TONE[line.state]}
													empty="Nothing scanned on this device yet"
													canExport={canExport}
													exportName="stock-check-my-scans"
													sheetName="My scans"
												/>
											</TabsContent>

											{/* Everybody's, the whole round */}
											<TabsContent value="all" className="mt-3">
												<StockCheckTable
													rows={everyone}
													rowKey={row => row.id}
													columns={SCAN_COLUMNS}
													searchText={row => `${row.accession_number} ${row.title ?? ''} ${row.scanned_by_name ?? ''}`}
													searchPlaceholder="Search number, title or name"
													facet={scannerFacet}
													rowTone={() => 'border-l-brand-green-400'}
													empty="No scans in this round yet"
													loading={scansLoading}
													canExport={canExport}
													exportName="stock-check-everyone"
													sheetName="Everyone's scans"
													defaultSort={{ key: 'at', dir: 'desc' }}
												/>
											</TabsContent>

											{/* What the round has not seen */}
											<TabsContent value="pending" className="mt-3">
												<StockCheckTable
													rows={pending}
													rowKey={item => item.id}
													columns={PENDING_COLUMNS}
													searchText={item => `${item.accession_number ?? ''} ${item.catalogue?.title ?? ''} ${item.catalogue?.author ?? ''}`}
													searchPlaceholder="Search accession number, title or author"
													facet={statusFacet}
													rowTone={() => 'border-l-brand-yellow-600'}
													empty="Nothing left to find"
													loading={pendingLoading}
													canExport={canExport}
													exportName="stock-check-still-to-find"
													sheetName="Still to find"
													defaultSort={{ key: 'accession', dir: 'asc' }}
												/>
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
