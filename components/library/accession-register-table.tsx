'use client'

/**
 * The Pharmacy accession register, on screen.
 *
 * One line per physical book, exactly as the register is written: the accession
 * number first, because that is what the librarian looks up by, then the book's
 * details repeated on every copy's line. Five copies are five lines here, and
 * that is deliberate — each is a separate object on the shelf that can be
 * issued, lost or repaired on its own.
 */

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import {
	BookOpen, BookMarked, Library, BookLock,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import { BOOK_TYPE_LABELS, isPeriodicalType } from '@/lib/library/catalogue-options'
import type { LibItemStatus } from '@/types/lib'

export interface RegisterRow {
	item_id: string
	accession_number: string
	copy_number: number
	status: LibItemStatus
	catalogue_record_id: string | null
	title: string
	subtitle: string | null
	author: string | null
	edition: string | null
	isbn: string | null
	issn: string | null
	book_type: string | null
	department: string | null
	book_location: string | null
	is_reference_only: boolean
	total_copies: number
}

interface Props {
	rows: RegisterRow[]
	loading: boolean
	onRefresh: () => void
	/** Opens the title behind this copy for editing. */
	onEdit: (catalogueRecordId: string) => void
	/** Removes this one physical book. Its other copies are separate rows and stay. */
	onDelete: (row: RegisterRow) => void
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

export function AccessionRegisterTable({ rows, loading, onRefresh, onEdit, onDelete, headerActions }: Props) {
	/** What is being typed. Nothing is searched until the button is pressed. */
	const [draft, setDraft] = useState<SearchTerms>(NO_TERMS)
	/** What was asked for, as of the last press of Search. */
	const [applied, setApplied] = useState<SearchTerms>(NO_TERMS)
	const [typeFilter, setTypeFilter] = useState('all')
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(25)

	const counts = useMemo(() => ({
		books: rows.length,
		titles: new Set(rows.map(r => r.catalogue_record_id).filter(Boolean)).size,
		available: rows.filter(r => r.status === 'available').length,
		referenceOnly: rows.filter(r => r.is_reference_only).length,
	}), [rows])

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
	 * satisfied, so Accession 65 with ISBN 978… narrows rather than widens.
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

			return typeFilter === 'all' || (r.book_type ?? '') === typeFilter
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
	}, [rows, applied, typeFilter, searchable])

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

	const pageSizeOptions = useMemo(() => {
		const options = [10, 25, 50, 100]
		return options.filter(n => n <= Math.max(filtered.length, 10))
	}, [filtered.length])

	const effectivePerPage = Math.max(1, Math.min(itemsPerPage, Math.max(filtered.length, 1)))
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const page = Math.min(currentPage, totalPages)
	const paginated = filtered.slice((page - 1) * effectivePerPage, page * effectivePerPage)

	/** Book types actually present, so the filter never offers an empty choice. */
	const typesInUse = useMemo(() => {
		const present = new Set(rows.map(r => r.book_type).filter(Boolean) as string[])
		return [...BOOK_TYPE_LABELS.filter(t => present.has(t)), ...[...present].filter(t => !BOOK_TYPE_LABELS.includes(t))]
	}, [rows])

	const colCount = 7

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 min-h-0">
				{/* Books first, because the register counts books. Titles beside it,
				    because five copies of one book are five books but one title. */}
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
					<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight tabular-nums">{counts.books}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Books</p>
								</div>
								<BookOpen className="h-5 w-5 text-blue-500/40" />
							</div>
						</CardContent>
					</Card>
					<Card className="border-l-4 border-l-violet-500 hover:shadow-md transition-shadow">
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight tabular-nums">{counts.titles}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Titles</p>
								</div>
								<Library className="h-5 w-5 text-violet-500/40" />
							</div>
						</CardContent>
					</Card>
					<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight tabular-nums">{counts.available}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Available</p>
								</div>
								<BookMarked className="h-5 w-5 text-emerald-500/40" />
							</div>
						</CardContent>
					</Card>
					<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
						<CardContent className="p-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold tracking-tight tabular-nums">{counts.referenceOnly}</p>
									<p className="text-xs font-medium text-muted-foreground mt-0.5">Reference Only</p>
								</div>
								<BookLock className="h-5 w-5 text-amber-500/40" />
							</div>
						</CardContent>
					</Card>
				</div>

				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold">Accession Register</h2>
								<p className="text-xs text-muted-foreground">
									{filtered.length} book{filtered.length !== 1 ? 's' : ''}
									{filtered.length !== rows.length && ` of ${rows.length}`}
								</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">{headerActions}</div>
						</div>
						{/* A box per field, and nothing happens until Search is pressed —
						    so a half-typed accession number never rearranges the list
						    under the librarian's hands. */}
						<div className="flex items-end gap-2 flex-wrap mt-3">
							<Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue placeholder="Book type" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Types</SelectItem>
									{typesInUse.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
								</SelectContent>
							</Select>

							<div className="w-[150px]">
								<label className="text-[11px] font-medium text-muted-foreground">Accession #</label>
								<Input
									placeholder="e.g. 65"
									value={draft.accession}
									onChange={e => setDraft(d => ({ ...d, accession: e.target.value }))}
									className="h-8 text-sm mt-0.5"
								/>
							</div>

							<div className="w-[180px]">
								<label className="text-[11px] font-medium text-muted-foreground">ISBN/ISSN</label>
								<Input
									placeholder="With or without dashes"
									value={draft.isbn}
									onChange={e => setDraft(d => ({ ...d, isbn: e.target.value }))}
									className="h-8 text-sm mt-0.5"
								/>
							</div>

							<div className="flex-1 min-w-[180px] max-w-sm">
								<label className="text-[11px] font-medium text-muted-foreground">Title</label>
								<Input
									placeholder="Any part of the title"
									value={draft.title}
									onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
									className="h-8 text-sm mt-0.5"
								/>
							</div>

							<Button className="h-8 text-sm px-4" onClick={runSearch}>
								<Search className="h-4 w-4 mr-1.5" />
								Search
							</Button>

							{(hasSearch || hasDraft) && (
								<Button variant="ghost" className="h-8 text-sm px-3" onClick={clearSearch}>
									Clear
								</Button>
							)}

							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={onRefresh}>
										<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
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
											<TableHead className="text-xs font-semibold w-[160px]">Author</TableHead>
											<TableHead className="text-xs font-semibold w-[110px]">Type</TableHead>
											<TableHead className="text-xs font-semibold w-[150px]">ISBN/ISSN</TableHead>
											<TableHead className="text-xs font-semibold w-[120px]">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading the register...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookOpen className="h-8 w-8 opacity-20" />
														<span className="text-sm">{rows.length === 0 ? 'No books entered yet' : 'Nothing matches that'}</span>
														<span className="text-xs">{rows.length === 0 ? 'Add a title, or upload a filled sheet' : 'Try a different search'}</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.item_id} className="hover:bg-muted/50">
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
													<span className="truncate block">{r.author ?? '—'}</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className="text-xs">{r.book_type ?? '—'}</Badge>
												</TableCell>
												<TableCell className="text-sm font-mono text-muted-foreground">
													{standardNumber(r) ?? '—'}
												</TableCell>
												<TableCell><ResourceStatusBadge status={r.status} /></TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
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
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>

						{/* Mobile */}
						<div className="md:hidden mt-3 space-y-3 overflow-auto max-h-[520px]">
							{loading ? (
								<div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
									<RefreshCw className="h-5 w-5 animate-spin" />
									<span className="text-sm">Loading...</span>
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<BookOpen className="h-8 w-8 opacity-20" />
									<span className="text-sm">{rows.length === 0 ? 'No books entered yet' : 'Nothing matches that'}</span>
								</div>
							) : paginated.map(r => (
								<div key={r.item_id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between gap-2">
										<div className="flex-1 min-w-0">
											<p className="text-sm font-mono font-semibold">{r.accession_number}</p>
											<p className="font-medium text-sm truncate mt-0.5">{r.title}</p>
											<p className="text-xs text-muted-foreground truncate">{r.author ?? '—'}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0 shrink-0">
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
									<SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
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
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setCurrentPage(p => p - 1)}>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
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
