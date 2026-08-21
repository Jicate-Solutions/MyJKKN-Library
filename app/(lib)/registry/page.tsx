'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useInstitution } from '@/context/institution-context'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
	BookOpen, BookMarked, Newspaper, BookLock,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import type { LibCatalogueRecord, LibResourceFormat } from '@/types/lib'
import { AccessionRegisterTable, type RegisterRow } from '@/components/library/accession-register-table'
import {
	fetchCatalogueRecords,
	fetchCatalogueById,
	createCatalogueRecord,
	updateCatalogueRecord,
	deleteCatalogueRecord,
} from '@/services/library/lib-catalogue-service'
import { createItem } from '@/services/library/lib-items-service'
import { CatalogueBulkUpload } from '@/components/library/catalogue-bulk-upload'
import { CatalogueBulkEdit } from '@/components/library/catalogue-bulk-edit'
import { CatalogueTitleForm } from '@/components/library/catalogue-title-form'
import { usesAccessionRegister, formatForBookType, OTHER_BOOK_TYPE, BOOK_TYPE_LABELS, isbnRequiredFor, departmentRequiredFor, usesSupplier } from '@/lib/library/catalogue-options'

const FORMATS: LibResourceFormat[] = [
	'book', 'periodical', 'thesis', 'report', 'map',
	'audio', 'video', 'digital', 'manuscript', 'standard', 'patent', 'other',
]

const FORMAT_COLORS: Record<string, string> = {
	book: 'bg-blue-50 text-blue-700 border-blue-200',
	periodical: 'bg-violet-50 text-violet-700 border-violet-200',
	thesis: 'bg-amber-50 text-amber-700 border-amber-200',
	report: 'bg-orange-50 text-orange-700 border-orange-200',
	digital: 'bg-cyan-50 text-cyan-700 border-cyan-200',
	audio: 'bg-pink-50 text-pink-700 border-pink-200',
	video: 'bg-rose-50 text-rose-700 border-rose-200',
}

interface FormData {
	title: string
	subtitle: string
	resource_format: LibResourceFormat
	isbn: string
	issn: string
	edition: string
	publication_year: string
	language: string
	classification_number: string
	call_number: string
	publisher_name: string
	publisher_place: string
	pages: string
	price: string
	is_reference_only: boolean
	is_active: boolean
	/** The number written in the book (see requiresAccession) */
	accession_number: string
	/** Register fields, sent only when the register layout is in use */
	accession_date: string
	author: string
	book_type: string
	/** What was typed after choosing "Others"; folded into book_type on save */
	book_type_other: string
	department: string
	book_location: string
	/** Copy-level, and asked for on magazines and journals only. Typed by hand:
	    Acquisition → Suppliers is not in use yet. */
	supplier_name: string
}

const today = () => new Date().toISOString().split('T')[0]

const defaultForm: FormData = {
	title: '',
	subtitle: '',
	resource_format: 'book',
	isbn: '',
	issn: '',
	edition: '',
	publication_year: '',
	language: 'English',
	classification_number: '',
	call_number: '',
	publisher_name: '',
	publisher_place: '',
	pages: '',
	price: '',
	is_reference_only: false,
	is_active: true,
	accession_number: '',
	accession_date: today(),
	author: '',
	book_type: '',
	book_type_other: '',
	department: '',
	book_location: '',
	supplier_name: '',
}

