'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, History, Loader2, Play, Table2, Trash2 } from 'lucide-react'
import { SQL_SAMPLES, SQL_TABLES } from '@/lib/library/reports/catalog'
import { ReportResult, type ReportResultData } from './report-result'
import { cn } from '@/lib/utils'

const HISTORY_KEY = 'lib:reports:sql-history'
const HISTORY_MAX = 20

interface HistoryEntry {
	sql: string
	at: string
	rows: number
}

function readHistory(): HistoryEntry[] {
	try {
		const raw = window.localStorage.getItem(HISTORY_KEY)
		const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : []
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

function writeHistory(entries: HistoryEntry[]): void {
	try {
		window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)))
	} catch {
		// Storage refused: history lasts for this visit only
	}
}

/**
 * A query typed by hand, run against this college and nothing else.
 *
 * The server checks the query and the database runs it read-only, so the box
 * can be generous: Ctrl+Enter runs, the last twenty queries are kept in this
 * browser, and the tables a query may use are listed beside it with their
 * useful columns.
 */
export function SqlRunner({ institutionId, college }: { institutionId: string | null; college: string }) {
	const [sql, setSql] = useState(SQL_SAMPLES[0].sql)
	const [running, setRunning] = useState(false)
	const [data, setData] = useState<ReportResultData | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [detail, setDetail] = useState<string | null>(null)
	const [ms, setMs] = useState<number | null>(null)
	const [history, setHistory] = useState<HistoryEntry[]>([])
	const [tablesOpen, setTablesOpen] = useState(false)
	const [historyOpen, setHistoryOpen] = useState(false)

	useEffect(() => { setHistory(readHistory()) }, [])

	const run = useCallback(async () => {
		if (!institutionId || running) return
		setRunning(true)
		setError(null)
		setDetail(null)
		try {
			const res = await fetch('/api/lib/reports/sql', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, sql }),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				setData(null)
				setError(json.error || 'The query failed')
				setDetail(json.detail ?? null)
				return
			}
			setData(json)
			setMs(json.ms ?? null)
			const entry: HistoryEntry = { sql: sql.trim(), at: new Date().toISOString(), rows: json.total ?? 0 }
			setHistory(prev => {
				const next = [entry, ...prev.filter(h => h.sql !== entry.sql)].slice(0, HISTORY_MAX)
				writeHistory(next)
				return next
			})
		} catch {
			setData(null)
			setError('Could not reach the server')
		} finally {
			setRunning(false)
		}
	}, [institutionId, running, sql])

	const clearHistory = () => {
		setHistory([])
		writeHistory([])
	}

	const asTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

	return (
		<div className="min-w-0 max-w-full space-y-4">
			<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
				<div className="space-y-2">
					<Textarea
						value={sql}
						onChange={e => setSql(e.target.value)}
						onKeyDown={e => {
							if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run() }
						}}
						spellCheck={false}
						rows={10}
						className="font-mono text-sm"
						placeholder="select … from lib_items where …"
						aria-label="SQL query"
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => { void run() }} disabled={running || !institutionId || !sql.trim()} className="h-9">
							{running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
							Run
							<kbd className="ml-2 hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">Ctrl+Enter</kbd>
						</Button>
						{ms !== null && data && !error && (
							<span className="text-xs text-muted-foreground">{ms} ms</span>
						)}
						<span className="ml-auto text-[11px] text-muted-foreground">
							SELECT only · this college only · 5,000 rows · 60 seconds
						</span>
					</div>

					<div className="flex flex-wrap gap-1.5">
						<span className="self-center text-[11px] text-muted-foreground">Start from:</span>
						{SQL_SAMPLES.map(sample => (
							<button
								key={sample.title}
								type="button"
								onClick={() => setSql(sample.sql)}
								className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{sample.title}
							</button>
						))}
					</div>
				</div>

				<div className="space-y-2">
					<Collapsible open={tablesOpen} onOpenChange={setTablesOpen} className="rounded-lg border">
						<CollapsibleTrigger asChild>
							<button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
								<Table2 className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">Tables you can use</span>
								<Badge variant="outline" className="text-[10px]">{SQL_TABLES.length}</Badge>
								<ChevronDown className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', tablesOpen && 'rotate-180')} />
							</button>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<ul className="max-h-80 space-y-1.5 overflow-y-auto border-t px-3 py-2">
								{SQL_TABLES.map(table => (
									<li key={table.name} className="text-xs">
										<button type="button" className="font-mono font-medium hover:underline" onClick={() => setSql(s => s + (s.endsWith(' ') || s === '' ? '' : ' ') + table.name)} title="Add to the query">
											{table.name}
										</button>
										<span className="block text-muted-foreground">{table.note}</span>
									</li>
								))}
							</ul>
						</CollapsibleContent>
					</Collapsible>

					<Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="rounded-lg border">
						<CollapsibleTrigger asChild>
							<button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
								<History className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">Your last queries</span>
								<Badge variant="outline" className="text-[10px]">{history.length}</Badge>
								<ChevronDown className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', historyOpen && 'rotate-180')} />
							</button>
						</CollapsibleTrigger>
						<CollapsibleContent>
							{history.length === 0 ? (
								<p className="border-t px-3 py-2 text-xs text-muted-foreground">Nothing run yet in this browser.</p>
							) : (
								<div className="border-t">
									<ul className="max-h-72 divide-y overflow-y-auto">
										{history.map(entry => (
											<li key={entry.at}>
												<button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => setSql(entry.sql)}>
													<span className="block truncate font-mono text-xs">{entry.sql.replace(/\s+/g, ' ')}</span>
													<span className="block text-[10px] text-muted-foreground">{asTime(entry.at)} · {entry.rows} row{entry.rows === 1 ? '' : 's'}</span>
												</button>
											</li>
										))}
									</ul>
									<button type="button" onClick={clearHistory} className="flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive">
										<Trash2 className="h-3 w-3" /> Clear
									</button>
								</div>
							)}
						</CollapsibleContent>
					</Collapsible>
				</div>
			</div>

			<ReportResult
				data={data}
				loading={running}
				error={error}
				detail={detail}
				context={{ college, title: 'SQL query', filters: sql.trim().replace(/\s+/g, ' ').slice(0, 200) }}
				emptyText="The query ran and returned no rows."
			/>
		</div>
	)
}
