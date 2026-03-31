'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import {
	ArrowLeft, PlusCircle, RefreshCw, MoreHorizontal, Edit, Trash2,
	BookOpen, CheckCircle, ArrowLeftRight, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import type { LibCatalogueRecord, LibItem, LibItemStatus, LibItemCondition } from '@/types/lib'
import { fetchCatalogueById } from '@/services/library/lib-catalogue-service'
import { fetchItems, createItem, updateItem, deleteItem } from '@/services/library/lib-items-service'

const ITEM_STATUSES: LibItemStatus[] = ['available', 'on_loan', 'on_hold', 'on_order', 'in_conservation', 'lost', 'damaged', 'retired', 'missing']
const CONDITIONS: LibItemCondition[] = ['new', 'good', 'fair', 'poor', 'damaged', 'lost']

interface ItemFormData {
	accession_number: string
	barcode: string
	copy_number: string
	condition: LibItemCondition
	price: string
	date_received: string
	invoice_number: string
	status: LibItemStatus
	is_lendable: boolean
	is_active: boolean
}

const defaultItemForm: ItemFormData = {
	accession_number: '',
	barcode: '',
	copy_number: '1',
	condition: 'new',
	price: '',
	date_received: new Date().toISOString().split('T')[0],
	invoice_number: '',
	status: 'available',
	is_lendable: true,
	is_active: true,
}

