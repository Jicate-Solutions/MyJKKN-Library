'use client'

/**
 * Gate Entry — the same screen for all seven libraries.
 *
 * Built first for Pharmacy, and since 3 Sep 2026 used by every campus: the
 * register can be read for any past day, or for a run of days, and exported to
 * Excel either way, so a gate report is one download for any college.
 *
 * The gate is the busiest, dumbest screen in the building: a queue of students,
 * one scanner, and a librarian who cannot look away from the door. So the whole
 * screen is built around one box that always has focus, and one big answer
 * after every scan — IN or OUT, with the face, readable from a step back.
 *
 * The server decides whether a scan is an entry or an exit and stamps the time
 * in IST, so nothing here depends on the browser's clock or on a list that
 * might be a few seconds stale.
 *
 * Rebuilt on 4 Sep 2026 for the hands at the door:
 *
 *   * the college the scan goes to is settled before the scan, never after;
 *   * Today / Yesterday / This week / This month are one press, ◀ ▶ step a day;
 *   * Inside · Left and Learner · Staff are chips, and the two numbers filter;
 *   * the green Inside badge is the mark-out button; Close day says how many;
 *   * the last five scans sit under the box, so the queue can be checked
 *     without scrolling; a card scanned twice in a minute is one entry;
 *   * an unknown card answers in the big card in red, with a beep if wanted;
 *   * the register refreshes itself every minute while today is on screen,
 *     paints from this tab's copy on a revisit, and long ranges are summarised
 *     by day and paged;
 *   * every name opens the person on the Members page; the range and the
 *     search live in the address; the Excel has a by-day sheet.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useInstitution } from '@/context/institution-context'
import { useScanFocus } from '@/hooks/library/use-scan-focus'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	RefreshCw, ScanLine, Lock, LogIn, LogOut, Users, Search,
	CalendarDays, Download, DoorClosed, ChevronLeft, ChevronRight,
	Volume2, VolumeX, AlertTriangle, X, Building2, UserCheck,
} from 'lucide-react'
import { istToday, istTimeNow, formatClockTime, durationBetween } from '@/lib/library/ist-clock'

interface Visit {
	id: string
	institution_id?: string
	member_id: string | null
	myjkkn_id?: string | null
	person_kind?: 'learner' | 'facilitator' | null
	visit_date: string
	entry_time: string | null
	exit_time: string | null
	/** The programme or designation, when the college's roll was in hand. */
	role_label?: string | null
	member?: {
		id: string
		member_number: string
		display_name: string | null
		member_category: string
	} | null
}

interface ScanResult {
	direction: 'in' | 'out'
	at: string | null
	visit?: {
		id: string | null
		visit_date: string
		entry_time: string | null
		exit_time: string | null
	}
	member: {
		id: string
		member_number: string
		display_name: string | null
		member_category: string
		is_active: boolean
		photo_url: string | null
	}
}

/** What the door is told when a scan could not be recorded. */
interface ScanRefusal {
	message: string
	/** The same card again within the college's window — already in, nothing written. */
	repeat: boolean
	member?: { display_name: string | null; member_number: string; photo_url: string | null }
}

type StatusFilter = 'all' | 'inside' | 'left'
type CategoryFilter = 'all' | 'learner' | 'facilitator'

const CATEGORY_LABELS: Record<string, string> = {
	learner: 'Learner',
	facilitator: 'Facilitator',
	other: 'Other',
	team_member: 'Staff',
	guest: 'Guest',
	alumni: 'Alumni',
}

/** Rows drawn at once. A month at a big college is thousands; nobody reads them in one scroll. */
const ROWS_PER_PAGE = 100

/** How many of the latest scans sit under the box. */
const RECENT_SCANS = 5

/** How often today's register is read again on its own while the tab is showing. */
const AUTO_REFRESH_MS = 60_000

function initials(name: string): string {
	const parts = name.trim().split(/\s+/)
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** "Thursday, 03 September 2026" — the register's heading for one day. */
const longDate = (iso: string): string =>
	new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

/** "03 Sep 2026" — short enough for a table cell and a range heading. */
const shortDate = (iso: string): string =>
	new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

/** Calendar arithmetic on YYYY-MM-DD without the browser's zone getting a say. */
function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() + days)
	return d.toISOString().slice(0, 10)
}

/** The Monday of the week this day is in. */
function startOfWeek(iso: string): string {
	const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
	return addDays(iso, -((day + 6) % 7))
}

/** "10–11 AM", from an hour of the day. */
function hourBand(hour: number): string {
	const label = (h: number) => `${h % 12 === 0 ? 12 : h % 12}`
	const suffix = hour + 1 < 12 ? 'AM' : 'PM'
	return `${label(hour)}–${label(hour + 1)} ${suffix}`
}

/** One day of the register, in the numbers inspection asks for. */
interface DaySummary {
	date: string
	footfall: number
	people: number
	peak: string
	open: number
}

function summariseByDay(rows: Visit[]): DaySummary[] {
	const days = new Map<string, { rows: Visit[] }>()
	for (const v of rows) {
		const day = days.get(v.visit_date) ?? { rows: [] }
		day.rows.push(v)
		days.set(v.visit_date, day)
	}
	return [...days.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, { rows: dayRows }]) => {
			const hours = new Map<number, number>()
			for (const v of dayRows) {
				const hour = Number((v.entry_time ?? '').split(':')[0])
				if (!Number.isNaN(hour)) hours.set(hour, (hours.get(hour) ?? 0) + 1)
			}
			const peakHour = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
			return {
				date,
				footfall: dayRows.length,
				people: uniquePeople(dayRows),
				peak: peakHour ? hourBand(peakHour[0]) : '—',
				open: dayRows.filter(v => v.entry_time && !v.exit_time).length,
			}
		})
}

