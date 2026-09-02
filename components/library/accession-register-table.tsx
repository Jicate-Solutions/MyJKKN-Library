'use client'

/**
 * The accession register, on screen.
 *
 * One line per physical book, exactly as the register is written: the accession
 * number first, because that is what the librarian looks up by, then the book's
 * details repeated on every copy's line. Five copies are five lines here, and
 * that is deliberate — each is a separate object on the shelf that can be
 * issued, lost or repaired on its own.
 *
 * Built for the hands that use it all day. The cursor starts in the Accession
 * box, Enter searches — so a barcode scanner, which types the number and sends
 * Enter, works with nothing else pressed — a row opens on a click, the counts
 * at the top are filters, and the list on screen can be taken away as Excel.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import {
	BookOpen, BookMarked, Library, BookLock,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	ChevronLeft, ChevronRight, ExternalLink, Download,
} from 'lucide-react'
import Link from 'next/link'
import { BOOK_TYPE_LABELS, isPeriodicalType } from '@/lib/library/catalogue-options'
import type { RegisterRow } from '@/lib/library/register-rows'
import type { LibItemStatus } from '@/types/lib'

export type { RegisterRow }

interface Props {
	rows: RegisterRow[]
	/** Nothing on screen yet — the first read is still in flight. */
	loading: boolean
	/** Something is on screen, and a fresh read is coming in behind it. */
	refreshing: boolean
	onRefresh: () => void
	/** Opens the title behind this copy for editing. */
	onEdit: (catalogueRecordId: string) => void
	/** Removes this one physical book. Its other copies are separate rows and stay. */
	onDelete: (row: RegisterRow) => void
	/** Opens the Add Title form — the N key's job. */
	onNewTitle: () => void
	/** Add Title and Bulk Upload, owned by the page. */
	headerActions: React.ReactNode
}

/** The three things a librarian looks a book up by, each with its own box. */
interface SearchTerms {
	accession: string
	isbn: string
	title: string
}

const NO_TERMS: SearchTerms = { accession: '', isbn: '', title: '' }

/**
 * The one-click filters: a shelf status, or Reference Only, which is not a
 * status but is what the fourth scorecard counts.
 */
type QuickFilter = 'all' | 'reference' | LibItemStatus

/** Shown first and always, in this order; any other status present follows. */
const LEADING_STATUSES: LibItemStatus[] = ['available', 'on_loan']

/** "on_loan" the way a person says it. */
const statusLabel = (status: string): string =>
	status.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/** Spaces and capitals are noise in every one of these fields. */
const soften = (value: unknown): string => (value ?? '').toString().trim().toLowerCase()

/** 978-81-239-2565-3 and 9788123925653 are one number printed two ways. */
const digitsOnly = (value: unknown): string => soften(value).replace(/[^0-9x]/g, '')

/**
 * The number this material is identified by, in one column.
 *
 * A book has an ISBN, a magazine or journal an ISSN — they are never both, and
 * the register has one column for whichever it is. Which one is asked for first
 * follows the book type, so a magazine that also has a stray ISBN typed against
 * it still shows the ISSN a librarian would look for.
 */
const standardNumber = (row: RegisterRow): string | null => {
	const [first, second] = isPeriodicalType(row.book_type ?? '')
		? [row.issn, row.isbn]
		: [row.isbn, row.issn]
	return (first ?? '').trim() || (second ?? '').trim() || null
}

/**
 * Register order: accession numbers, counted rather than spelled.
 *
 * Sorted as text, 1000 lands next to 100 and the register reads nothing like
 * the shelf. Plain numbers are compared as numbers and come first; anything a
 * college writes with letters in it (COP/2024/12) falls in after them, still in
 * a sensible order because the comparison itself is number-aware.
 */
