'use client'

/**
 * Circulation Reports — every report a librarian can draw from the loan log.
 *
 * Reached from the Circulation Summary tile on the Reports Dashboard. It used
 * to open the Circulation Desk, which is a place to issue books, not a place to
 * answer questions about them.
 *
 * The page holds no knowledge of any individual report. It asks the API for one
 * by name and draws whatever columns come back, so adding a fifteenth report is
 * a change on the server and nothing here — no new table, no new export code,
 * no column list to keep in step.
 *
 * Both exports work off exactly what is on screen: the same rows, the same
 * columns, in the same order, so nobody has to wonder whether the file matches
 * what they were looking at.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
	Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
	Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	ArrowLeftRight, ArrowLeft, RefreshCw, Search, FileSpreadsheet, FileText,
	Info, CalendarDays, Building2, Lock,
} from 'lucide-react'

// ── What the API can produce ────────────────────────────────────────────────

interface Column {
	key: string
	label: string
	type: 'text' | 'number' | 'money' | 'date' | 'datetime'
}

interface Total {
	label: string
	value: string | number
	type?: Column['type']
}

interface ReportPayload {
	report: string
	from: string
	to: string
	columns: Column[]
	rows: Record<string, any>[]
	totals: Total[]
	ignoresDateRange?: boolean
	note?: string
	generated_at: string
}

/**
 * The menu of reports, grouped the way a librarian thinks about them rather
 * than the way the data is stored. Names match the API's `report` values.
 */
const REPORT_GROUPS: { group: string; reports: { key: string; label: string; hint: string }[] }[] = [
	{
		group: 'The log',
		reports: [
			{ key: 'transactions', label: 'Transaction log', hint: 'Every issue, return and renewal, one row each' },
			{ key: 'daily', label: 'Activity by day', hint: 'How many books moved each day' },
			{ key: 'monthly', label: 'Activity by month', hint: 'The same, month by month' },
		],
	},
	{
		group: 'Right now',
		reports: [
			{ key: 'on_loan', label: 'Currently on loan', hint: 'What is out of the library at this moment' },
			{ key: 'overdue', label: 'Overdue', hint: 'What is late, by how long, and what it would cost' },
		],
	},
	{
		group: 'People',
		reports: [
			{ key: 'by_member', label: 'By member', hint: 'One line per member who borrowed' },
			{ key: 'top_borrowers', label: 'Top borrowers', hint: 'The fifty most active members' },
			{ key: 'by_category', label: 'By member category', hint: 'Learners against facilitators' },
			{ key: 'desk_activity', label: 'Desk activity', hint: 'Which staff member issued and returned what' },
		],
	},
	{
		group: 'Books',
		reports: [
			{ key: 'most_borrowed', label: 'Most borrowed titles', hint: 'What to buy more of' },
			{ key: 'never_borrowed', label: 'Never borrowed', hint: 'Copies nobody has ever taken out' },
			{ key: 'by_location', label: 'By shelf location', hint: 'Which sections move' },
			{ key: 'by_format', label: 'By resource type', hint: 'Books against theses, reports and the rest' },
		],
	},
	{
		group: 'Money',
		reports: [
			{ key: 'fines', label: 'Late charges', hint: 'Raised, collected, waived and still owed' },
		],
	},
]

const ALL_REPORTS = REPORT_GROUPS.flatMap(g => g.reports)

/** Ready-made date ranges, because typing two dates for "this month" is silly. */
const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
	{ key: 'today', label: 'Today', range: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
	{ key: '7', label: 'Last 7 days', range: () => ({ from: iso(daysAgo(6)), to: iso(new Date()) }) },
	{ key: '30', label: 'Last 30 days', range: () => ({ from: iso(daysAgo(29)), to: iso(new Date()) }) },
	{ key: '90', label: 'Last 90 days', range: () => ({ from: iso(daysAgo(89)), to: iso(new Date()) }) },
	{
		key: 'month',
		label: 'This month',
		range: () => {
			const now = new Date()
			return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
		},
	},
	{
		key: 'year',
		label: 'This year',
		range: () => {
			const now = new Date()
			return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) }
		},
	},
]