export default function CatalogueDetailPage() {
	const { id } = useParams<{ id: string }>()
	const { institutionId, getInstitutionIdForCreate } = useInstitutionFilter()
	const { toast } = useToast()

	const [record, setRecord] = useState<LibCatalogueRecord | null>(null)
	const [items, setItems] = useState<LibItem[]>([])
	const [loadingRecord, setLoadingRecord] = useState(true)
	const [loadingItems, setLoadingItems] = useState(true)
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibItem | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibItem | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<ItemFormData>(defaultItemForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const loadRecord = useCallback(async () => {
		try {
			setLoadingRecord(true)
			const data = await fetchCatalogueById(id)
			setRecord(data)
		} catch {
			toast({ title: 'Failed to load catalogue record', variant: 'destructive' })
		} finally {
			setLoadingRecord(false)
		}
	}, [id, toast])

	const loadItems = useCallback(async () => {
		try {
			setLoadingItems(true)
			const data = await fetchItems(id)
			setItems(data)
		} catch {
			toast({ title: 'Failed to load items', variant: 'destructive' })
		} finally {
			setLoadingItems(false)
		}
	}, [id, toast])

	useEffect(() => { loadRecord(); loadItems() }, [loadRecord, loadItems])

	const scorecards = useMemo(() => ({
		total: items.length,
		available: items.filter(i => i.status === 'available').length,
		onLoan: items.filter(i => i.status === 'on_loan').length,
		lost: items.filter(i => i.status === 'lost').length,
	}), [items])

	const pageSizeOptions = useMemo(() => {
		const opts = [10, 25, 50]
		if (items.length > 50) opts.push(items.length)
		return opts
	}, [items.length])

	const effectivePerPage = itemsPerPage > items.length ? items.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(items.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? items.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: items

	const resetForm = () => { setForm(defaultItemForm); setErrors({}); setEditingItem(null) }

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.accession_number.trim()) e.accession_number = 'Accession number is required'
		if (!form.copy_number || isNaN(Number(form.copy_number))) e.copy_number = 'Valid copy number required'
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
				catalogue_record_id: id,
				institution_id: instId ?? '',
				copy_number: Number(form.copy_number),
				price: form.price ? Number(form.price) : undefined,
				barcode: form.barcode || undefined,
				invoice_number: form.invoice_number || undefined,
				currency_code: 'INR',
				accession_date: form.date_received,
			}
			if (editingItem) {
				const updated = await updateItem(editingItem.id, payload)
				setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
				toast({ title: '✅ Item updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				const created = await createItem(payload)
				setItems(prev => [created, ...prev])
				toast({ title: '✅ Item created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (item: LibItem) => {
		setEditingItem(item)
		setForm({
			accession_number: item.accession_number,
			barcode: item.barcode ?? '',
			copy_number: String(item.copy_number),
			condition: item.condition ?? 'good',
			price: item.price?.toString() ?? '',
			date_received: item.date_received?.split('T')[0] ?? '',
			invoice_number: item.invoice_number ?? '',
			status: item.status,
			is_lendable: item.is_lendable,
			is_active: item.is_active,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			await deleteItem(deleteTarget.id)
			setItems(prev => prev.filter(i => i.id !== deleteTarget.id))
			toast({ title: '✅ Item deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	if (loadingRecord) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="flex items-center gap-2 py-4">
					<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
					<span className="text-sm text-muted-foreground">Loading catalogue record...</span>
				</div>
			</div>
		)
	}

	if (!record) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="py-12 text-center text-muted-foreground">
					<BookOpen className="h-10 w-10 mx-auto mb-2 opacity-20" />
					<p className="text-sm">Record not found.</p>
					<Button variant="outline" size="sm" className="mt-4" asChild>
						<Link href="/registry">Back to Registry</Link>
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Page Header */}
			<div className="flex items-start gap-3 pt-1">
				<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-0.5" asChild>
					<Link href="/registry"><ArrowLeft className="h-4 w-4" /></Link>
				</Button>
				<div className="flex-1 min-w-0">
					<h1 className="text-lg font-semibold leading-tight truncate">{record.title}</h1>
					{record.subtitle && <p className="text-sm text-muted-foreground truncate">{record.subtitle}</p>}
					<div className="flex flex-wrap gap-1.5 mt-1.5">
						<Badge variant="secondary" className="capitalize text-xs">{record.resource_format}</Badge>
						{record.is_reference_only && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Reference Only</Badge>}
						{record.isbn && <Badge variant="outline" className="text-xs">ISBN: {record.isbn}</Badge>}
					</div>
				</div>
			</div>

			{/* Bibliographic Info Card */}
			<Card className="flex-shrink-0">
				<CardHeader className="px-4 py-3 border-b">
					<h2 className="text-base font-semibold">Bibliographic Information</h2>
				</CardHeader>
				<CardContent className="px-4 py-4">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-sm">
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Authors</p>
							<p className="font-medium">{record.authors?.map(a => a.author_name).join(', ') || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Publisher</p>
							<p className="font-medium">{record.publisher_name || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Year</p>
							<p className="font-medium">{record.publication_year || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Edition</p>
							<p className="font-medium">{record.edition || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Call Number</p>
							<p className="font-mono font-medium">{record.call_number || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Classification</p>
							<p className="font-medium">{record.classification_number || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Language</p>
							<p className="font-medium">{record.language || '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Pages</p>
							<p className="font-medium">{record.pages || '—'}</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Item Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Copies</p>
							</div>
							<BookOpen className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.available}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Available</p>
							</div>
							<CheckCircle className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.onLoan}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">On Loan</p>
							</div>
							<ArrowLeftRight className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.lost}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Lost</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Items Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Items / Copies</h2>
								<p className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={loadItems}>
											<RefreshCw className={`h-4 w-4 ${loadingItems ? 'animate-spin' : ''}`} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Refresh</TooltipContent>
								</Tooltip>
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Item</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* Desktop Table */}
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px] max-h-[520px] hidden md:block">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Accession #</TableHead>
											<TableHead className="text-xs font-semibold">Barcode</TableHead>
											<TableHead className="text-xs font-semibold">Copy</TableHead>
											<TableHead className="text-xs font-semibold">Location</TableHead>
											<TableHead className="text-xs font-semibold">Condition</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loadingItems ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading items...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookOpen className="h-8 w-8 opacity-20" />
														<span className="text-sm">No items added yet</span>
														<span className="text-xs">Click Add Item to accession a copy</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(item => (
											<TableRow key={item.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-mono font-medium">{item.accession_number}</TableCell>
												<TableCell className="text-sm font-mono">{item.barcode ?? '—'}</TableCell>
												<TableCell className="text-sm">{item.copy_number}</TableCell>
												<TableCell className="text-sm">{item.location?.location_name ?? '—'}</TableCell>
												<TableCell className="text-sm capitalize">{item.condition ?? '—'}</TableCell>
												<TableCell><ResourceStatusBadge status={item.status} /></TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(item)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(item)}>
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
							{loadingItems ? (
								<div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
									<RefreshCw className="h-5 w-5 animate-spin" />
									<span className="text-sm">Loading...</span>
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<BookOpen className="h-8 w-8 opacity-20" />
									<span className="text-sm">No items added yet</span>
								</div>
							) : paginated.map(item => (
								<div key={item.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm font-mono">{item.accession_number}</p>
											<p className="text-xs text-muted-foreground">Copy #{item.copy_number}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleEdit(item)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(item)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<ResourceStatusBadge status={item.status} />
										<Badge variant="outline" className="text-xs capitalize">{item.condition ?? 'unknown'}</Badge>
									</div>
									{item.barcode && <p className="text-xs text-muted-foreground">Barcode: {item.barcode}</p>}
									{item.location && <p className="text-xs text-muted-foreground">Location: {item.location.location_name}</p>}
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
											<SelectItem key={n} value={String(n)}>{n === items.length ? 'All' : n}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{items.length === 0 ? '0 of 0' : `${(currentPage - 1) * effectivePerPage + 1}–${Math.min(currentPage * effectivePerPage, items.length)} of ${items.length}`}
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

			{/* Add / Edit Item Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Item' : 'Add Item (Accession)'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update item details below' : 'Fill in details to accession a new copy of this title'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Identifiers */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identifiers</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Accession # <span className="text-red-500">*</span></Label>
									<Input
										value={form.accession_number}
										onChange={e => setForm(f => ({ ...f, accession_number: e.target.value }))}
										className={errors.accession_number ? 'border-red-500' : ''}
										placeholder="ACC-2025-001"
									/>
									{errors.accession_number && <p className="text-xs text-red-500">{errors.accession_number}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Barcode</Label>
									<Input value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} placeholder="Scan or type" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Copy # <span className="text-red-500">*</span></Label>
									<Input
										type="number"
										min="1"
										value={form.copy_number}
										onChange={e => setForm(f => ({ ...f, copy_number: e.target.value }))}
										className={errors.copy_number ? 'border-red-500' : ''}
									/>
									{errors.copy_number && <p className="text-xs text-red-500">{errors.copy_number}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Condition</Label>
									<Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v as LibItemCondition }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						{/* Section: Status & Acquisition */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status & Acquisition</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Status</Label>
									<Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as LibItemStatus }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>{ITEM_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Price (INR)</Label>
									<Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Date Received</Label>
									<Input type="date" value={form.date_received} onChange={e => setForm(f => ({ ...f, date_received: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Invoice #</Label>
									<Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
								</div>
							</div>
							<div className="flex gap-6">
								<div className="flex items-center gap-3">
									<Switch checked={form.is_lendable} onCheckedChange={v => setForm(f => ({ ...f, is_lendable: v }))} />
									<Label className="text-sm">Lendable</Label>
								</div>
								<div className="flex items-center gap-3">
									<Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
									<Label className="text-sm">Active</Label>
								</div>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Item' : 'Add Item')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Standalone Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Item</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete item <strong>{deleteTarget?.accession_number}</strong>? This action cannot be undone.
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