export default function RegistryPage() {
	const { isReady, appendToUrl, getInstitutionIdForCreate, institutionId, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { currentInstitutionCode } = useInstitution()
	const { toast } = useToast()

	// Every library identifies a physical book by the accession number written
	// inside it, and wants it recorded the moment the book is entered rather than
	// on a second screen. Adding a title therefore also records that copy.
	const requiresAccession = usesAccessionRegister()

	const [records, setRecords] = useState<LibCatalogueRecord[]>([])
	/** The register — one row per accession number. */
	const [registerRows, setRegisterRows] = useState<RegisterRow[]>([])
	/** The one physical book waiting on a delete confirmation. */
	const [deleteCopy, setDeleteCopy] = useState<RegisterRow | null>(null)
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [formatFilter, setFormatFilter] = useState<string>('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibCatalogueRecord | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibCatalogueRecord | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			// The register is one row per physical book. The plain catalogue list
			// is kept behind the same flag for the fallback path below.
			const url = appendToUrl(requiresAccession ? '/api/lib/catalogue/register' : '/api/lib/catalogue')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			if (requiresAccession) setRegisterRows(data)
			else setRecords(data)
		} catch {
			toast({ title: 'Failed to load catalogue', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast, requiresAccession])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	/**
	 * Puts one newly entered book into the register on screen.
	 *
	 * Its title's other copies each gain one to their count, which is what the
	 * register itself would say the next time it is read. The table does its own
	 * sorting, so the row is simply appended.
	 */
	const addRegisterRow = useCallback((row: RegisterRow) => {
		setRegisterRows(prev => [
			...prev.map(existing =>
				row.catalogue_record_id && existing.catalogue_record_id === row.catalogue_record_id
					? { ...existing, total_copies: row.total_copies }
					: existing
			),
			row,
		])
	}, [])

	const scorecardData = useMemo(() => ({
		total: records.length,
		books: records.filter(r => r.resource_format === 'book').length,
		periodicals: records.filter(r => r.resource_format === 'periodical').length,
		referenceOnly: records.filter(r => r.is_reference_only).length,
	}), [records])

	const filtered = useMemo(() => {
		return records.filter(r => {
			const matchSearch = !search ||
				r.title.toLowerCase().includes(search.toLowerCase()) ||
				(r.isbn?.includes(search) ?? false) ||
				(r.call_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(r.authors?.some(a => a.author_name.toLowerCase().includes(search.toLowerCase())) ?? false)
			const matchFormat = formatFilter === 'all' || r.resource_format === formatFilter
			return matchSearch && matchFormat
		})
	}, [records, search, formatFilter])

	const pageSizeOptions = useMemo(() => {
		const options = [10, 25, 50]
		if (filtered.length > 50) options.push(filtered.length)
		return options
	}, [filtered.length])

	const effectivePerPage = itemsPerPage > filtered.length ? filtered.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? filtered.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: filtered
	const colCount = 7

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.title.trim()) e.title = 'Title is required'
		if (form.publication_year && (isNaN(Number(form.publication_year)) || Number(form.publication_year) < 1000)) {
			e.publication_year = 'Enter a valid year'
		}

		if (requiresAccession) {
			// The Pharmacy register has a filled column for each of these, so the
			// form asks for the same. Only Sub-Title, Call Number, Classification
			// Number and Book Location are optional there.
			if (!form.author.trim()) e.author = 'Author is required'
			if (!form.edition.trim()) e.edition = 'Edition/Issue is required'
			if (!form.publisher_name.trim()) e.publisher_name = 'Publisher name is required'
			if (!form.publisher_place.trim()) e.publisher_place = 'Place is required'
			if (!form.publication_year.trim()) e.publication_year = 'Year is required'
			else if (!/^\d{4}$/.test(form.publication_year.trim())) e.publication_year = 'Year must be four digits'
			if (!form.price.trim()) e.price = 'Price is required'
			else if (isNaN(Number(form.price)) || Number(form.price) < 0) e.price = 'Price must be a number'
			// Only books are issued an ISBN. A magazine, journal or project report
			// has none, and forcing the field would only get a made-up number
			// typed in — which would then group two unrelated titles into one.
			if (isbnRequiredFor(form.book_type) && !form.isbn.trim()) {
				e.isbn = 'ISBN is required for books'
			}
			if (!form.book_type.trim()) e.book_type = 'Book type is required'
			if (form.book_type === OTHER_BOOK_TYPE && !form.book_type_other.trim()) {
				e.book_type_other = 'Say what kind of material this is'
			}
			if (!form.language.trim()) e.language = 'Language is required'
			if (!form.pages.trim()) e.pages = 'Total pages is required'
			else if (isNaN(Number(form.pages)) || Number(form.pages) <= 0) e.pages = 'Total pages must be a number'
			// A magazine or journal is shelved for the whole college, so it is not
			// made to name a department.
			if (departmentRequiredFor(form.book_type) && !form.department.trim()) {
				e.department = 'Department is required'
			}

			// Copy-level, and only when adding — an existing title's copies are
			// managed on its own page
			if (!editingItem) {
				if (!form.accession_number.trim()) e.accession_number = 'Accession number is required'
				if (!form.accession_date.trim()) e.accession_date = 'Date of adding is required'
			}
		}

		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			// These belong to the physical copy or to the form itself, not to the
			// title record, so they are peeled off before the payload is built
			// The register fields are pulled out with them and added back only for
			// Pharmacy, so the other campuses send exactly the payload they always
			// sent rather than four empty columns they never asked for.
			const {
				accession_number, accession_date, book_type_other,
				author, book_type, department, book_location, supplier_name,
				...bibliographic
			} = form

			// "Others" is stored as whatever was typed, not as the word "Others" —
			// a shelf full of books all labelled Others is no better than blank.
			const bookType = book_type === OTHER_BOOK_TYPE ? book_type_other.trim() : book_type

			const payload = {
				...bibliographic,
				institution_id: instId ?? '',
				publication_year: form.publication_year ? Number(form.publication_year) : undefined,
				pages: form.pages ? Number(form.pages) : undefined,
				price: form.price ? Number(form.price) : undefined,
				subtitle: form.subtitle || undefined,
				currency_code: 'INR',
				// The register speaks in book types; the rest of the system reads
				// resource_format, so the chosen type sets both.
				...(requiresAccession
					? {
						author,
						department,
						book_location,
						book_type: bookType,
						resource_format: formatForBookType(book_type) as LibResourceFormat,
					}
					: {}),
			}
			if (editingItem) {
				const updated = await updateCatalogueRecord(editingItem.id, payload)
				setRecords(prev => prev.map(r => r.id === updated.id ? updated : r))
				toast({ title: '✅ Record updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else if (requiresAccession) {
				// One entry is one physical book. The server decides whether it is a
				// new title or another copy of one already held — by ISBN, then ISSN,
				// then title and author — so the copy count is however many
				// accession numbers point at the title, never a typed figure.
				const res = await fetch('/api/lib/catalogue/accession', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...payload,
						accession_number: accession_number.trim(),
						accession_date: accession_date || undefined,
						// Belongs to the copy, not to the title, and only a magazine
						// or journal is asked for one.
						supplier_name: usesSupplier(book_type) ? (supplier_name.trim() || undefined) : undefined,
					}),
				})
				const result = await res.json()
				if (!res.ok) throw new Error(result.error || 'Could not save the book')

				// The new line is put in place rather than the whole register
				// being read again — that read is 27,996 copies and 4,007 titles
				// on the largest college, for one book being entered.
				if (result.register_row) addRegisterRow(result.register_row as RegisterRow)
				else await fetchData()

				toast({
					title: result.copy_number > 1
						? `✅ Copy ${result.copy_number} of "${result.matched_title ?? result.title}"`
						: `✅ Book added — Accession ${result.accession_number}`,
					description: result.copy_number > 1
						? `Matched by ${result.matched_by}. The library now holds ${result.copy_number} copies.`
						: undefined,
					className: 'bg-green-50 border-green-200 text-green-800',
				})
			} else {
				const created = await createCatalogueRecord(payload)
				setRecords(prev => [created, ...prev])
				toast({ title: '✅ Record created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (r: LibCatalogueRecord) => {
		setEditingItem(r)
		setForm({
			title: r.title,
			subtitle: r.subtitle ?? '',
			resource_format: r.resource_format,
			isbn: r.isbn ?? '',
			issn: r.issn ?? '',
			edition: r.edition ?? '',
			publication_year: r.publication_year?.toString() ?? '',
			language: r.language ?? 'English',
			classification_number: r.classification_number ?? '',
			call_number: r.call_number ?? '',
			publisher_name: r.publisher_name ?? '',
			publisher_place: r.publisher_place ?? '',
			pages: r.pages?.toString() ?? '',
			price: r.price?.toString() ?? '',
			is_reference_only: r.is_reference_only,
			is_active: r.is_active,
			// Editing a title never touches an existing copy's number or date
			accession_number: '',
			accession_date: today(),
			author: r.author ?? r.authors?.[0]?.author_name ?? '',
			// A type saved as free text lands back in the Others box, not silently
			// reset to the first dropdown value
			book_type: BOOK_TYPE_LABELS.includes(r.book_type ?? '') ? (r.book_type ?? '') : (r.book_type ? OTHER_BOOK_TYPE : ''),
			book_type_other: BOOK_TYPE_LABELS.includes(r.book_type ?? '') ? '' : (r.book_type ?? ''),
			department: r.department ?? '',
			book_location: r.book_location ?? '',
			// Belongs to a copy, and copies are managed on the title's own page, so
			// editing a title never carries one.
			supplier_name: '',
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			await deleteCatalogueRecord(deleteTarget.id)
			setRecords(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Record deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	// A register row knows only which title it belongs to, so the full record is
	// read back before the form opens — the row itself does not carry price,
	// language or the rest of what the form edits.
	const editTitleById = async (recordId: string) => {
		try {
			const record = await fetchCatalogueById(recordId)
			handleEdit(record)
		} catch {
			toast({ title: '❌ Could not open that book', variant: 'destructive' })
		}
	}

	const removeCopy = async () => {
		if (!deleteCopy) return
		try {
			// One accession number, not the title. The other copies of the same
			// book are separate rows and are left where they are.
			const res = await fetch(`/api/lib/items/${deleteCopy.item_id}/remove`, { method: 'DELETE' })
			const result = await res.json()
			if (!res.ok) throw new Error(result.error || 'Delete failed')

			// Just the fact and the number. The counts on screen are corrected
			// below, without being announced.
			toast({
				title: `✅ Book removed — Accession ${result.accession_number}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})

			// The line goes, and its title's remaining copies are one fewer —
			// the same two changes a full re-read of the register would have
			// produced, without reading it.
			const removed = deleteCopy
			setRegisterRows(prev => prev
				.filter(row => row.item_id !== removed.item_id)
				.map(row =>
					removed.catalogue_record_id && row.catalogue_record_id === removed.catalogue_record_id
						? { ...row, total_copies: Math.max(1, row.total_copies - 1) }
						: row
				))
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteCopy(null)
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* The accession register — a line per physical book, accession number
			    first. The title list below is the fallback for any campus not on
			    the register layout. */}
			{requiresAccession ? (
				<AccessionRegisterTable
					rows={registerRows}
					loading={loading}
					onRefresh={fetchData}
					onEdit={editTitleById}
					onDelete={row => setDeleteCopy(row)}
					headerActions={
						<>
							<CatalogueBulkUpload
								institutionId={getInstitutionIdForCreate() ?? institutionId}
								institutionCode={currentInstitutionCode}
								onUploaded={fetchData}
								disabled={mustSelectInstitution}
							/>
							<CatalogueBulkEdit
								institutionId={getInstitutionIdForCreate() ?? institutionId}
								institutionCode={currentInstitutionCode}
								onSaved={fetchData}
								disabled={mustSelectInstitution}
							/>
							<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
								<PlusCircle className="h-4 w-4 mr-1.5" />
								<span className="hidden sm:inline">Add Title</span>
								<span className="sm:hidden">Add</span>
							</Button>
						</>
					}
				/>
			) : (
			<>
			{/* Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Titles</p>
							</div>
							<BookOpen className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.books}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Books</p>
							</div>
							<BookMarked className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-violet-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.periodicals}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Periodicals</p>
							</div>
							<Newspaper className="h-5 w-5 text-violet-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.referenceOnly}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Reference Only</p>
							</div>
							<BookLock className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						{/* Row 1: Title + Actions */}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold">Catalogue Registry</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} title{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Title</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						{/* Row 2: Filters */}
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={formatFilter} onValueChange={v => { setFormatFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue placeholder="Format" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Formats</SelectItem>
									{FORMATS.map(f => (
										<SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search title, ISBN, call number, author..."
									value={search}
									onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
									className="pl-8 h-8 text-sm"
								/>
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
										<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
						</div>
					</CardHeader>
					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* Desktop Table */}
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px] max-h-[520px] hidden md:block">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Author(s)</TableHead>
											<TableHead className="text-xs font-semibold">Format</TableHead>
											<TableHead className="text-xs font-semibold">Call #</TableHead>
											<TableHead className="text-xs font-semibold">Copies</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading catalogue...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookOpen className="h-8 w-8 opacity-20" />
														<span className="text-sm">No records found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.id} className="hover:bg-muted/50">
												<TableCell className="max-w-[260px]">
													<div className="text-sm font-medium truncate">{r.title}</div>
													{r.edition && <div className="text-xs text-muted-foreground">{r.edition} ed.</div>}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground max-w-[180px]">
													<span className="truncate block">{r.authors?.map(a => a.author_name).join(', ') ?? '—'}</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${FORMAT_COLORS[r.resource_format] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
														{r.resource_format}
													</Badge>
												</TableCell>
												<TableCell className="text-sm font-mono">{r.call_number ?? '—'}</TableCell>
												<TableCell className="text-sm">
													<span className="text-emerald-600 font-medium">{r.available_count ?? 0}</span>
													<span className="text-muted-foreground">/{r.item_count ?? 0}</span>
												</TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem asChild>
																<Link href={`/registry/${r.id}`}>
																	<ExternalLink className="h-4 w-4 mr-2" />View Detail
																</Link>
															</DropdownMenuItem>
															<DropdownMenuItem onClick={() => handleEdit(r)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(r)}>
																<Trash2 className="h-4 w-4 mr-2" />Delete
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

						{/* Mobile Cards */}
						<div className="md:hidden mt-3 space-y-3 overflow-auto max-h-[520px]">
							{loading ? (
								<div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
									<RefreshCw className="h-5 w-5 animate-spin" />
									<span className="text-sm">Loading...</span>
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<BookOpen className="h-8 w-8 opacity-20" />
									<span className="text-sm">No records found</span>
								</div>
							) : paginated.map(r => (
								<div key={r.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div className="flex-1 min-w-0">
											<p className="font-medium text-sm truncate">{r.title}</p>
											<p className="text-xs text-muted-foreground truncate">{r.authors?.map(a => a.author_name).join(', ') ?? '—'}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0 shrink-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem asChild>
													<Link href={`/registry/${r.id}`}>
														<ExternalLink className="h-4 w-4 mr-2" />View Detail
													</Link>
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => handleEdit(r)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(r)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${FORMAT_COLORS[r.resource_format] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
											{r.resource_format}
										</Badge>
										{r.is_reference_only && (
											<Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Ref Only</Badge>
										)}
										{r.call_number && <span className="text-xs text-muted-foreground font-mono">{r.call_number}</span>}
									</div>
									<div className="text-xs text-muted-foreground">
										<span className="text-emerald-600 font-medium">{r.available_count ?? 0}</span>
										<span>/{r.item_count ?? 0} copies available</span>
									</div>
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
										{pageSizeOptions.map(n => (
											<SelectItem key={n} value={String(n)}>{n === filtered.length ? 'All' : n}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{filtered.length === 0 ? '0 of 0' : `${(currentPage - 1) * effectivePerPage + 1}–${Math.min(currentPage * effectivePerPage, filtered.length)} of ${filtered.length}`}
								</span>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</TooltipProvider>
			</>
			)}

			{/* Sheet Form */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Catalogue Record' : 'Add New Title'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update bibliographic details below' : 'Enter bibliographic details to create a new catalogue record'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Pharmacy fills its own accession register, field for field, so
						    it gets its own layout. Every other campus keeps the screen
						    below, untouched. */}
						{requiresAccession ? (
							<CatalogueTitleForm
								form={form}
								setForm={setForm}
								errors={errors}
								showCopySection={!editingItem}
								institutionCode={currentInstitutionCode}
							/>
						) : (
						<>
						{/* Section: Bibliographic */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bibliographic</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Title <span className="text-red-500">*</span></Label>
								<Input
									value={form.title}
									onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
									className={errors.title ? 'border-red-500' : ''}
									placeholder="Full title of the resource"
								/>
								{errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Subtitle</Label>
								<Input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Optional subtitle" />
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Format</Label>
									<Select value={form.resource_format} onValueChange={v => setForm(f => ({ ...f, resource_format: v as LibResourceFormat }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>{FORMATS.map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Edition/Issue</Label>
									<Input value={form.edition} onChange={e => setForm(f => ({ ...f, edition: e.target.value }))} placeholder="e.g. 3rd — or Vol 12 Issue 4" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">ISBN</Label>
									<Input value={form.isbn} onChange={e => setForm(f => ({ ...f, isbn: e.target.value }))} placeholder="978-..." />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">ISSN</Label>
									<Input value={form.issn} onChange={e => setForm(f => ({ ...f, issn: e.target.value }))} placeholder="XXXX-XXXX" />
								</div>
							</div>
						</div>

						{/* Section: Publication */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Publication</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Publisher</Label>
									<Input value={form.publisher_name} onChange={e => setForm(f => ({ ...f, publisher_name: e.target.value }))} placeholder="Publisher name" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Publication Year</Label>
									<Input
										value={form.publication_year}
										onChange={e => setForm(f => ({ ...f, publication_year: e.target.value }))}
										className={errors.publication_year ? 'border-red-500' : ''}
										placeholder="2024"
									/>
									{errors.publication_year && <p className="text-xs text-red-500">{errors.publication_year}</p>}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Publisher Place</Label>
									<Input value={form.publisher_place} onChange={e => setForm(f => ({ ...f, publisher_place: e.target.value }))} placeholder="City, Country" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Language</Label>
									<Input value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} placeholder="English" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Price (INR)</Label>
									<Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Pages</Label>
									<Input type="number" value={form.pages} onChange={e => setForm(f => ({ ...f, pages: e.target.value }))} placeholder="Number of pages" />
								</div>
							</div>
						</div>

						{/* Section: Classification */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Classification</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Call Number</Label>
									<Input value={form.call_number} onChange={e => setForm(f => ({ ...f, call_number: e.target.value }))} placeholder="000.000 ABC" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Classification Number</Label>
									<Input value={form.classification_number} onChange={e => setForm(f => ({ ...f, classification_number: e.target.value }))} />
								</div>
							</div>
							<div className="flex items-center gap-6 flex-wrap">
								<div className="flex items-center gap-3">
									<Switch checked={form.is_reference_only} onCheckedChange={v => setForm(f => ({ ...f, is_reference_only: v }))} />
									<Label className="text-sm">Reference only (non-lendable)</Label>
								</div>
								<div className="flex items-center gap-3">
									<Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
									<Label className="text-sm">Active in catalogue</Label>
								</div>
							</div>
						</div>
						</>
						)}

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Record' : 'Create Record')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* One row, one book. The accession number is the only detail kept —
			    with several copies of a title the rows read alike, and that number
			    is what tells the librarian which one they are about to remove.
			    Copy counts are left out and refresh by themselves afterwards. */}
			<AlertDialog open={!!deleteCopy} onOpenChange={o => { if (!o) setDeleteCopy(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this book</AlertDialogTitle>
						<AlertDialogDescription>
							<strong>{deleteCopy?.title}</strong> — Accession <strong>{deleteCopy?.accession_number}</strong>
							{' '}will be removed from the register. This cannot be undone.
							{' '}If it is out with a member, or has an unpaid charge on it, the removal will stop.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={removeCopy} className="bg-red-600 hover:bg-red-700">
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Standalone Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Catalogue Record</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This action cannot be undone and will remove all associated item records.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