/** Distinct people behind a set of visits — the same student twice is one person. */
function uniquePeople(rows: Visit[]): number {
	const seen = new Set<string>()
	for (const v of rows) seen.add(v.myjkkn_id || v.member?.member_number || v.id)
	return seen.size
}

// ── What lives in the address ───────────────────────────────────────────────

interface ViewState {
	from: string
	to: string
	q: string
	status: StatusFilter
	cat: CategoryFilter
}

function readView(today: string): ViewState {
	const p = new URLSearchParams(window.location.search)
	const isDate = (v: string | null) => v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today ? v : null
	const from = isDate(p.get('from')) ?? today
	const to = isDate(p.get('to')) ?? from
	const status = p.get('status')
	const cat = p.get('cat')
	return {
		from: from <= to ? from : to,
		to: from <= to ? to : from,
		q: p.get('q') ?? '',
		status: status === 'inside' || status === 'left' ? status : 'all',
		cat: cat === 'learner' || cat === 'facilitator' ? cat : 'all',
	}
}

/** Only what differs from "today, everyone" is written, so a plain visit has a plain address. */
function writeView(view: ViewState, today: string): void {
	const p = new URLSearchParams()
	if (view.from !== today || view.to !== today) { p.set('from', view.from); p.set('to', view.to) }
	if (view.q) p.set('q', view.q)
	if (view.status !== 'all') p.set('status', view.status)
	if (view.cat !== 'all') p.set('cat', view.cat)
	const query = p.toString()
	window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

// ── Remembered between visits ───────────────────────────────────────────────

const REMEMBER_PREFIX = 'lib:gate:'
const SOUND_KEY = 'lib:gate:sound'

function rememberedToday(key: string): Visit[] | null {
	try {
		const raw = sessionStorage.getItem(REMEMBER_PREFIX + key)
		const rows = raw ? (JSON.parse(raw) as Visit[]) : null
		return Array.isArray(rows) ? rows : null
	} catch {
		return null
	}
}

function rememberToday(key: string, rows: Visit[]): void {
	try { sessionStorage.setItem(REMEMBER_PREFIX + key, JSON.stringify(rows)) } catch { /* full or blocked */ }
}

// ── A beep, for a door where nobody is looking at the corner of the screen ──

let audio: AudioContext | null = null

function beep(kind: 'in' | 'out' | 'error'): void {
	try {
		audio = audio ?? new AudioContext()
		const osc = audio.createOscillator()
		const gain = audio.createGain()
		osc.connect(gain)
		gain.connect(audio.destination)
		osc.type = kind === 'error' ? 'square' : 'sine'
		osc.frequency.value = kind === 'in' ? 880 : kind === 'out' ? 620 : 200
		gain.gain.value = 0.06
		osc.start()
		osc.stop(audio.currentTime + (kind === 'error' ? 0.35 : 0.09))
	} catch {
		// No audio on this machine — the screen still says it
	}
}

export function GateEntry() {
	const { isReady, institutionId, institutionCode, appendToUrl, mustSelectInstitution } = useInstitutionFilter()
	const { availableInstitutions, selectInstitution } = useInstitution()
	const { toast } = useToast()

	const today = istToday()
	const rememberKey = `${institutionId ?? 'all'}:${today}`

	const [visits, setVisits] = useState<Visit[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [barcode, setBarcode] = useState('')
	const [scanning, setScanning] = useState(false)
	const [last, setLast] = useState<ScanResult | null>(null)
	const [refused, setRefused] = useState<ScanRefusal | null>(null)
	const [recent, setRecent] = useState<ScanResult[]>([])
	const [closingDay, setClosingDay] = useState(false)
	const [confirmClose, setConfirmClose] = useState(false)
	const [sound, setSound] = useState(true)
	const [page, setPage] = useState(1)
	/** Rows still open on days before today, offered for closing in one press. */
	const [stale, setStale] = useState<{ count: number; lastDate: string } | null>(null)
	const [closingStale, setClosingStale] = useState(false)
	/** The wall clock, for how long each person inside has been in. */
	const [clock, setClock] = useState(() => istTimeNow())

	const [view, setView] = useState<ViewState>({ from: today, to: today, q: '', status: 'all', cat: 'all' })
	const [viewReady, setViewReady] = useState(false)
	const searchRef = useRef<HTMLInputElement>(null)

	const { from: fromDate, to: toDate } = view
	const isSingleDay = fromDate === toDate

	// Scanning always writes to today. Looking at an older day, or at a range,
	// is reading the register, not standing at the door, so the scan box goes
	// away with it — as it does until a college is chosen.
	const isToday = isSingleDay && fromDate === today
	const canScan = isToday && !mustSelectInstitution && !!institutionId

	// The cursor lives in the scan box whenever the box is there to scan into
	const { inputRef, focusScanBox } = useScanFocus(canScan && !forbidden && !confirmClose)

	const patch = useCallback((changes: Partial<ViewState>) => {
		setView(prev => ({ ...prev, ...changes }))
		setPage(1)
	}, [])

	// ── The address, read once and then kept up to date ──
	useEffect(() => {
		setView(readView(today))
		setViewReady(true)
		try { setSound(localStorage.getItem(SOUND_KEY) !== 'off') } catch { /* keep default */ }
	}, [today])

	useEffect(() => {
		if (viewReady) writeView(view, today)
	}, [view, viewReady, today])

	const toggleSound = () => {
		setSound(prev => {
			try { localStorage.setItem(SOUND_KEY, prev ? 'off' : 'on') } catch { /* fine */ }
			return !prev
		})
	}

	// ── The days on screen ──
	// The two pickers can never cross: moving one past the other drags the
	// other along, so the range on screen is always a real one.
	const pickFrom = (value: string) => {
		const next = value || today
		patch({ from: next, to: next > toDate ? next : toDate })
	}
	const pickTo = (value: string) => {
		const next = value || today
		patch({ to: next, from: next < fromDate ? next : fromDate })
	}
	const showDay = (day: string) => patch({ from: day, to: day })
	const showRange = (from: string, to: string) => patch({ from, to })
	const stepDays = (days: number) => {
		const to = addDays(toDate, days)
		if (to > today) return
		patch({ from: addDays(fromDate, days), to })
	}
	const backToToday = () => showDay(today)

	const preset = useMemo(() => {
		if (isToday) return 'today'
		if (isSingleDay && fromDate === addDays(today, -1)) return 'yesterday'
		if (fromDate === startOfWeek(today) && toDate === today) return 'week'
		if (fromDate === `${today.slice(0, 8)}01` && toDate === today) return 'month'
		return null
	}, [isToday, isSingleDay, fromDate, toDate, today])

	// ── The register ──
	const fetchData = useCallback(async (quiet = false) => {
		if (!isReady) return
		try {
			if (quiet) setRefreshing(true)
			else setLoading(true)
			setForbidden(null)
			const url = appendToUrl(`/api/lib/visits?from_date=${fromDate}&to_date=${toDate}`)
			const res = await fetch(url)
			if (!res.ok) {
				setForbidden((await res.json()).error || 'You do not have permission to view this page')
				setVisits([])
				return
			}
			const rows: Visit[] = await res.json()
			setVisits(rows)
			if (fromDate === today && toDate === today) rememberToday(rememberKey, rows)
		} catch {
			if (!quiet) toast({ title: 'Failed to load the gate register', variant: 'destructive' })
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [isReady, appendToUrl, toast, fromDate, toDate, today, rememberKey])

	// Today's register is painted from this tab's copy first, then read afresh
	// behind it. Any other day is read outright.
	useEffect(() => {
		if (!isReady || !viewReady) return
		if (fromDate === today && toDate === today) {
			const remembered = rememberedToday(rememberKey)
			if (remembered && remembered.length > 0) {
				setVisits(remembered)
				setLoading(false)
				fetchData(true)
				return
			}
		}
		fetchData(false)
	}, [isReady, viewReady, fromDate, toDate, today, rememberKey, fetchData])

	// Scans from a second scanner, or from the desk, appear on their own while
	// today is on screen and the tab is showing. Paused mid-scan so a refresh
	// never lands between a card and its answer.
	useEffect(() => {
		if (!isToday) return
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible' && !scanning) fetchData(true)
		}, AUTO_REFRESH_MS)
		return () => clearInterval(timer)
	}, [isToday, scanning, fetchData])

	// "In since" moves on its own
	useEffect(() => {
		const timer = setInterval(() => setClock(istTimeNow()), 30_000)
		return () => clearInterval(timer)
	}, [])

	// The moment a scan is finished with, the box is ready for the next card
	useEffect(() => { if (!scanning) focusScanBox() }, [scanning, focusScanBox])

	// ── Earlier days nobody closed ──
	const checkStale = useCallback(async () => {
		if (!isReady || !institutionId) { setStale(null); return }
		try {
			const res = await fetch(`/api/lib/visits?institution_id=${institutionId}&to_date=${addDays(today, -1)}&open_only=true`)
			if (!res.ok) return
			const rows: Visit[] = await res.json()
			if (rows.length === 0) { setStale(null); return }
			const lastDate = rows.map(v => v.visit_date).sort().pop() ?? ''
			setStale({ count: rows.length, lastDate })
		} catch {
			// Not worth a message — the banner simply does not appear
		}
	}, [isReady, institutionId, today])

	useEffect(() => { checkStale() }, [checkStale])

	const closeStale = async () => {
		if (!institutionId) return
		try {
			setClosingStale(true)
			const res = await fetch('/api/lib/visits/close-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, before_date: today }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not close the earlier days')
			toast({
				title: `✅ ${data.closed} marked out at ${formatClockTime(data.exit_time)} on their own day`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			setStale(null)
			if (!isToday) fetchData(true)
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		} finally {
			setClosingStale(false)
		}
	}

	// ── What is on screen ──
	const institutionCodeOf = useMemo(() => {
		const map = new Map<string, string>()
		for (const inst of availableInstitutions) {
			if (inst.id && inst.institution_code) map.set(inst.id, inst.institution_code)
		}
		return map
	}, [availableInstitutions])

	const inside = useMemo(() => visits.filter(v => v.entry_time && !v.exit_time), [visits])
	const people = useMemo(() => uniquePeople(visits), [visits])

	const filtered = useMemo(() => {
		const term = view.q.trim().toLowerCase()
		return visits.filter(v => {
			if (view.status === 'inside' && !(v.entry_time && !v.exit_time)) return false
			if (view.status === 'left' && !v.exit_time) return false
			if (view.cat !== 'all' && v.member?.member_category !== view.cat) return false
			if (!term) return true
			return (v.member?.display_name ?? '').toLowerCase().includes(term)
				|| (v.member?.member_number ?? '').toLowerCase().includes(term)
				|| (v.role_label ?? '').toLowerCase().includes(term)
		})
	}, [visits, view.q, view.status, view.cat])

	const byDay = useMemo(() => (isSingleDay ? [] : summariseByDay(filtered)), [filtered, isSingleDay])

	const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
	const currentPage = Math.min(page, totalPages)
	const paged = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE)

	/** How long someone inside has been in — live today, unknown on an older day. */
	const stayedSoFar = (v: Visit) => {
		if (v.exit_time) return durationBetween(v.entry_time, v.exit_time)
		if (!isToday || !v.entry_time) return '—'
		const soFar = durationBetween(v.entry_time, clock)
		return soFar === '—' ? 'just now' : soFar
	}

	// ── Scanning ──

	/**
	 * Puts one scan's result into the register on screen.
	 *
	 * An exit closes the line already there; an entry starts a new one at the
	 * top, where the day's newest visit belongs. The whole day used to be read
	 * again after every scan, which is a round trip the student at the door waits
	 * through for a line we already have in full.
	 */
	const mergeScan = useCallback((result: ScanResult) => {
		const visitId = result.visit?.id
		if (!visitId) return

		setVisits(prev => {
			if (result.direction === 'out') {
				return prev.map(v => (v.id === visitId ? { ...v, exit_time: result.visit?.exit_time ?? result.at } : v))
			}

			const line: Visit = {
				id: visitId,
				institution_id: institutionId ?? undefined,
				member_id: null,
				myjkkn_id: result.member.id,
				visit_date: result.visit?.visit_date ?? today,
				entry_time: result.visit?.entry_time ?? result.at,
				exit_time: null,
				member: {
					id: result.member.id,
					member_number: result.member.member_number,
					display_name: result.member.display_name,
					member_category: result.member.member_category,
				},
			}
			return [line, ...prev.filter(v => v.id !== line.id)]
		})
	}, [today, institutionId])

	const handleScan = async () => {
		const code = barcode.trim()
		if (!code || scanning) return
		if (!institutionId) {
			toast({ title: 'Choose the college first', variant: 'destructive' })
			return
		}

		try {
			setScanning(true)
			const res = await fetch('/api/lib/visits/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, barcode: code }),
			})
			const data = await res.json()
			if (!res.ok) {
				// Said in the big card, not a corner toast — at a door the toast is
				// missed and the queue moves on
				setLast(null)
				setRefused({ message: data.error || 'Scan failed', repeat: data.repeat === true, member: data.member })
				if (sound) beep('error')
				return
			}

			setRefused(null)
			setLast(data)
			setRecent(prev => [data, ...prev].slice(0, RECENT_SCANS))
			if (sound) beep(data.direction)
			if (!data.member.is_active) {
				toast({
					title: '⚠️ Membership is not active',
					description: `${data.member.display_name ?? data.member.member_number} was let in, but their membership needs renewing.`,
				})
			}

			// Scanning always writes to today, so a scan changes nothing on screen
			// while an older day is being read
			if (isToday) mergeScan(data)
		} catch (err) {
			setLast(null)
			setRefused({ message: err instanceof Error ? err.message : 'Scan failed', repeat: false })
			if (sound) beep('error')
		} finally {
			setBarcode('')
			setScanning(false)
			// Straight back to the box — the next student is already at the door
			focusScanBox()
		}
	}

	const markExit = async (visitId: string) => {
		try {
			const res = await fetch('/api/lib/visits/close-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, visit_id: visitId }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not mark the exit')

			// The one line that changed, stamped with the time the server used
			setVisits(prev => prev.map(v => (v.id === visitId ? { ...v, exit_time: data.exit_time } : v)))
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		}
	}

	const closeDay = async () => {
		try {
			setClosingDay(true)
			const res = await fetch('/api/lib/visits/close-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, visit_date: fromDate }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not close the register')
			toast({
				title: `✅ ${data.closed} marked out at ${formatClockTime(data.exit_time)}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})

			// Everyone who was still inside is now out, at the closing time the
			// server stamped — exactly what reading the day again would show
			setVisits(prev => prev.map(v =>
				v.entry_time && !v.exit_time ? { ...v, exit_time: data.exit_time } : v
			))
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		} finally {
			setClosingDay(false)
			setConfirmClose(false)
		}
	}

	// ── Keys: Esc empties the scan box, `/` goes to search, ← → step a day ──
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null
			if (e.key === 'Escape' && target === inputRef.current) { setBarcode(''); return }
			const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
			if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
			if (typing || confirmClose) return
			if (e.key === 'ArrowLeft') stepDays(-1)
			if (e.key === 'ArrowRight') stepDays(1)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromDate, toDate, today, confirmClose])

	// ── Excel: the rows as filtered, and a by-day sheet inspection can read ──
	const exportRegister = () => {
		if (filtered.length === 0) {
			toast({ title: isSingleDay ? 'Nothing to export for this day' : 'Nothing to export for these days', variant: 'destructive' })
			return
		}

		const rows = filtered.map(v => ({
			Name: v.member?.display_name ?? '',
			'Member ID': v.member?.member_number ?? '',
			Category: CATEGORY_LABELS[v.member?.member_category ?? ''] ?? v.member?.member_category ?? '',
			'Programme / Role': v.role_label ?? '',
			...(mustSelectInstitution ? { College: institutionCodeOf.get(v.institution_id ?? '') ?? '' } : {}),
			Date: v.visit_date,
			In: formatClockTime(v.entry_time),
			Out: formatClockTime(v.exit_time),
			Duration: durationBetween(v.entry_time, v.exit_time),
			Status: v.exit_time ? 'Left' : 'Inside',
		}))

		const book = XLSX.utils.book_new()
		const sheet = XLSX.utils.json_to_sheet(rows)
		sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 34 }, ...(mustSelectInstitution ? [{ wch: 8 }] : []), { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }]
		XLSX.utils.book_append_sheet(book, sheet, 'Gate Register')

		const days = summariseByDay(filtered).map(d => ({
			Date: d.date,
			Footfall: d.footfall,
			'Unique people': d.people,
			'Peak hour': d.peak,
			'Still open': d.open,
		}))
		const daySheet = XLSX.utils.json_to_sheet(days)
		daySheet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }]
		XLSX.utils.book_append_sheet(book, daySheet, 'By day')

		// The file says which days it holds, so a folder of reports reads itself
		const college = institutionId ? (institutionCodeOf.get(institutionId) ?? 'college') : 'all-colleges'
		XLSX.writeFile(book, isSingleDay ? `gate-register-${college}-${fromDate}.xlsx` : `gate-register-${college}-${fromDate}_to_${toDate}.xlsx`)
	}

	if (forbidden) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="max-w-md w-full border-l-4 border-l-destructive">
					<CardContent className="p-8 text-center">
						<Lock className="h-10 w-10 mx-auto text-destructive/50 mb-3" />
						<h2 className="text-base font-semibold font-heading mb-1">Access restricted</h2>
						<p className="text-sm text-muted-foreground">{forbidden}</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	const chip = (active: boolean, tone: 'green' | 'amber' = 'green') =>
		`h-7 rounded-full border px-2.5 text-xs transition-colors ${
			active
				? tone === 'green'
					? 'border-brand-green bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400 dark:border-brand-green-600'
					: 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300'
				: 'border-border text-muted-foreground hover:bg-muted'
		}`
	const activeCard = 'ring-2 ring-offset-1 ring-brand-green/60 dark:ring-brand-green-400/60'
	const colCount = 7 + (mustSelectInstitution ? 1 : 0) + (isSingleDay ? 0 : 1)

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 min-h-0">
				{/* Scan box and the two numbers that matter */}
				<div className="grid gap-3 lg:grid-cols-3 flex-shrink-0">
					<Card className="lg:col-span-2 border-l-4 border-l-brand-green dark:border-l-brand-green-400">
						<CardContent className="p-4">
							{mustSelectInstitution ? (
								// Settled before the scan, never after it: a card scanned with
								// every college showing has no register to go into
								<div className="flex flex-wrap items-center gap-3 text-sm">
									<Building2 className="h-5 w-5 text-brand-green dark:text-brand-green-400 flex-shrink-0" />
									<span className="text-muted-foreground">Choose the college this gate belongs to before scanning</span>
									<Select onValueChange={code => {
										const inst = availableInstitutions.find(i => i.institution_code === code)
										if (inst) selectInstitution(inst)
									}}>
										<SelectTrigger className="h-9 w-[260px] ml-auto"><SelectValue placeholder="Select the college…" /></SelectTrigger>
										<SelectContent>
											{availableInstitutions.map(i => (
												<SelectItem key={i.institution_code} value={i.institution_code}>
													{i.institution_code} · {i.institution_name ?? i.short_name ?? i.institution_code}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							) : isToday ? (
								<div className="flex items-center gap-3">
									<ScanLine className="h-5 w-5 text-brand-green dark:text-brand-green-400 flex-shrink-0" />
									<Input
										ref={inputRef}
										autoFocus
										placeholder="Scan the college ID card, or type the ID and press Enter"
										value={barcode}
										onChange={e => setBarcode(e.target.value)}
										onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
										// Held rather than disabled: a disabled box loses the
										// cursor, and the next card would scan into nothing
										readOnly={scanning}
										className="h-11 text-base min-w-0"
									/>
									{/* Which register this scan goes into — always in view */}
									{institutionCode && (
										<Tooltip>
											<TooltipTrigger asChild>
												<Badge variant="secondary" className="h-7 shrink-0 font-mono">{institutionCode}</Badge>
											</TooltipTrigger>
											<TooltipContent>Scanning for {institutionCode}</TooltipContent>
										</Tooltip>
									)}
									<Button
										onClick={handleScan}
										disabled={scanning || !barcode.trim()}
										className="h-11 px-4 sm:px-6 shrink-0 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
									>
										{scanning ? 'Working...' : 'Record'}
									</Button>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={toggleSound} aria-label={sound ? 'Turn the beep off' : 'Turn the beep on'}>
												{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
											</Button>
										</TooltipTrigger>
										<TooltipContent>{sound ? 'Beep on every scan — click to silence' : 'Silent — click for a beep on every scan'}</TooltipContent>
									</Tooltip>
								</div>
							) : (
								<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground py-2">
									<CalendarDays className="h-5 w-5 flex-shrink-0" />
									<span>
										{isSingleDay
											? 'You are looking at an older day’s register. Go back to today to scan cards.'
											: 'You are looking at a range of days. Go back to today to scan cards.'}
									</span>
									<Button variant="outline" size="sm" className="h-8 ml-auto" onClick={backToToday}>
										Back to today
									</Button>
								</div>
							)}

							{/* The answer to the scan, big enough to read from the door */}
							{canScan && refused && (
								<div className={`flex items-center gap-4 mt-3 pt-3 border-t ${refused.repeat ? '' : ''}`}>
									<div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${refused.repeat ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-destructive/10'}`}>
										{refused.member?.photo_url
											? <Avatar className="h-14 w-14"><AvatarImage src={refused.member.photo_url} alt="" /><AvatarFallback>{initials(refused.member.display_name ?? '?')}</AvatarFallback></Avatar>
											: refused.repeat
												? <UserCheck className="h-7 w-7 text-amber-700 dark:text-amber-400" />
												: <AlertTriangle className="h-7 w-7 text-destructive" />}
									</div>
									<div className="min-w-0 flex-1">
										<div className={`text-base font-semibold font-heading ${refused.repeat ? 'text-amber-800 dark:text-amber-300' : 'text-destructive'}`}>
											{refused.repeat ? 'Already in' : 'Not found'}
										</div>
										<div className="text-sm text-muted-foreground">{refused.message}</div>
									</div>
									<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRefused(null)} aria-label="Dismiss">
										<X className="h-4 w-4" />
									</Button>
								</div>
							)}
							{canScan && !refused && last && (
								<div className={`flex items-center gap-4 mt-3 pt-3 border-t ${last.direction === 'in' ? '' : 'opacity-90'}`}>
									<Avatar className="h-14 w-14">
										{last.member.photo_url && <AvatarImage src={last.member.photo_url} alt={last.member.display_name ?? ''} />}
										<AvatarFallback className="text-sm bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
											{initials(last.member.display_name ?? last.member.member_number)}
										</AvatarFallback>
									</Avatar>
									<div className="min-w-0">
										<div className="text-base font-semibold font-heading truncate">
											{last.member.display_name ?? last.member.member_number}
										</div>
										<div className="text-xs text-muted-foreground font-mono">
											{last.member.member_number}
											<span className="ml-2 font-sans">
												{CATEGORY_LABELS[last.member.member_category] ?? last.member.member_category}
											</span>
										</div>
									</div>
									<div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${
										last.direction === 'in'
											? 'bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400'
											: 'bg-brand-yellow-100 text-brand-yellow-800 dark:bg-brand-yellow-900/30 dark:text-brand-yellow-500'
									}`}>
										{last.direction === 'in' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
										<span>{last.direction === 'in' ? 'IN' : 'OUT'}</span>
										<span className="font-normal tabular-nums">{formatClockTime(last.at)}</span>
									</div>
								</div>
							)}

							{/* The last few, so the queue can be checked without scrolling */}
							{canScan && recent.length > 1 && (
								<div className="mt-3 flex flex-wrap items-center gap-1.5">
									<span className="text-[11px] text-muted-foreground mr-1">Recent</span>
									{recent.slice(1).map((r, i) => (
										<span key={`${r.visit?.id ?? r.member.id}-${i}`} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
											{r.direction === 'in'
												? <LogIn className="h-3 w-3 text-brand-green dark:text-brand-green-400" />
												: <LogOut className="h-3 w-3 text-brand-yellow-800 dark:text-brand-yellow-500" />}
											<span className="font-medium max-w-[140px] truncate">{r.member.display_name ?? r.member.member_number}</span>
											<span className="text-muted-foreground tabular-nums">{formatClockTime(r.at)}</span>
										</span>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Each number is the filter it names */}
					<div className="grid grid-cols-2 gap-3">
						<button type="button" className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green" onClick={() => patch({ status: view.status === 'inside' ? 'all' : 'inside' })} aria-label="Show only people still inside">
							<Card className={`border-l-4 border-l-brand-green dark:border-l-brand-green-400 h-full ${view.status === 'inside' ? activeCard : ''}`}>
								<CardContent className="p-4">
									<p className="text-2xl font-bold font-heading text-brand-green dark:text-brand-green-400 tabular-nums">{inside.length}</p>
									<p className="text-xs text-muted-foreground mt-0.5">{isToday ? 'Inside now' : 'Still open'}</p>
								</CardContent>
							</Card>
						</button>
						<button type="button" className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green" onClick={() => patch({ status: 'all', cat: 'all', q: '' })} aria-label="Show everyone">
							<Card className={`border-l-4 border-l-brand-yellow h-full ${view.status === 'all' && view.cat === 'all' && !view.q ? activeCard : ''}`}>
								<CardContent className="p-4">
									<p className="text-2xl font-bold font-heading text-brand-yellow-800 dark:text-brand-yellow-500 tabular-nums">{visits.length}</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										{isToday ? "Today's footfall" : 'Footfall'}
										{people > 0 && people !== visits.length && <span> · {people} people</span>}
									</p>
								</CardContent>
							</Card>
						</button>
					</div>
				</div>

				{/* Earlier days nobody closed */}
				{stale && institutionId && (
					<div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700 flex-shrink-0">
						<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
						<span>
							<strong>{stale.count}</strong> {stale.count === 1 ? 'person is' : 'people are'} still showing as inside from earlier days (last: {shortDate(stale.lastDate)}).
							They will be marked out at the library’s closing time on their own day.
						</span>
						<Button variant="outline" size="sm" className="h-6 ml-auto text-xs" onClick={closeStale} disabled={closingStale}>
							{closingStale ? 'Closing…' : `Close ${stale.count === 1 ? 'it' : 'them'}`}
						</Button>
					</div>
				)}

				{/* The register itself */}
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex items-center justify-between gap-2 flex-wrap">
							<div>
								<h2 className="text-base font-semibold font-heading">Gate Register</h2>
								<p className="text-xs text-muted-foreground">
									{isSingleDay ? longDate(fromDate) : `${shortDate(fromDate)} – ${shortDate(toDate)}`}
									{!isToday && (
										<span className="ml-2 text-amber-600">{isSingleDay ? '· past day' : '· range'}</span>
									)}
									{refreshing && <RefreshCw className="inline h-3 w-3 ml-2 animate-spin text-muted-foreground" />}
								</p>
							</div>
							<div className="flex items-center gap-1.5 flex-wrap">
								{/* One press for the days asked for every day; the pickers for the rest */}
								<button type="button" className={chip(preset === 'today')} onClick={backToToday}>Today</button>
								<button type="button" className={chip(preset === 'yesterday')} onClick={() => showDay(addDays(today, -1))}>Yesterday</button>
								<button type="button" className={chip(preset === 'week')} onClick={() => showRange(startOfWeek(today), today)}>This week</button>
								<button type="button" className={chip(preset === 'month')} onClick={() => showRange(`${today.slice(0, 8)}01`, today)}>This month</button>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={() => stepDays(-1)} aria-label="A day earlier">
											<ChevronLeft className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>A day earlier (←)</TooltipContent>
								</Tooltip>
								<Input
									type="date"
									aria-label="From date"
									value={fromDate}
									max={today}
									onChange={e => pickFrom(e.target.value)}
									className="h-8 w-[150px] shrink-0 text-sm"
								/>
								<span className="text-xs text-muted-foreground">to</span>
								<Input
									type="date"
									aria-label="To date"
									value={toDate}
									max={today}
									onChange={e => pickTo(e.target.value)}
									className="h-8 w-[150px] shrink-0 text-sm"
								/>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={() => stepDays(1)} disabled={toDate >= today} aria-label="A day later">
											<ChevronRight className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>A day later (→)</TooltipContent>
								</Tooltip>
								<div className="relative w-full sm:w-[200px]">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										ref={searchRef}
										placeholder="Name, ID or programme  ( / )"
										value={view.q}
										onChange={e => patch({ q: e.target.value })}
										onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); patch({ q: '' }) } }}
										className="pl-8 pr-7 h-8 text-sm"
									/>
									{view.q && (
										<button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => patch({ q: '' })}>
											<X className="h-3.5 w-3.5" />
										</button>
									)}
								</div>
								{/* Closing is done a day at a time, so it is offered on one day only */}
								{isSingleDay && inside.length > 0 && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="outline" className="h-8 text-sm px-3" onClick={() => setConfirmClose(true)}>
												<DoorClosed className="h-4 w-4 mr-1.5" />
												<span className="hidden sm:inline">Close day</span>
												<span className="ml-1 tabular-nums">· {inside.length}</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>Mark everyone still inside as gone home</TooltipContent>
									</Tooltip>
								)}
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={exportRegister}>
											<Download className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{isSingleDay ? 'Export this day to Excel' : 'Export these days to Excel'} — with a by-day sheet</TooltipContent>
								</Tooltip>
								<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={() => fetchData(true)} aria-label="Read again">
									<RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
								</Button>
							</div>
						</div>

						{/* Who, as chips */}
						<div className="flex items-center gap-1.5 flex-wrap mt-2">
							<button type="button" className={chip(view.status === 'all')} onClick={() => patch({ status: 'all' })}>All</button>
							<button type="button" className={chip(view.status === 'inside')} onClick={() => patch({ status: 'inside' })}>Inside · {inside.length}</button>
							<button type="button" className={chip(view.status === 'left')} onClick={() => patch({ status: 'left' })}>Left · {visits.length - inside.length}</button>
							<span className="mx-1 h-4 w-px bg-border" />
							<button type="button" className={chip(view.cat === 'learner')} onClick={() => patch({ cat: view.cat === 'learner' ? 'all' : 'learner' })}>Learners</button>
							<button type="button" className={chip(view.cat === 'facilitator')} onClick={() => patch({ cat: view.cat === 'facilitator' ? 'all' : 'facilitator' })}>Staff</button>
							{(view.q || view.status !== 'all' || view.cat !== 'all') && (
								<span className="ml-auto text-xs text-muted-foreground tabular-nums">{filtered.length} of {visits.length}</span>
							)}
						</div>
					</CardHeader>

					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* A run of days is read as days first, rows second */}
						{!isSingleDay && byDay.length > 0 && (
							<div className="mt-3 rounded-md border overflow-hidden flex-shrink-0">
								<div className="max-h-[200px] overflow-auto">
									<Table>
										<TableHeader className="sticky top-0 z-10 bg-muted/50">
											<TableRow>
												<TableHead className="text-xs font-semibold">Day</TableHead>
												<TableHead className="text-xs font-semibold w-[100px] text-right">Footfall</TableHead>
												<TableHead className="text-xs font-semibold w-[100px] text-right">People</TableHead>
												<TableHead className="text-xs font-semibold w-[120px]">Peak hour</TableHead>
												<TableHead className="text-xs font-semibold w-[90px] text-right">Still open</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{byDay.map(d => (
												<TableRow key={d.date} className="cursor-pointer hover:bg-muted/50" onClick={() => showDay(d.date)}>
													<TableCell className="text-sm">{shortDate(d.date)}</TableCell>
													<TableCell className="text-sm text-right tabular-nums">{d.footfall}</TableCell>
													<TableCell className="text-sm text-right tabular-nums">{d.people}</TableCell>
													<TableCell className="text-sm text-muted-foreground">{d.peak}</TableCell>
													<TableCell className="text-sm text-right tabular-nums">{d.open > 0 ? <span className="text-amber-600">{d.open}</span> : '—'}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						)}

						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[300px]">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Member</TableHead>
											<TableHead className="text-xs font-semibold w-[130px]">ID</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold w-[80px]">College</TableHead>}
											{/* Which day, once the register spans more than one */}
											{!isSingleDay && <TableHead className="text-xs font-semibold w-[120px]">Date</TableHead>}
											<TableHead className="text-xs font-semibold w-[110px] hidden sm:table-cell">Category</TableHead>
											<TableHead className="text-xs font-semibold w-[100px]">In</TableHead>
											<TableHead className="text-xs font-semibold w-[100px]">Out</TableHead>
											<TableHead className="text-xs font-semibold w-[120px] hidden md:table-cell">Stayed</TableHead>
											<TableHead className="text-xs font-semibold w-[150px]">Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
												</TableCell>
											</TableRow>
										) : filtered.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Users className="h-8 w-8 opacity-20" />
														<span className="text-sm">
															{view.q || view.status !== 'all' || view.cat !== 'all'
																? 'Nobody matches that'
																: isToday
																	? 'Nobody has come in yet today'
																	: isSingleDay
																		? 'Nobody came in on this day'
																		: 'Nobody came in on these days'}
														</span>
													</div>
												</TableCell>
											</TableRow>
										) : paged.map(v => (
											<TableRow key={v.id} className="hover:bg-muted/50">
												<TableCell className="text-sm">
													{/* The name opens the person — loans, fines, visits — on the Members page */}
													{v.myjkkn_id && v.person_kind ? (
														<Link
															href={`/members?open=${encodeURIComponent(`${v.person_kind}:${v.myjkkn_id}`)}`}
															className="font-medium hover:text-brand-green hover:underline dark:hover:text-brand-green-400"
														>
															{v.member?.display_name ?? '—'}
														</Link>
													) : (
														<span className="font-medium">{v.member?.display_name ?? '—'}</span>
													)}
													{v.role_label && <div className="text-[11px] text-muted-foreground truncate max-w-[320px]">{v.role_label}</div>}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground font-mono">{v.member?.member_number ?? '—'}</TableCell>
												{mustSelectInstitution && <TableCell className="text-sm">{institutionCodeOf.get(v.institution_id ?? '') ?? '—'}</TableCell>}
												{!isSingleDay && <TableCell className="text-sm tabular-nums">{shortDate(v.visit_date)}</TableCell>}
												<TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
													{CATEGORY_LABELS[v.member?.member_category ?? ''] ?? v.member?.member_category ?? '—'}
												</TableCell>
												<TableCell className="text-sm tabular-nums">{formatClockTime(v.entry_time)}</TableCell>
												<TableCell className="text-sm tabular-nums">{formatClockTime(v.exit_time)}</TableCell>
												<TableCell className="text-sm text-muted-foreground hidden md:table-cell tabular-nums">
													{v.exit_time ? stayedSoFar(v) : (isToday && v.entry_time ? <span>in since {formatClockTime(v.entry_time)} · {stayedSoFar(v)}</span> : '—')}
												</TableCell>
												<TableCell>
													{v.exit_time ? (
														<Badge variant="outline" className="text-xs">Left</Badge>
													) : (
														// The badge is the button: one press marks them out, for the
														// ones who walked past the scanner on the way home
														<Tooltip>
															<TooltipTrigger asChild>
																<button
																	type="button"
																	onClick={() => markExit(v.id)}
																	className="inline-flex h-6 items-center gap-1 rounded-full border border-brand-green-200 bg-brand-green-50 px-2 text-xs font-medium text-brand-green-700 transition-colors hover:border-brand-green hover:bg-brand-green-100 dark:border-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400"
																>
																	Inside
																	<span className="text-brand-green-700/70 dark:text-brand-green-400/70">· mark out</span>
																</button>
															</TooltipTrigger>
															<TooltipContent>Mark this person out now</TooltipContent>
														</Tooltip>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>

						{totalPages > 1 && (
							<div className="flex items-center justify-end gap-1 pt-2 flex-shrink-0">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{(currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length}
								</span>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous rows">
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next rows">
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						)}
					</CardContent>
				</Card>

				<AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Close the register for this day?</AlertDialogTitle>
							<AlertDialogDescription>
								<strong>{inside.length}</strong> {inside.length === 1 ? 'person is' : 'people are'} still showing as inside.
								They will be marked out at the library&apos;s closing time — the honest answer when nobody
								saw them leave. Do this at the end of the day, not in the middle of it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={closeDay} disabled={closingDay}>
								{closingDay ? 'Closing...' : `Mark ${inside.length} out`}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</TooltipProvider>
	)
}