function iso(date: Date): string {
	// Local date, not UTC — "today" must mean today at this desk, not in Greenwich
	const offset = date.getTimezoneOffset() * 60_000
	return new Date(date.getTime() - offset).toISOString().substring(0, 10)
}

function daysAgo(count: number): Date {
	const date = new Date()
	date.setDate(date.getDate() - count)
	return date
}

// ── Drawing one cell ────────────────────────────────────────────────────────

const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

/** For the screen. */
function formatCell(value: any, type: Column['type']): string {
	if (value === null || value === undefined || value === '') return '—'

	if (type === 'money') {
		const number = Number(value)
		return Number.isFinite(number) ? MONEY.format(number) : String(value)
	}
	if (type === 'number') {
		const number = Number(value)
		return Number.isFinite(number) ? number.toLocaleString('en-IN') : String(value)
	}
	if (type === 'date') {
		const date = new Date(`${String(value).substring(0, 10)}T00:00:00`)
		return Number.isNaN(date.getTime())
			? String(value)
			: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
	}
	if (type === 'datetime') {
		const date = new Date(value)
		return Number.isNaN(date.getTime())
			? String(value)
			: date.toLocaleString('en-GB', {
				day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
			})
	}
	return String(value)
}

/**
 * For a spreadsheet.
 *
 * Numbers and money go out as numbers, not as "₹1,234.00" text, because a
 * report somebody cannot sum in Excel is a picture of a report.
 */
function exportCell(value: any, type: Column['type']): string | number | null {
	if (value === null || value === undefined || value === '') return null
	if (type === 'money' || type === 'number') {
		const number = Number(value)
		return Number.isFinite(number) ? number : String(value)
	}
	return formatCell(value, type)
}

const formatTotal = (total: Total): string =>
	typeof total.value === 'number' || total.type
		? formatCell(total.value, total.type ?? 'number')
		: String(total.value)

// ── The page ────────────────────────────────────────────────────────────────