const byAccession = (a: { accession_number?: string | null }, b: { accession_number?: string | null }): number => {
	const left = (a.accession_number ?? '').trim()
	const right = (b.accession_number ?? '').trim()

	const leftNumber = Number(left)
	const rightNumber = Number(right)
	const leftIsNumber = left !== '' && Number.isFinite(leftNumber)
	const rightIsNumber = right !== '' && Number.isFinite(rightNumber)

	if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber
	if (leftIsNumber) return -1
	if (rightIsNumber) return 1
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Whether a key press belongs to whatever the librarian is typing into.
 *
 * A shortcut must never fire while a box has the cursor, and never under a
 * dialog — pressing N to move on in a form and finding a second form opened
 * on top of the first is exactly the kind of thing that makes people stop
 * trusting a screen.
 */
const isTypingSomewhere = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const isDialogOpen = (): boolean =>
	typeof document !== 'undefined' && !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')

/** Today, the way a file name wants it. */
const stamp = (): string => new Date().toISOString().slice(0, 10)

export function AccessionRegisterTable({
	rows, loading, refreshing, onRefresh, onEdit, onDelete, onNewTitle, headerActions,
}: Props) {
	const router = useRouter()
	/** What is being typed. Nothing is searched until Enter or the button. */
	const [draft, setDraft] = useState<SearchTerms>(NO_TERMS)
	/** What was asked for, as of the last search. */
	const [applied, setApplied] = useState<SearchTerms>(NO_TERMS)
	const [typeFilter, setTypeFilter] = useState('all')
	const [quick, setQuick] = useState<QuickFilter>('all')
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(25)
	const accessionBox = useRef<HTMLInputElement>(null)

	/**
	 * The cursor starts in the Accession box, because that is where nearly
	 * every visit begins — a number read off a book or a scanner. Not on a
	 * phone: focusing a box there throws the keyboard over half the screen
	 * before anything has been read.
	 */
	useEffect(() => {
		if (typeof window === 'undefined') return
		if (!window.matchMedia('(min-width: 768px)').matches) return
		accessionBox.current?.focus()
	}, [])

	const counts = useMemo(() => ({
		books: rows.length,
		titles: new Set(rows.map(r => r.catalogue_record_id).filter(Boolean)).size,
		available: rows.filter(r => r.status === 'available').length,
		referenceOnly: rows.filter(r => r.is_reference_only).length,
	}), [rows])

	/** How many books stand in each status, for the chips. */
	const statusCounts = useMemo(() => {
		const tally = new Map<LibItemStatus, number>()
		for (const r of rows) tally.set(r.status, (tally.get(r.status) ?? 0) + 1)
		return tally
	}, [rows])

	/**
	 * The chips on offer: Available and On loan always (a librarian asks for
	 * both even when the answer is none today), Reference Only, then whatever
	 * else the shelf actually holds — Lost, Damaged, In conservation — so a
	 * status nobody has used is not a chip nobody can use.
	 */
	const quickFilters = useMemo(() => {
		const chips: Array<{ key: QuickFilter; label: string; count: number }> = [
			{ key: 'all', label: 'All', count: rows.length },
			...LEADING_STATUSES.map(status => ({ key: status as QuickFilter, label: statusLabel(status), count: statusCounts.get(status) ?? 0 })),
			{ key: 'reference', label: 'Reference only', count: counts.referenceOnly },
		]
		const rest = [...statusCounts.keys()]
			.filter(status => !LEADING_STATUSES.includes(status))
			.sort()
		for (const status of rest) {
			chips.push({ key: status, label: statusLabel(status), count: statusCounts.get(status) ?? 0 })
		}
		return chips
	}, [rows.length, statusCounts, counts.referenceOnly])

	/**
	 * Each book's three fields, prepared once when the register loads rather
	 * than converted again for every book on every search.
	 */
	const searchable = useMemo(() => {
		const index = new Map<string, { accession: string; isbn: string; title: string }>()
		for (const r of rows) {
			index.set(r.item_id, {
				accession: soften(r.accession_number),
				// Both numbers, in one field: a book carries an ISBN and a magazine
				// or journal an ISSN, and the librarian typing a number into that
				// box is looking for whichever this material has.
				isbn: [digitsOnly(r.isbn), digitsOnly(r.issn)].filter(Boolean).join(' '),
				title: soften(r.title),
			})
		}
		return index
	}, [rows])

	/**
	 * The rows on show.
	 *
	 * A box that is left empty asks nothing; boxes that are filled must all be
	 * satisfied, so Accession 65 with ISBN 978… narrows rather than widens. The
	 * type and the quick filter narrow further.
	 *
	 * Accession is then ordered by how well it matched. Typing "65" into the
	 * accession box used to bury book 65 under 1065, 1650 and every ISBN
	 * containing those two digits — the number asked for was in the list, just
	 * not where anyone would look. Now the exact number comes first, then the
	 * numbers beginning with it, then the rest.
	 *
	 * Within all of that the register reads in accession order, counting the way
	 * a person counts: 1000 sits after 999, not between 100 and 10000.
	 */
	const filtered = useMemo(() => {
		const accession = soften(applied.accession)
		const isbn = digitsOnly(applied.isbn)
		const title = soften(applied.title)

		const matched = rows.filter(r => {
			const fields = searchable.get(r.item_id)
			if (!fields) return false

			if (accession && !fields.accession.includes(accession)) return false
			if (isbn && !fields.isbn.includes(isbn)) return false
			if (title && !fields.title.includes(title)) return false
			if (typeFilter !== 'all' && (r.book_type ?? '') !== typeFilter) return false

			if (quick === 'all') return true
			if (quick === 'reference') return r.is_reference_only
			return r.status === quick
		})

		if (!accession) return [...matched].sort(byAccession)

		const rank = (row: RegisterRow) => {
			const value = searchable.get(row.item_id)?.accession ?? ''
			if (value === accession) return 0
			if (value.startsWith(accession)) return 1
			return 2
		}

		// Best match first, and inside each group the register's own order
		return [...matched].sort((a, b) => (rank(a) - rank(b)) || byAccession(a, b))
	}, [rows, applied, typeFilter, quick, searchable])

	const hasSearch = Boolean(applied.accession || applied.isbn || applied.title)
	const hasDraft = Boolean(draft.accession || draft.isbn || draft.title)

	const runSearch = () => {
		setApplied(draft)
		setCurrentPage(1)
	}

	const clearSearch = () => {
		setDraft(NO_TERMS)
		setApplied(NO_TERMS)
		setCurrentPage(1)
	}

	const chooseQuick = (next: QuickFilter) => {
		setQuick(next)
		setCurrentPage(1)
	}

	const pageSizeOptions = useMemo(() => {
		const options = [10, 25, 50, 100]
		return options.filter(n => n <= Math.max(filtered.length, 10))
	}, [filtered.length])

	const effectivePerPage = Math.max(1, Math.min(itemsPerPage, Math.max(filtered.length, 1)))
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const page = Math.min(currentPage, totalPages)
	const paginated = filtered.slice((page - 1) * effectivePerPage, page * effectivePerPage)

	/**
	 * The keys that work anywhere on the page: / to the Accession box, N for a
	 * new title, the arrows for the pages. Never while typing, never under a
	 * dialog — see isTypingSomewhere.
	 */
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
			if (isTypingSomewhere(event.target) || isDialogOpen()) return

			switch (event.key) {
				case '/':
					event.preventDefault()
					accessionBox.current?.focus()
					accessionBox.current?.select()
					break
				case 'n':
				case 'N':
					event.preventDefault()
					onNewTitle()
					break
				case 'ArrowLeft':
					if (page > 1) { event.preventDefault(); setCurrentPage(page - 1) }
					break
				case 'ArrowRight':
					if (page < totalPages) { event.preventDefault(); setCurrentPage(page + 1) }
					break
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onNewTitle, page, totalPages])

	/** Book types actually present, so the filter never offers an empty choice. */
	const typesInUse = useMemo(() => {
		const present = new Set(rows.map(r => r.book_type).filter(Boolean) as string[])
		return [...BOOK_TYPE_LABELS.filter(t => present.has(t)), ...[...present].filter(t => !BOOK_TYPE_LABELS.includes(t))]
	}, [rows])

	const colCount = 7

	/**
	 * One column, holding whichever of the two the material actually has.
	 *
	 * A journal has no author — it has an author per article — and what a
	 * librarian looks a periodical up by is the vendor it comes from, issue after
	 * issue. A book is the other way round: it has one author and its supplier
	 * belongs to the purchase order, not to the shelf.
	 *
	 * Driven by the filter rather than by each row, because a column heading that
	 * changed meaning line by line would be unreadable. With Books, or with
	 * everything shown at once, it stays Author.
	 */
	const showSupplier = isPeriodicalType(typeFilter)
	const bylineHeader = showSupplier ? 'Supplier' : 'Author'
	const byline = (row: RegisterRow): string | null =>
		showSupplier ? row.supplier_name : row.author

	/** A row opens the book behind it. The menu and the icons on the row stop the click going through. */
	const openRow = (row: RegisterRow) => {
		if (row.catalogue_record_id) router.push(`/registry/${row.catalogue_record_id}`)
	}

	/**
	 * The list on screen, as a spreadsheet — every matching row, not just this
	 * page of it. What the search and the chips have narrowed it to is what the
	 * librarian was looking at, so that is what goes into the file.
	 */
	const downloadExcel = useCallback(() => {
		const sheetRows = filtered.map(r => ({
			'Accession #': r.accession_number,
			'Title': r.title,
			'Sub-Title': r.subtitle ?? '',
			'Author': r.author ?? '',
			'Supplier': r.supplier_name ?? '',
			'Edition': r.edition ?? '',
			'Book Type': r.book_type ?? '',
			'ISBN': r.isbn ?? '',
			'ISSN': r.issn ?? '',
			'Status': statusLabel(r.status),
			'Reference Only': r.is_reference_only ? 'Yes' : 'No',
			'Copy': r.total_copies > 1 ? `${r.copy_number} of ${r.total_copies}` : '1',
			'Department': r.department ?? '',
			'Book Location': r.book_location ?? '',
			'Date of Adding': r.accession_date ?? '',
		}))

		const sheet = XLSX.utils.json_to_sheet(sheetRows)
		sheet['!cols'] = [12, 44, 24, 24, 24, 10, 12, 18, 12, 14, 14, 10, 24, 20, 14].map(wch => ({ wch }))

		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, sheet, 'Accession Register')

		// The file says what it holds: the type, the chip, and the day
		const parts = ['accession-register']
		if (typeFilter !== 'all') parts.push(typeFilter.toLowerCase().replace(/\s+/g, '-'))
		if (quick !== 'all') parts.push(quick === 'reference' ? 'reference-only' : quick.replace(/_/g, '-'))
		if (hasSearch) parts.push('search')
		parts.push(stamp())
		XLSX.writeFile(book, parts.join('-') + '.xlsx')
	}, [filtered, typeFilter, quick, hasSearch])

	/** Nothing to show yet: the shell is drawn and the rows are on their way. */
	const showSkeleton = loading && rows.length === 0

	/** The count on a scorecard, or a bar where the count has not arrived. */
	const figure = (value: number) =>
		showSkeleton
			? <Skeleton className="h-8 w-16 mt-0.5 mb-1" />
			: <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>

	/**
	 * A scorecard that is also a filter. Pressed, it narrows the register to
	 * what it counts; pressed again, or with Total Books, it lets go.
	 */
	const scorecard = (
		label: string,
		value: number,
		Icon: React.ElementType,
		tone: string,
		filter: QuickFilter | null
	) => {
		const active = filter !== null && quick === filter
		const clickable = filter !== null
		return (
			<Card
				role={clickable ? 'button' : undefined}
				tabIndex={clickable ? 0 : undefined}
				aria-pressed={clickable ? active : undefined}
				onClick={clickable ? () => chooseQuick(active && filter !== 'all' ? 'all' : filter) : undefined}
				onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseQuick(active && filter !== 'all' ? 'all' : filter) } } : undefined}
				className={`border-l-4 ${tone} transition-shadow ${clickable ? 'cursor-pointer hover:shadow-md' : ''} ${active ? 'ring-2 ring-primary/40 shadow-md' : ''}`}
			>
				<CardContent className="p-4">
					<div className="flex items-center justify-between">
						<div>
							{figure(value)}
							<p className="text-xs font-medium text-muted-foreground mt-0.5">{label}</p>
						</div>
						<Icon className="h-5 w-5 opacity-40" />
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 min-h-0">
				{/* Books first, because the register counts books. Titles beside it,
				    because five copies of one book are five books but one title.
				    Three of the four are filters as well as counts — Titles is a
				    count alone, since a title is not a thing a row can be filtered to. */}
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
					{scorecard('Total Books', counts.books, BookOpen, 'border-l-blue-500 [&_svg]:text-blue-500', 'all')}
					{scorecard('Titles', counts.titles, Library, 'border-l-violet-500 [&_svg]:text-violet-500', null)}
					{scorecard('Available', counts.available, BookMarked, 'border-l-emerald-500 [&_svg]:text-emerald-500', 'available')}
					{scorecard('Reference Only', counts.referenceOnly, BookLock, 'border-l-amber-500 [&_svg]:text-amber-500', 'reference')}
				</div>

				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold">Accession Register</h2>
								<p className="text-xs text-muted-foreground">
									{showSkeleton
										? 'Loading the register…'
										: <>
											{filtered.length} book{filtered.length !== 1 ? 's' : ''}
											{filtered.length !== rows.length && ` of ${rows.length}`}
										</>}
								</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">{headerActions}</div>
						</div>

						{/* A box per field. Nothing happens until Enter or the button, so a
						    half-typed accession number never rearranges the list under the
						    librarian's hands — and Enter is what a barcode scanner sends. */}
						<form
							className="flex items-end gap-2 flex-wrap mt-3"
							onSubmit={e => { e.preventDefault(); runSearch() }}
							onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); clearSearch() } }}
						>
							<Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[150px]" aria-label="Book type"><SelectValue placeholder="Book type" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Types</SelectItem>
									{typesInUse.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
								</SelectContent>
							</Select>

							<div className="w-[150px]">
								<label className="text-[11px] font-medium text-muted-foreground" htmlFor="register-accession">Accession #</label>
								<Input
									id="register-accession"
									ref={accessionBox}
									placeholder="e.g. 65"
									value={draft.accession}
									onChange={e => setDraft(d => ({ ...d, accession: e.target.value }))}
									className="h-8 text-sm mt-0.5"
									autoComplete="off"
								/>
							</div>

							<div className="w-[180px]">
								<label className="text-[11px] font-medium text-muted-foreground" htmlFor="register-isbn">ISBN/ISSN</label>
								<Input
									id="register-isbn"
									placeholder="With or without dashes"
									value={draft.isbn}
									onChange={e => setDraft(d => ({ ...d, isbn: e.target.value }))}
									className="h-8 text-sm mt-0.5"
									autoComplete="off"
								/>
							</div>

							<div className="flex-1 min-w-[180px] max-w-sm">
								<label className="text-[11px] font-medium text-muted-foreground" htmlFor="register-title">Title</label>
								<Input
									id="register-title"
									placeholder="Any part of the title"
									value={draft.title}
									onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
									className="h-8 text-sm mt-0.5"
									autoComplete="off"
								/>
							</div>

							<Button type="submit" className="h-8 text-sm px-4">
								<Search className="h-4 w-4 mr-1.5" />
								Search
							</Button>

							{(hasSearch || hasDraft) && (
								<Button type="button" variant="ghost" className="h-8 text-sm px-3" onClick={clearSearch}>
									Clear
								</Button>
							)}

							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="h-8 w-8 p-0"
										onClick={downloadExcel}
										disabled={showSkeleton || filtered.length === 0}
										aria-label="Download this list as Excel"
									>
										<Download className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Download this list ({filtered.length}) as Excel</TooltipContent>
							</Tooltip>

							<Tooltip>
								<TooltipTrigger asChild>
									<Button type="button" variant="outline" size="icon" className="h-8 w-8 p-0" onClick={onRefresh} aria-label="Refresh">
										<RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>{refreshing ? 'Reading the latest register…' : 'Refresh'}</TooltipContent>
							</Tooltip>
						</form>

						{/* One click to what is on the shelf, what is out, and what never
						    goes out. The same choice the scorecards make, in a row. */}
						<div className="flex items-center gap-1.5 flex-wrap mt-3">
							{quickFilters.map(chip => {
								const active = quick === chip.key
								return (
									<button
										key={chip.key}
										type="button"
										aria-pressed={active}
										onClick={() => chooseQuick(active && chip.key !== 'all' ? 'all' : chip.key)}
										className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-xs font-medium transition-colors ${
											active
												? 'bg-primary text-primary-foreground border-primary'
												: 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
										}`}
									>
										{chip.label}
										<span className={`tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>{showSkeleton ? '…' : chip.count}</span>
									</button>
								)
							})}
							<span className="hidden lg:inline text-[11px] text-muted-foreground ml-auto">
								Enter searches · Esc clears · <kbd className="font-mono">/</kbd> to Accession · <kbd className="font-mono">N</kbd> new title · <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> pages
							</span>
						</div>
					</CardHeader>

					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* Desktop */}
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px] max-h-[520px] hidden md:block">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold w-[130px]">Accession #</TableHead>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold w-[160px]">{bylineHeader}</TableHead>
											<TableHead className="text-xs font-semibold w-[110px]">Type</TableHead>
											<TableHead className="text-xs font-semibold w-[150px]">ISBN/ISSN</TableHead>
											<TableHead className="text-xs font-semibold w-[120px]">Status</TableHead>
											<TableHead className="text-xs font-semibold w-[104px]"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{showSkeleton ? (
											// The shape of the register, drawn before the register: the
											// eye lands where the rows will be instead of on a spinner.
											Array.from({ length: 8 }, (_, i) => (
												<TableRow key={i}>
													<TableCell><Skeleton className="h-4 w-12" /></TableCell>
													<TableCell>
														<Skeleton className="h-4 w-[60%] mb-1.5" />
														<Skeleton className="h-3 w-[30%]" />
													</TableCell>
													<TableCell><Skeleton className="h-4 w-24" /></TableCell>
													<TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
													<TableCell><Skeleton className="h-4 w-28" /></TableCell>
													<TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
													<TableCell></TableCell>
												</TableRow>
											))
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookOpen className="h-8 w-8 opacity-20" />
														<span className="text-sm">{rows.length === 0 ? 'No books entered yet' : 'Nothing matches that'}</span>
														<span className="text-xs">{rows.length === 0 ? 'Add a title, or upload a filled sheet' : 'Try a different search or chip'}</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow
												key={r.item_id}
												className={`group hover:bg-muted/50 ${r.catalogue_record_id ? 'cursor-pointer' : ''}`}
												onClick={() => openRow(r)}
											>
												<TableCell className="text-sm font-mono font-medium">{r.accession_number}</TableCell>
												<TableCell className="max-w-[300px]">
													<div className="text-sm font-medium truncate">{r.title}</div>
													<div className="text-xs text-muted-foreground truncate">
														{r.edition && `${r.edition} ed.`}
														{/* Says plainly that the other copies are separate lines */}
														{r.total_copies > 1 && `${r.edition ? ' · ' : ''}copy ${r.copy_number} of ${r.total_copies}`}
													</div>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground max-w-[160px]">
													<span className="truncate block">{byline(r) ?? '—'}</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className="text-xs">{r.book_type ?? '—'}</Badge>
												</TableCell>
												<TableCell className="text-sm font-mono text-muted-foreground">
													{standardNumber(r) ?? '—'}
												</TableCell>
												<TableCell><ResourceStatusBadge status={r.status} /></TableCell>
												{/* Edit and Delete surface on hover, one click each; the menu
												    stays for keyboards, touch, and View Detail. None of them
												    let the click fall through to the row. */}
												<TableCell onClick={e => e.stopPropagation()}>
													<div className="flex items-center justify-end gap-0.5">
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
																	onClick={() => r.catalogue_record_id && onEdit(r.catalogue_record_id)}
																	disabled={!r.catalogue_record_id}
																	aria-label="Edit book details"
																>
																	<Edit className="h-4 w-4" />
																</Button>
															</TooltipTrigger>
															<TooltipContent>Edit book details</TooltipContent>
														</Tooltip>
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
																	onClick={() => onDelete(r)}
																	aria-label="Delete this book"
																>
																	<Trash2 className="h-4 w-4" />
																</Button>
															</TooltipTrigger>
															<TooltipContent>Delete this book</TooltipContent>
														</Tooltip>
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button variant="ghost" className="h-7 w-7 p-0" aria-label="More">
																	<MoreHorizontal className="h-4 w-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																{r.catalogue_record_id && (
																	<DropdownMenuItem asChild>
																		<Link href={`/registry/${r.catalogue_record_id}`}>
																			<ExternalLink className="h-4 w-4 mr-2" />View Detail
																		</Link>
																	</DropdownMenuItem>
																)}
																<DropdownMenuItem onClick={() => r.catalogue_record_id && onEdit(r.catalogue_record_id)}>
																	<Edit className="h-4 w-4 mr-2" />Edit book details
																</DropdownMenuItem>
																<DropdownMenuSeparator />
																{/* A row is one book, so the label says exactly that.
																    Copy counts belong on the shelf, not in a menu. */}
																<DropdownMenuItem
																	className="text-red-600 focus:text-red-600 focus:bg-red-50"
																	onClick={() => onDelete(r)}
																>
																	<Trash2 className="h-4 w-4 mr-2" />
																	Delete this book
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>

						{/* Mobile */}
						<div className="md:hidden mt-3 space-y-3 overflow-auto max-h-[520px]">
							{showSkeleton ? (
								Array.from({ length: 4 }, (_, i) => (
									<div key={i} className="rounded-lg border p-4 space-y-2">
										<Skeleton className="h-4 w-12" />
										<Skeleton className="h-4 w-[70%]" />
										<Skeleton className="h-3 w-[40%]" />
									</div>
								))
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<BookOpen className="h-8 w-8 opacity-20" />
									<span className="text-sm">{rows.length === 0 ? 'No books entered yet' : 'Nothing matches that'}</span>
								</div>
							) : paginated.map(r => (
								<div key={r.item_id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between gap-2">
										{/* The card's text opens the book, the way the row does on a desk */}
										<button
											type="button"
											className="flex-1 min-w-0 text-left"
											onClick={() => openRow(r)}
											disabled={!r.catalogue_record_id}
										>
											<p className="text-sm font-mono font-semibold">{r.accession_number}</p>
											<p className="font-medium text-sm truncate mt-0.5">{r.title}</p>
											<p className="text-xs text-muted-foreground truncate">{byline(r) ?? '—'}</p>
										</button>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-label="More">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												{r.catalogue_record_id && (
													<DropdownMenuItem asChild>
														<Link href={`/registry/${r.catalogue_record_id}`}>
															<ExternalLink className="h-4 w-4 mr-2" />View Detail
														</Link>
													</DropdownMenuItem>
												)}
												<DropdownMenuItem onClick={() => r.catalogue_record_id && onEdit(r.catalogue_record_id)}>
													<Edit className="h-4 w-4 mr-2" />Edit book details
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													className="text-red-600 focus:text-red-600 focus:bg-red-50"
													onClick={() => onDelete(r)}
												>
													<Trash2 className="h-4 w-4 mr-2" />
													Delete this book
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className="text-xs">{r.book_type ?? '—'}</Badge>
										<ResourceStatusBadge status={r.status} />
										{r.total_copies > 1 && (
											<span className="text-xs text-muted-foreground">copy {r.copy_number} of {r.total_copies}</span>
										)}
									</div>
									{standardNumber(r) && (
										<p className="text-xs text-muted-foreground font-mono">{standardNumber(r)}</p>
									)}
								</div>
							))}
						</div>

						{/* Pagination */}
						<div className="flex flex-wrap items-center justify-between gap-2 pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground hidden sm:inline">Rows per page</span>
								<Select value={String(itemsPerPage)} onValueChange={v => { setItemsPerPage(Number(v)); setCurrentPage(1) }}>
									<SelectTrigger className="h-7 w-[70px] text-xs" aria-label="Rows per page"><SelectValue /></SelectTrigger>
									<SelectContent>
										{pageSizeOptions.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{filtered.length === 0
										? '0 of 0'
										: `${(page - 1) * effectivePerPage + 1}–${Math.min(page * effectivePerPage, filtered.length)} of ${filtered.length}`}
								</span>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setCurrentPage(p => p - 1)} aria-label="Previous page">
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setCurrentPage(p => p + 1)} aria-label="Next page">
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</TooltipProvider>
	)
}
