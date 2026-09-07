'use client'

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileText, Loader2, Printer } from 'lucide-react'

export type ResultRow = Record<string, unknown>

export interface ReportResultData {
	columns: string[]
	rows: ResultRow[]
	total: number
	truncated: boolean
	generated_at: string
}

/** Rows per page on screen. Ten keeps the box in view; Excel and Print carry the lot. */
const PAGE = 10

/** ₹ and Indian grouping for money; plain grouping for other numbers; text as is. */
export function formatCell(value: unknown, money: boolean): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'number') {
		return money
			? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
			: Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
	}
	if (typeof value === 'boolean') return value ? 'Yes' : 'No'
	if (typeof value === 'object') return JSON.stringify(value)
	// Postgres numerics arrive as strings; show them as numbers
	if (typeof value === 'string' && money && /^-?\d+(\.\d+)?$/.test(value)) return formatCell(Number(value), true)
	return String(value)
}

const isNumeric = (value: unknown) =>
	typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export interface PrintContext {
	college: string
	title: string
	filters: string
}

/**
 * Every report ends here: one table, paged by a hundred, with Excel and Print.
 *
 * Excel carries the raw values so numbers stay numbers. Print opens a clean
 * A4 sheet in its own window — college, report, filters, date, and the whole
 * table — rather than fighting the page's own sidebar and header.
 */
export function ReportResult({
	data,
	loading,
	error,
	detail,
	money = [],
	context,
	emptyText = 'No rows for these filters.',
}: {
	data: ReportResultData | null
	loading: boolean
	error: string | null
	detail?: string | null
	money?: string[]
	context: PrintContext
	emptyText?: string
}) {
	const [page, setPage] = useState(1)
	const moneySet = useMemo(() => new Set(money), [money])

	const rows = data?.rows ?? []
	const pages = Math.max(1, Math.ceil(rows.length / PAGE))
	const current = Math.min(page, pages)
	const shown = rows.slice((current - 1) * PAGE, current * PAGE)

	// Numbers sit on the right, as they do on paper
	const rightAligned = useMemo(() => {
		const set = new Set<string>()
		if (!data) return set
		for (const column of data.columns) {
			const sample = rows.find(row => row[column] !== null && row[column] !== undefined)
			if (sample && isNumeric(sample[column])) set.add(column)
		}
		return set
	}, [data, rows])

	const downloadExcel = () => {
		if (!data || rows.length === 0) return
		const sheetRows = rows.map(row => {
			const out: Record<string, unknown> = {}
			for (const column of data.columns) {
				const value = row[column]
				out[column] = typeof value === 'string' && isNumeric(value) ? Number(value) : value
			}
			return out
		})
		const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: data.columns })
		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, sheet, context.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
		const stamp = new Date().toISOString().slice(0, 10)
		XLSX.writeFile(book, `${slug(context.college)}-${slug(context.title)}-${stamp}.xlsx`)
	}

	const print = () => {
		if (!data || rows.length === 0) return
		const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		const head = data.columns.map(column => `<th class="${rightAligned.has(column) ? 'num' : ''}">${escape(column)}</th>`).join('')
		const body = rows.map(row =>
			`<tr>${data.columns.map(column => `<td class="${rightAligned.has(column) ? 'num' : ''}">${escape(formatCell(row[column], moneySet.has(column)))}</td>`).join('')}</tr>`
		).join('')
		const when = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.title)} — ${escape(context.college)}</title>
<style>
	@page { size: A4 landscape; margin: 12mm; }
	body { font: 11px/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
	h1 { font-size: 15px; margin: 0 0 2px; }
	.sub { color: #555; margin-bottom: 10px; }
	table { border-collapse: collapse; width: 100%; }
	th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; vertical-align: top; }
	th { background: #eee; font-weight: 600; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	tr { page-break-inside: avoid; }
	thead { display: table-header-group; }
	.foot { margin-top: 8px; color: #555; font-size: 10px; }
</style></head><body>
<h1>${escape(context.college)} — ${escape(context.title)}</h1>
<div class="sub">${escape(context.filters)}${context.filters ? ' · ' : ''}${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'} · printed ${escape(when)}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<div class="foot">JKKN Learning Commons · Library System</div>
<script>window.onload = function () { window.print() }</script>
</body></html>`
		const win = window.open('', '_blank', 'width=1100,height=800')
		if (!win) return
		win.document.open()
		win.document.write(html)
		win.document.close()
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center gap-2 rounded-lg border py-16 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" /> Building the report…
			</div>
		)
	}

	if (error) {
		return (
			<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
				<div className="flex items-start gap-2">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<div className="min-w-0">
						<p className="font-medium">{error}</p>
						{detail && <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs text-foreground/80">{detail}</pre>}
					</div>
				</div>
			</div>
		)
	}

	if (!data) {
		return (
			<div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-16 text-sm text-muted-foreground">
				<FileText className="h-6 w-6 text-muted-foreground/40" />
				Pick a report and press Run.
			</div>
		)
	}

	if (rows.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-16 text-sm text-muted-foreground">
				<FileText className="h-6 w-6 text-muted-foreground/40" />
				{emptyText}
			</div>
		)
	}

	return (
		<div className="min-w-0 max-w-full space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-muted-foreground">
					{rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'}
					{data.truncated && <span className="ml-2 text-amber-700">· stopped at the 5,000-row cap — narrow the filters for the rest</span>}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button size="sm" variant="outline" className="h-8" onClick={downloadExcel}>
						<Download className="mr-1.5 h-3.5 w-3.5" /> Excel
					</Button>
					<Button size="sm" variant="outline" className="h-8" onClick={print}>
						<Printer className="mr-1.5 h-3.5 w-3.5" /> Print
					</Button>
				</div>
			</div>

			{/* The table scrolls sideways inside this box; the page never does */}
			<div className="w-full max-w-full overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader className="sticky top-0 z-10 bg-muted/60">
						<TableRow>
							<TableHead className="w-10 text-xs text-muted-foreground">#</TableHead>
							{data.columns.map(column => (
								<TableHead key={column} className={`whitespace-nowrap text-xs ${rightAligned.has(column) ? 'text-right' : ''}`}>{column}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{shown.map((row, index) => (
							<TableRow key={index}>
								<TableCell className="text-xs text-muted-foreground">{(current - 1) * PAGE + index + 1}</TableCell>
								{data.columns.map(column => (
									<TableCell key={column} className={`max-w-[360px] truncate text-sm ${rightAligned.has(column) ? 'text-right tabular-nums' : ''}`} title={formatCell(row[column], moneySet.has(column))}>
										{formatCell(row[column], moneySet.has(column))}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{pages > 1 && (
				<div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
					<span>Page {current} of {pages}</span>
					<Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page">
						<ChevronLeft className="h-3.5 w-3.5" />
					</Button>
					<Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page">
						<ChevronRight className="h-3.5 w-3.5" />
					</Button>
				</div>
			)}
		</div>
	)
}