export default function CirculationReportsPage() {
	const { isReady, institutionId, mustSelectInstitution } = useInstitutionFilter()
	const { toast } = useToast()

	const [report, setReport] = useState('transactions')
	const [preset, setPreset] = useState('30')
	const [{ from, to }, setRange] = useState(() => PRESETS[2].range())
	const [category, setCategory] = useState('all')
	const [searchTerm, setSearchTerm] = useState('')
	const [search, setSearch] = useState('')

	const [data, setData] = useState<ReportPayload | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const current = useMemo(() => ALL_REPORTS.find(r => r.key === report) ?? ALL_REPORTS[0], [report])

	const fetchReport = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			setError(null)

			const params = new URLSearchParams({ report, from, to, institution_id: institutionId })
			if (category !== 'all') params.set('category', category)
			if (search) params.set('search', search)

			const res = await fetch(`/api/lib/reports/circulation?${params}`)
			const json = await res.json()

			if (!res.ok) {
				setError(json.error || 'Could not build the report')
				setData(null)
				return
			}
			setData(json)
		} catch {
			setError('Could not reach the server')
			setData(null)
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, report, from, to, category, search])

	useEffect(() => { fetchReport() }, [fetchReport])

	// Typing should not fire a request per keystroke
	useEffect(() => {
		const timer = setTimeout(() => setSearch(searchTerm.trim()), 400)
		return () => clearTimeout(timer)
	}, [searchTerm])

	const applyPreset = (key: string) => {
		setPreset(key)
		const found = PRESETS.find(p => p.key === key)
		if (found) setRange(found.range())
	}

	const fileStem = useMemo(
		() => `${report.replace(/_/g, '-')}-${from}-to-${to}`,
		[report, from, to]
	)

	const exportExcel = () => {
		if (!data || data.rows.length === 0) return
		try {
			const sheet = XLSX.utils.json_to_sheet(
				data.rows.map(row => {
					const out: Record<string, any> = {}
					for (const column of data.columns) out[column.label] = exportCell(row[column.key], column.type)
					return out
				})
			)
			sheet['!cols'] = data.columns.map(column => ({ wch: Math.max(12, Math.min(46, column.label.length + 8)) }))

			const book = XLSX.utils.book_new()
			// A sheet name is capped at 31 characters and cannot hold : \ / ? * [ ]
			XLSX.utils.book_append_sheet(book, sheet, current.label.replace(/[:\\/?*[\]]/g, '').substring(0, 31))
			XLSX.writeFile(book, `${fileStem}.xlsx`)

			toast({
				title: '✅ Excel downloaded',
				description: `${data.rows.length} row${data.rows.length === 1 ? '' : 's'}.`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
		} catch {
			toast({ title: '❌ Could not build the Excel file', variant: 'destructive' })
		}
	}

	const exportPdf = () => {
		if (!data || data.rows.length === 0) return
		try {
			// Landscape, because these reports are wide and a squeezed table is
			// the reason people go back to asking for a spreadsheet
			const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
			const width = doc.internal.pageSize.getWidth()

			doc.setFontSize(14)
			doc.setFont('helvetica', 'bold')
			doc.text(current.label, 14, 16)

			doc.setFontSize(9)
			doc.setFont('helvetica', 'normal')
			doc.setTextColor(90)
			const period = data.ignoresDateRange
				? 'As of today'
				: `${formatCell(data.from, 'date')} to ${formatCell(data.to, 'date')}`
			doc.text(period, 14, 22)
			doc.text(
				`Generated ${formatCell(data.generated_at, 'datetime')} · ${data.rows.length} rows`,
				width - 14,
				22,
				{ align: 'right' }
			)

			// The headline figures, so the first page answers the question even
			// before anybody reads the table
			const summary = data.totals.map(total => `${total.label}: ${formatTotal(total)}`).join('    ')
			doc.setTextColor(30)
			doc.text(doc.splitTextToSize(summary, width - 28), 14, 28)

			autoTable(doc, {
				startY: 34 + Math.max(0, doc.splitTextToSize(summary, width - 28).length - 1) * 4,
				head: [data.columns.map(column => column.label)],
				body: data.rows.map(row => data.columns.map(column => formatCell(row[column.key], column.type))),
				styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
				headStyles: { fillColor: [11, 109, 65], textColor: 255, fontStyle: 'bold' },
				alternateRowStyles: { fillColor: [246, 249, 247] },
				margin: { left: 14, right: 14 },
			})

			doc.save(`${fileStem}.pdf`)
			toast({
				title: '✅ PDF downloaded',
				description: `${data.rows.length} row${data.rows.length === 1 ? '' : 's'}.`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
		} catch {
			toast({ title: '❌ Could not build the PDF', variant: 'destructive' })
		}
	}

	// A circulation report belongs to one library — the rules, the rates and the
	// shelves are all per college, so there is nothing sensible to add up across
	if (isReady && mustSelectInstitution) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="w-full max-w-md border-l-4 border-l-brand-yellow">
					<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
						<Building2 className="h-9 w-9 text-brand-yellow-700/60" />
						<h2 className="text-base font-semibold font-heading">Choose a college first</h2>
						<p className="text-sm text-muted-foreground">
							Every library sets its own loan rules and its own charges, so a circulation
							report only means something for one college at a time. Pick one in the
							switcher at the top.
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
				{/* Where you are, and the way back */}
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-50 dark:bg-brand-green-900/20">
							<ArrowLeftRight className="h-5 w-5 text-brand-green dark:text-brand-green-400" />
						</div>
						<div>
							<h1 className="text-lg font-semibold font-heading">Circulation Reports</h1>
							<p className="text-xs text-muted-foreground">
								Everything that has happened at the desk — issued, returned, renewed,
								overdue and charged
							</p>
						</div>
					</div>
					<Button asChild variant="outline" size="sm" className="h-8 text-xs">
						<Link href="/reports">
							<ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
							Reports Dashboard
						</Link>
					</Button>
				</div>

				<div className="grid gap-4 lg:grid-cols-[260px_1fr]">
					{/* The menu of reports */}
					<Card className="h-fit lg:sticky lg:top-2">
						<CardHeader className="border-b px-4 py-3">
							<h2 className="text-sm font-semibold font-heading">Reports</h2>
							<p className="text-xs text-muted-foreground">{ALL_REPORTS.length} to choose from</p>
						</CardHeader>
						<CardContent className="p-2">
							{REPORT_GROUPS.map(group => (
								<div key={group.group} className="mb-2 last:mb-0">
									<p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										{group.group}
									</p>
									{group.reports.map(entry => {
										const active = entry.key === report
										return (
											<Tooltip key={entry.key}>
												<TooltipTrigger asChild>
													<button
														type="button"
														onClick={() => setReport(entry.key)}
														className={
															'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ' +
															(active
																? 'bg-brand-green-50 font-medium text-brand-green-800 dark:bg-brand-green-900/25 dark:text-brand-green-300'
																: 'hover:bg-muted/60')
														}
													>
														{entry.label}
													</button>
												</TooltipTrigger>
												<TooltipContent side="right" className="max-w-56">{entry.hint}</TooltipContent>
											</Tooltip>
										)
									})}
								</div>
							))}
						</CardContent>
					</Card>

					<div className="flex min-w-0 flex-col gap-4">
						{/* Filters */}
						<Card>
							<CardContent className="flex flex-wrap items-end gap-3 p-3">
								<div className="min-w-[150px] flex-1">
									<label className="mb-1 block text-[11px] font-medium text-muted-foreground">Period</label>
									<Select value={preset} onValueChange={applyPreset}>
										<SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
										<SelectContent>
											{PRESETS.map(p => (
												<SelectItem key={p.key} value={p.key} className="text-xs">{p.label}</SelectItem>
											))}
											<SelectItem value="custom" className="text-xs">Custom</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div>
									<label className="mb-1 block text-[11px] font-medium text-muted-foreground">From</label>
									<Input
										type="date"
										value={from}
										max={to}
										onChange={e => { setPreset('custom'); setRange(r => ({ ...r, from: e.target.value })) }}
										className="h-8 w-[145px] text-xs"
									/>
								</div>
								<div>
									<label className="mb-1 block text-[11px] font-medium text-muted-foreground">To</label>
									<Input
										type="date"
										value={to}
										min={from}
										onChange={e => { setPreset('custom'); setRange(r => ({ ...r, to: e.target.value })) }}
										className="h-8 w-[145px] text-xs"
									/>
								</div>

								<div className="min-w-[130px]">
									<label className="mb-1 block text-[11px] font-medium text-muted-foreground">Member type</label>
									<Select value={category} onValueChange={setCategory}>
										<SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="all" className="text-xs">Everyone</SelectItem>
											<SelectItem value="learner" className="text-xs">Learners</SelectItem>
											<SelectItem value="facilitator" className="text-xs">Facilitators</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div className="min-w-[190px] flex-1">
									<label className="mb-1 block text-[11px] font-medium text-muted-foreground">Search</label>
									<div className="relative">
										<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
										<Input
											placeholder="Member, accession or title..."
											value={searchTerm}
											onChange={e => setSearchTerm(e.target.value)}
											className="h-8 pl-8 text-xs"
										/>
									</div>
								</div>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchReport}>
											<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Run again</TooltipContent>
								</Tooltip>
							</CardContent>

							{data?.ignoresDateRange && (
								<div className="flex items-start gap-2 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
									<Lock className="mt-0.5 h-3 w-3 flex-shrink-0" />
									<span>{data.note}</span>
								</div>
							)}
						</Card>

						{/* Headline figures */}
						{data && data.totals.length > 0 && (
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								{data.totals.map(total => (
									<Card key={total.label} className="border-l-4 border-l-brand-green dark:border-l-brand-green-400">
										<CardContent className="p-3">
											<p className="truncate text-xl font-bold tracking-tight font-heading text-brand-green dark:text-brand-green-400">
												{formatTotal(total)}
											</p>
											<p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
												{total.label}
											</p>
										</CardContent>
									</Card>
								))}
							</div>
						)}

						{/* The report itself */}
						<Card className="flex min-h-0 flex-1 flex-col">
							<CardHeader className="flex-shrink-0 border-b px-4 py-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="min-w-0">
										<h2 className="text-base font-semibold font-heading">{current.label}</h2>
										<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
											{data && (
												<>
													<span>{data.rows.length.toLocaleString('en-IN')} row{data.rows.length === 1 ? '' : 's'}</span>
													{!data.ignoresDateRange && (
														<>
															<span>·</span>
															<CalendarDays className="h-3 w-3" />
															<span>{formatCell(data.from, 'date')} – {formatCell(data.to, 'date')}</span>
														</>
													)}
													{category !== 'all' && (
														<Badge variant="outline" className="h-4 px-1 text-[10px] font-normal capitalize">
															{category}s
														</Badge>
													)}
													{search && (
														<Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
															“{search}”
														</Badge>
													)}
												</>
											)}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											className="h-8 text-xs"
											onClick={exportExcel}
											disabled={!data || data.rows.length === 0}
										>
											<FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
											Excel
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="h-8 text-xs"
											onClick={exportPdf}
											disabled={!data || data.rows.length === 0}
										>
											<FileText className="mr-1.5 h-3.5 w-3.5" />
											PDF
										</Button>
									</div>
								</div>
								{data?.note && !data.ignoresDateRange && (
									<div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
										<Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
										<span>{data.note}</span>
									</div>
								)}
							</CardHeader>

							<CardContent className="min-h-0 flex-1 p-4">
								<div className="min-h-[420px] overflow-hidden rounded-md border">
									<div className="h-full max-h-[62vh] overflow-auto">
										<Table>
											<TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
												<TableRow>
													{(data?.columns ?? []).map(column => (
														<TableHead
															key={column.key}
															className={
																'whitespace-nowrap text-xs font-semibold ' +
																(column.type === 'number' || column.type === 'money' ? 'text-right' : '')
															}
														>
															{column.label}
														</TableHead>
													))}
													{!data && <TableHead className="text-xs font-semibold">Report</TableHead>}
												</TableRow>
											</TableHeader>
											<TableBody>
												{loading ? (
													<TableRow>
														<TableCell colSpan={Math.max(1, data?.columns.length ?? 1)} className="h-72 text-center">
															<div className="flex flex-col items-center gap-2 text-muted-foreground">
																<RefreshCw className="h-5 w-5 animate-spin" />
																<span className="text-sm">Building the report…</span>
															</div>
														</TableCell>
													</TableRow>
												) : error ? (
													<TableRow>
														<TableCell colSpan={Math.max(1, data?.columns.length ?? 1)} className="h-72 text-center">
															<div className="flex flex-col items-center gap-1 text-destructive">
																<Info className="h-7 w-7 opacity-40" />
																<span className="text-sm">{error}</span>
															</div>
														</TableCell>
													</TableRow>
												) : !data || data.rows.length === 0 ? (
													<TableRow>
														<TableCell colSpan={Math.max(1, data?.columns.length ?? 1)} className="h-72 text-center">
															<div className="flex flex-col items-center gap-1 text-muted-foreground">
																<ArrowLeftRight className="h-8 w-8 opacity-20" />
																<span className="text-sm">Nothing to show for these dates</span>
																<span className="text-xs">Widen the period, or clear the filters above</span>
															</div>
														</TableCell>
													</TableRow>
												) : (
													data.rows.map((row, index) => (
														<TableRow key={index} className="hover:bg-muted/40">
															{data.columns.map(column => (
																<TableCell
																	key={column.key}
																	className={
																		'text-sm ' +
																		(column.type === 'number' || column.type === 'money'
																			? 'text-right tabular-nums'
																			: '') +
																		(column.key === 'title' ? ' max-w-[320px] truncate' : '')
																	}
																	title={column.key === 'title' ? String(row[column.key] ?? '') : undefined}
																>
																	{formatCell(row[column.key], column.type)}
																</TableCell>
															))}
														</TableRow>
													))
												)}
											</TableBody>
										</Table>
									</div>
								</div>

								{data && data.rows.length > 0 && (
									<>
										<Separator className="my-3" />
										<p className="text-[11px] text-muted-foreground">
											Generated {formatCell(data.generated_at, 'datetime')} · Excel and PDF
											contain exactly these rows and columns
										</p>
									</>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</TooltipProvider>
	)
}
