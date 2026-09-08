'use client'

/**
 * Reports — every report the library can give, one college at a time.
 *
 * One tab per page of the system, each listing every report that page's data
 * can answer. Pick a report, set its filters, press Run: the rows appear on
 * screen, and go to Excel or to a clean A4 print from the same buttons. The
 * last tab takes a typed SELECT for the question no ready-made report asks.
 *
 * Nothing here writes. Every report runs through one read-only database
 * function scoped to the chosen college (migration 20260905_lib_report_sql),
 * so a report cannot see another college's shelves however it is written.
 *
 * The NAAC figures that used to fill this page live on the Dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useInstitution } from '@/context/institution-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
	BarChart3, BookOpen, Building2, Users, ArrowLeftRight, DoorOpen, Bookmark, Clock, IndianRupee,
	ShoppingCart, Package, Truck, Wallet, Newspaper, MonitorPlay, Archive, Shuffle, Wrench, ScrollText,
	Terminal, Play, Loader2, ChevronRight, Info, ExternalLink,
} from 'lucide-react'
import {
	REPORT_TABS, reportsInTab, reportById, defaultParams, type ReportDef, type ReportParam, type TabId,
} from '@/lib/library/reports/catalog'
import { ReportResult, type ReportResultData } from '@/components/library/reports/report-result'
import { SqlRunner } from '@/components/library/reports/sql-runner'
import { cn } from '@/lib/utils'

const TAB_ICONS: Record<TabId, React.ElementType> = {
	catalogue: BookOpen,
	departments: Building2,
	members: Users,
	circulation: ArrowLeftRight,
	gate: DoorOpen,
	holds: Bookmark,
	overdue: Clock,
	charges: IndianRupee,
	requests: ShoppingCart,
	orders: Package,
	suppliers: Truck,
	budget: Wallet,
	subscriptions: Newspaper,
	digital: MonitorPlay,
	retirement: Archive,
	intercampus: Shuffle,
	conservation: Wrench,
	activity: ScrollText,
	sql: Terminal,
}

const TAB_IDS = new Set<string>(REPORT_TABS.map(t => t.id))

/** What the address says, so a report can be linked to and comes back after a refresh. */
function readAddress(): { tab: TabId; report: string | null } {
	const params = new URLSearchParams(window.location.search)
	const tab = params.get('tab')
	const report = params.get('report')
	return {
		tab: tab && TAB_IDS.has(tab) ? (tab as TabId) : 'catalogue',
		report: report && reportById(report) ? report : null,
	}
}

