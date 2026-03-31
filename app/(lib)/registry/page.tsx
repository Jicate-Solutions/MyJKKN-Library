'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
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
import {
	fetchCatalogueRecords,
	createCatalogueRecord,
	updateCatalogueRecord,
	deleteCatalogueRecord,
} from '@/services/library/lib-catalogue-service'

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
}

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
}

export default function RegistryPage() {
	const { isReady, appendToUrl, getInstitutionIdForCreate, institutionId, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [records, setRecords] = useState<LibCatalogueRecord[]>([])
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
			const url = appendToUrl('/api/lib/catalogue')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setRecords(data)
		} catch {
			toast({ title: 'Failed to load catalogue', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

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
		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			const payload = {
				...form,
				institution_id: instId ?? '',
				publication_year: form.publication_year ? Number(form.publication_year) : undefined,
				pages: form.pages ? Number(form.pages) : undefined,
				price: form.price ? Number(form.price) : undefined,
				subtitle: form.subtitle || undefined,
				currency_code: 'INR',
			}
			if (editingItem) {
				const updated = await updateCatalogueRecord(editingItem.id, payload)
				setRecords(prev => prev.map(r => r.id === updated.id ? updated : r))
				toast({ title: '✅ Record updated', className: 'bg-green-50 border-green-200 text-green-800' })
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

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
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
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Catalogue Registry</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} title{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
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
						<div className="flex items-center justify-between pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
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
									<Label className="text-sm font-semibold">Edition</Label>
									<Input value={form.edition} onChange={e => setForm(f => ({ ...f, edition: e.target.value }))} placeholder="e.g. 3rd" />
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
