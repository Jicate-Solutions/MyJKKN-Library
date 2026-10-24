'use client'

/**
 * The three lists under the Stock Check scan box — my scans, everyone's, and
 * what is still to find — drawn the same way: a search box, one filter, a
 * header to sort by, a page size up to All, and an Excel report of exactly
 * what is on screen (filtered and sorted, every page).
 *
 * The rows arrive whole; sorting, filtering and paging are done here, so
 * changing any of them costs no request while people are scanning.
 */

import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FilterX, Loader2, Search, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StockColumn<T> {
	key: string
	header: string
	cell: (row: T) => ReactNode
	/** What the column sorts by; left out, the column does not sort. */
	sort?: (row: T) => string | number
	/** What the Excel report writes; left out, the column is not in it. */
	excel?: (row: T) => string | number
	className?: string
	/** Not shown on a phone — the cell beside it carries what matters. */
	hideOnMobile?: boolean
	/** In the Excel report only, never on screen. */
	excelOnly?: boolean
}

export interface StockFacet<T> {
	label: string
	options: { value: string; label: string }[]
	get: (row: T) => string
}

/** Rows per page, unless the list asks for its own. 'all' is every row. */
const PAGE_SIZES = ['25', '50', '100', '250', '500', 'all']

const istDate = () =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