function writeAddress(tab: TabId, report: string | null): void {
	const params = new URLSearchParams()
	if (tab !== 'catalogue') params.set('tab', tab)
	if (report) params.set('report', report)
	const query = params.toString()
	window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

/** "From 01-09-2026 · To 05-09-2026 · Status: all" for the print header. */
function describeFilters(report: ReportDef, values: Record<string, string>): string {
	const parts: string[] = []
	for (const param of report.params) {
		const value = values[param.key]
		if (!value) continue
		const shown = param.type === 'date' ? value.split('-').reverse().join('-') : param.type === 'select' ? (param.options?.find(o => o.value === value)?.label ?? value) : value
		parts.push(`${param.label}: ${shown}`)
	}
	return parts.join(' · ')
}

function ParamField({ param, value, onChange, onEnter }: { param: ReportParam; value: string; onChange: (v: string) => void; onEnter: () => void }) {
	const id = `rp-${param.key}`
	const label = (
		<Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
			{param.label}{param.optional ? '' : param.type === 'text' ? ' *' : ''}
		</Label>
	)
	if (param.type === 'select') {
		return (
			<div className="space-y-1.5">
				{label}
				<Select value={value} onValueChange={onChange}>
					<SelectTrigger id={id} className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
					<SelectContent>
						{param.options?.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
					</SelectContent>
				</Select>
			</div>
		)
	}
	return (
		<div className="space-y-1.5">
			{label}
			<Input
				id={id}
				type={param.type === 'date' ? 'date' : param.type === 'number' ? 'number' : 'text'}
				min={param.type === 'number' ? 0 : undefined}
				value={value}
				placeholder={param.placeholder}
				onChange={e => onChange(e.target.value)}
				onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
				className={`h-9 text-sm ${param.type === 'date' ? 'w-[160px]' : param.type === 'number' ? 'w-[120px]' : 'w-[220px]'}`}
			/>
			{param.hint && <p className="text-[11px] text-muted-foreground">{param.hint}</p>}
		</div>
	)
}

export default function ReportsPage() {
	const { isReady, institutionId, mustSelectInstitution } = useInstitutionFilter()
	const { selectedInstitution, currentInstitution } = useInstitution()

	const college = selectedInstitution ?? currentInstitution
	const collegeName = college?.institution_name ?? college?.institution_code ?? 'Library'

	const [tab, setTab] = useState<TabId>('catalogue')
	const [reportId, setReportId] = useState<string | null>(null)
	const [values, setValues] = useState<Record<string, string>>({})
	const [data, setData] = useState<ReportResultData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [detail, setDetail] = useState<string | null>(null)
	const [ranFilters, setRanFilters] = useState('')
	const addressRead = useRef(false)

	const report = useMemo(() => (reportId ? reportById(reportId) ?? null : null), [reportId])
	const tabReports = useMemo(() => reportsInTab(tab), [tab])

	// The address, read once, then kept up to date
	useEffect(() => {
		if (addressRead.current) return
		addressRead.current = true
		const { tab: fromTab, report: fromReport } = readAddress()
		setTab(fromTab)
		if (fromReport) {
			const def = reportById(fromReport)
			if (def) {
				setTab(def.tab)
				setReportId(def.id)
				setValues(defaultParams(def))
			}
		}
	}, [])

	useEffect(() => {
		if (addressRead.current) writeAddress(tab, reportId)
	}, [tab, reportId])

	const pick = useCallback((def: ReportDef) => {
		setReportId(def.id)
		setValues(defaultParams(def))
		setData(null)
		setError(null)
		setDetail(null)
	}, [])

	const changeTab = (next: TabId) => {
		setTab(next)
		if (next === 'sql') {
			setReportId(null)
			return
		}
		// The first report of the tab, so the tab is never a blank column
		const first = reportsInTab(next)[0]
		if (first && (!report || report.tab !== next)) pick(first)
	}

	/** True when every filter that must be filled is filled. */
	const ready = useMemo(() => {
		if (!report) return false
		return report.params.every(param => param.optional || param.type !== 'text' || (values[param.key] ?? '').trim() !== '')
	}, [report, values])

	const run = useCallback(async () => {
		if (!report || !institutionId || !ready) return
		setLoading(true)
		setError(null)
		setDetail(null)
		try {
			const params = new URLSearchParams({ report: report.id, institution_id: institutionId })
			for (const param of report.params) {
				const value = (values[param.key] ?? '').trim()
				if (value) params.set(param.key, value)
			}
			const res = await fetch(`/api/lib/reports/run?${params}`)
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				setData(null)
				setError(json.error || 'Could not build the report')
				setDetail(json.detail ?? null)
				return
			}
			setData(json)
			setRanFilters(describeFilters(report, values))
		} catch {
			setData(null)
			setError('Could not reach the server')
		} finally {
			setLoading(false)
		}
	}, [report, institutionId, ready, values])

	// A report whose filters are all filled in runs as soon as it is picked
	const lastAutoRun = useRef<string | null>(null)
	useEffect(() => {
		if (!report || !institutionId || !isReady) return
		const key = `${institutionId}:${report.id}`
		if (lastAutoRun.current === key) return
		if (!ready) return
		lastAutoRun.current = key
		void run()
	}, [report, institutionId, isReady, ready, run])

	// A different college: whatever was on screen was the other college's
	useEffect(() => {
		setData(null)
		setError(null)
	}, [institutionId])

	const noCollege = !isReady || mustSelectInstitution || !institutionId
	const currentTab = REPORT_TABS.find(t => t.id === tab)

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			<Card className="flex-shrink-0">
				<CardHeader className="px-4 py-3">
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
							<BarChart3 className="h-5 w-5 text-blue-600" />
						</div>
						<div className="min-w-0">
							<h1 className="text-base font-semibold">Reports</h1>
							<p className="text-xs text-muted-foreground">
								Every report, one college at a time — pick a tab, a report and its filters, then Run. Excel and Print sit on every result.
							</p>
						</div>
					</div>

					{/* The tabs: one per page of the system */}
					<div className="mt-3 flex flex-wrap gap-1.5">
						{REPORT_TABS.map(t => {
							const Icon = TAB_ICONS[t.id]
							const active = t.id === tab
							return (
								<button
									key={t.id}
									type="button"
									onClick={() => changeTab(t.id)}
									className={cn(
										'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
										active
											? 'border-brand-green bg-brand-green-50 font-medium text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400 dark:border-brand-green-600'
											: 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
									)}
								>
									<Icon className="h-3.5 w-3.5" />
									{t.title}
									{t.id !== 'sql' && <span className="opacity-60">{reportsInTab(t.id).length}</span>}
								</button>
							)
						})}
					</div>
				</CardHeader>
			</Card>

			{noCollege ? (
				<Card>
					<CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
						<Info className="h-5 w-5 shrink-0" />
						Choose a college in the header first — every report is one library's.
					</CardContent>
				</Card>
			) : tab === 'sql' ? (
				<Card>
					<CardContent className="p-4">
						<div className="mb-3 flex flex-wrap items-center gap-2">
							<h2 className="text-sm font-semibold">Run SQL</h2>
							<span className="text-xs text-muted-foreground">
								A SELECT of your own against {collegeName}. It reads this college's tables only, cannot write, and stops at 5,000 rows or 60 seconds.
							</span>
						</div>
						<SqlRunner institutionId={institutionId} college={collegeName} />
					</CardContent>
				</Card>
			) : (
				<div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
					{/* The reports of this tab */}
					<Card className="h-fit">
						<CardHeader className="px-4 py-3">
							<div className="flex items-center gap-2">
								<h2 className="text-sm font-semibold">{currentTab?.title}</h2>
								<Badge variant="outline" className="text-[10px]">{tabReports.length}</Badge>
								{currentTab && (
									<Link href={currentTab.page} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground hover:underline" title="The page this data comes from">
										open page <ExternalLink className="ml-0.5 inline h-3 w-3" />
									</Link>
								)}
							</div>
						</CardHeader>
						<CardContent className="p-2 pt-0">
							<ul className="space-y-0.5">
								{tabReports.map(def => {
									const active = def.id === reportId
									return (
										<li key={def.id}>
											<button
												type="button"
												onClick={() => pick(def)}
												className={cn(
													'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
													active ? 'bg-brand-green-50 dark:bg-brand-green-900/30' : 'hover:bg-muted'
												)}
											>
												<ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'text-brand-green-700 dark:text-brand-green-400' : 'text-muted-foreground/50')} />
												<span className="min-w-0">
													<span className={cn('block text-sm', active ? 'font-medium text-brand-green-700 dark:text-brand-green-400' : '')}>{def.title}</span>
													<span className="block text-[11px] leading-snug text-muted-foreground">{def.description}</span>
												</span>
											</button>
										</li>
									)
								})}
							</ul>
							{tab === 'circulation' && (
								<p className="mt-2 border-t px-2.5 pt-2 text-[11px] text-muted-foreground">
									The older <Link href="/reports/circulation" className="underline hover:text-foreground">circulation summary page</Link> is still there too.
								</p>
							)}
						</CardContent>
					</Card>

					{/* The chosen report: filters, Run, result. `h-fit` like the list
					    beside it: the grid would otherwise stretch this card to the
					    list's height and leave a blank half-page under the pagination. */}
					<Card className="min-w-0 h-fit">
						<CardContent className="min-w-0 space-y-4 p-4">
							{report ? (
								<>
									<div>
										<h2 className="text-base font-semibold">{report.title}</h2>
										<p className="text-xs text-muted-foreground">{report.description}</p>
									</div>

									<div className="flex flex-wrap items-end gap-3">
										{report.params.map(param => (
											<ParamField
												key={param.key}
												param={param}
												value={values[param.key] ?? ''}
												onChange={v => setValues(prev => ({ ...prev, [param.key]: v }))}
												onEnter={() => { void run() }}
											/>
										))}
										<Button onClick={() => { void run() }} disabled={loading || !ready} className="h-9">
											{loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
											Run
										</Button>
										{report.params.length === 0 && (
											<span className="text-xs text-muted-foreground">No filters — this report is the whole picture.</span>
										)}
									</div>

									<ReportResult
										data={data}
										loading={loading}
										error={error}
										detail={detail}
										money={report.money}
										context={{ college: collegeName, title: report.title, filters: ranFilters }}
									/>
								</>
							) : (
								<div className="flex flex-col items-center justify-center gap-1 py-16 text-sm text-muted-foreground">
									<Info className="h-6 w-6 text-muted-foreground/40" />
									Pick a report on the left.
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	)
}