export function StockCheckTable<T>({
	rows,
	rowKey,
	columns,
	searchText,
	searchPlaceholder = 'Search',
	facet,
	rowTone,
	empty,
	loading = false,
	canExport,
	exportName,
	sheetName,
	defaultSort,
	pageSizes = PAGE_SIZES,
	toolbar,
}: {
	rows: T[]
	rowKey: (row: T) => string
	columns: StockColumn<T>[]
	searchText: (row: T) => string
	searchPlaceholder?: string
	facet?: StockFacet<T>
	/** A coloured edge down the left of the row, by what the row is. */
	rowTone?: (row: T) => string
	empty: string
	loading?: boolean
	/** Super admin and librarian only — the page decides. */
	canExport: boolean
	exportName: string
	sheetName: string
	defaultSort?: { key: string; dir: 'asc' | 'desc' }
	pageSizes?: string[]
	/** More buttons beside the search, from the list that owns them. */
	toolbar?: ReactNode
}) {
	const [search, setSearch] = useState('')
	const [facetValue, setFacetValue] = useState('all')
	const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null)
	const [pageSize, setPageSize] = useState(pageSizes[0] ?? '25')
	const [page, setPage] = useState(0)
	const [exporting, setExporting] = useState(false)

	// A new search, filter or page size starts again at the first page
	useEffect(() => { setPage(0) }, [search, facetValue, pageSize, sort])

	const shown = useMemo(() => {
		const term = search.trim().toLowerCase()
		let list = rows.filter(row =>
			(!term || searchText(row).toLowerCase().includes(term)) &&
			(!facet || facetValue === 'all' || facet.get(row) === facetValue)
		)
		const column = sort ? columns.find(c => c.key === sort.key) : null
		if (column?.sort) {
			const by = column.sort
			const sign = sort!.dir === 'asc' ? 1 : -1
			list = [...list].sort((a, b) => {
				const x = by(a)
				const y = by(b)
				if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
				return String(x).localeCompare(String(y), 'en-IN', { numeric: true, sensitivity: 'base' }) * sign
			})
		}
		return list
	}, [rows, search, facetValue, facet, searchText, sort, columns])

	const size = pageSize === 'all' ? Math.max(shown.length, 1) : Number(pageSize)
	const pages = Math.max(1, Math.ceil(shown.length / size))
	const current = Math.min(page, pages - 1)
	const slice = shown.slice(current * size, current * size + size)

	const toggleSort = (key: string) => {
		setSort(prev =>
			prev?.key !== key ? { key, dir: 'asc' }
				: prev.dir === 'asc' ? { key, dir: 'desc' }
					: null
		)
	}

	const downloadExcel = async () => {
		try {
			setExporting(true)
			const XLSX = await import('xlsx')
			const exported = columns.filter(c => c.excel)
			const sheet = XLSX.utils.aoa_to_sheet([
				['S.No', ...exported.map(c => c.header)],
				...shown.map((row, i) => [i + 1, ...exported.map(c => c.excel!(row))]),
			])
			sheet['!cols'] = [{ wch: 6 }, ...exported.map(c => ({ wch: Math.max(14, c.header.length + 4) }))]
			const book = XLSX.utils.book_new()
			XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31))
			XLSX.writeFile(book, `${exportName}-${istDate()}.xlsx`)
		} finally {
			setExporting(false)
		}
	}

	const filtered = search.trim() !== '' || facetValue !== 'all'
	const visible = columns.filter(column => !column.excelOnly)

	return (
		<div className="space-y-2">
			{/* Search, filter, page size, report */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-0 flex-1 basis-48">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={e => setSearch(e.target.value)}
						placeholder={searchPlaceholder}
						className="h-9 pl-8 pr-8 text-sm"
					/>
					{search && (
						<button
							type="button"
							onClick={() => setSearch('')}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							aria-label="Clear search"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				{facet && (
					<Select value={facetValue} onValueChange={setFacetValue}>
						<SelectTrigger className="h-9 w-[150px] text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All {facet.label.toLowerCase()}</SelectItem>
							{facet.options.map(option => (
								<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{filtered && (
					<Button
						variant="ghost"
						size="sm"
						className="h-9 text-muted-foreground"
						onClick={() => { setSearch(''); setFacetValue('all') }}
					>
						<FilterX className="mr-1.5 h-3.5 w-3.5" />
						Clear
					</Button>
				)}
				{toolbar}
				{canExport && (
					<Button
						variant="outline"
						size="sm"
						className="h-9 border-brand-green/40 text-brand-green hover:bg-brand-green-50 dark:text-brand-green-400 dark:hover:bg-brand-green-900/30"
						disabled={exporting || shown.length === 0}
						onClick={() => { void downloadExcel() }}
					>
						{exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
						Excel
					</Button>
				)}
			</div>

			<div className="max-h-[60vh] overflow-auto rounded-lg border sm:max-h-[480px]">
				<Table>
					<TableHeader className="sticky top-0 z-10">
						<TableRow className="border-b-0 bg-brand-green hover:bg-brand-green dark:bg-brand-green-700 dark:hover:bg-brand-green-700">
							{visible.map(column => (
								<TableHead
									key={column.key}
									className={cn(
										'h-10 whitespace-nowrap text-xs font-semibold text-white',
										column.hideOnMobile && 'hidden sm:table-cell',
										column.className
									)}
								>
									{column.sort ? (
										<button
											type="button"
											onClick={() => toggleSort(column.key)}
											className="inline-flex items-center gap-1 hover:text-brand-yellow-400"
										>
											{column.header}
											{sort?.key === column.key
												? sort.dir === 'asc'
													? <ArrowUp className="h-3.5 w-3.5 text-brand-yellow-400" />
													: <ArrowDown className="h-3.5 w-3.5 text-brand-yellow-400" />
												: <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />}
										</button>
									) : column.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{slice.length === 0 ? (
							<TableRow>
								<TableCell colSpan={visible.length} className="h-28 text-center text-sm text-muted-foreground">
									{loading
										? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
										: filtered ? 'Nothing matches this search' : empty}
								</TableCell>
							</TableRow>
						) : slice.map(row => (
							<TableRow
								key={rowKey(row)}
								className={cn(
									'border-l-4 border-l-transparent odd:bg-white even:bg-brand-green-50/40 hover:bg-brand-yellow-50 dark:odd:bg-transparent dark:even:bg-brand-green-900/10 dark:hover:bg-brand-green-900/30',
									rowTone?.(row)
								)}
							>
								{visible.map(column => (
									<TableCell
										key={column.key}
										className={cn('py-2', column.hideOnMobile && 'hidden sm:table-cell', column.className)}
									>
										{column.cell(row)}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{/* Under the table: how many to a page, where we are, and the way
			    through. Kept clear of the round button in the corner, which
			    otherwise sits on top of Next. */}
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-brand-green-50/60 px-3 py-2 text-xs text-muted-foreground dark:bg-brand-green-900/10 sm:pr-16">
				<div className="flex flex-wrap items-center gap-2">
					<span className="hidden sm:inline">Rows per page</span>
					<Select value={pageSize} onValueChange={setPageSize}>
						<SelectTrigger className="h-8 w-[80px] bg-background text-sm" aria-label="Rows per page">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{pageSizes.map(option => (
								<SelectItem key={option} value={option}>{option === 'all' ? 'All' : option}</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="tabular-nums">
						{shown.length === 0
							? `0 of ${rows.length.toLocaleString('en-IN')}`
							: <>
								<span className="font-semibold text-foreground">
									{(current * size + 1).toLocaleString('en-IN')}–{Math.min(shown.length, current * size + size).toLocaleString('en-IN')}
								</span>
								{' '}of <span className="font-semibold text-foreground">{shown.length.toLocaleString('en-IN')}</span>
							</>}
						{filtered && ` (filtered from ${rows.length.toLocaleString('en-IN')})`}
					</span>
					{loading && rows.length > 0 && <Loader2 className="h-3 w-3 animate-spin" />}
				</div>
				{pages > 1 && (
					<div className="flex items-center gap-1">
						<Button variant="outline" size="icon" className="h-8 w-8 bg-background" disabled={current === 0} onClick={() => setPage(0)} aria-label="First page">
							<ChevronsLeft className="h-4 w-4" />
						</Button>
						<Button variant="outline" size="icon" className="h-8 w-8 bg-background" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<span className="px-2 tabular-nums">
							Page <span className="font-semibold text-foreground">{current + 1}</span> of {pages.toLocaleString('en-IN')}
						</span>
						<Button variant="outline" size="icon" className="h-8 w-8 bg-background" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
							<ChevronRight className="h-4 w-4" />
						</Button>
						<Button variant="outline" size="icon" className="h-8 w-8 bg-background" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">
							<ChevronsRight className="h-4 w-4" />
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
