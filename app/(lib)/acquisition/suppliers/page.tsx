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
	Truck, CheckCircle2, XCircle, Building2,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibSupplier } from '@/types/lib'
import {
	fetchSuppliers,
	createSupplier,
	updateSupplier,
	deleteSupplier,
} from '@/services/library/lib-suppliers-service'

interface FormData {
	supplier_code: string
	supplier_name: string
	contact_person: string
	email: string
	phone: string
	address: string
	city: string
	state: string
	pincode: string
	gst_number: string
	pan_number: string
	payment_terms: string
	is_active: boolean
}

const defaultForm: FormData = {
	supplier_code: '',
	supplier_name: '',
	contact_person: '',
	email: '',
	phone: '',
	address: '',
	city: '',
	state: '',
	pincode: '',
	gst_number: '',
	pan_number: '',
	payment_terms: '',
	is_active: true,
}

export default function SuppliersPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [suppliers, setSuppliers] = useState<LibSupplier[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [activeFilter, setActiveFilter] = useState<string>('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibSupplier | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibSupplier | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/procurement/suppliers')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setSuppliers(data)
		} catch {
			toast({ title: 'Failed to load suppliers', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: suppliers.length,
		active: suppliers.filter(s => s.is_active).length,
		inactive: suppliers.filter(s => !s.is_active).length,
	}), [suppliers])

	const filtered = useMemo(() => {
		return suppliers.filter(s => {
			const matchSearch = !search ||
				s.supplier_name.toLowerCase().includes(search.toLowerCase()) ||
				s.supplier_code.toLowerCase().includes(search.toLowerCase()) ||
				(s.email?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(s.city?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchActive =
				activeFilter === 'all' ||
				(activeFilter === 'active' && s.is_active) ||
				(activeFilter === 'inactive' && !s.is_active)
			return matchSearch && matchActive
		})
	}, [suppliers, search, activeFilter])

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
	const colCount = mustSelectInstitution ? 8 : 7

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.supplier_code.trim()) e.supplier_code = 'Code is required'
		if (!form.supplier_name.trim()) e.supplier_name = 'Name is required'
		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			const payload = { ...form, institution_id: instId ?? '' }
			if (editingItem) {
				const updated = await updateSupplier(editingItem.id, payload)
				setSuppliers(prev => prev.map(s => s.id === updated.id ? updated : s))
				toast({ title: '✅ Supplier updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				const created = await createSupplier(payload)
				setSuppliers(prev => [created, ...prev])
				toast({ title: '✅ Supplier created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (s: LibSupplier) => {
		setEditingItem(s)
		setForm({
			supplier_code: s.supplier_code,
			supplier_name: s.supplier_name,
			contact_person: s.contact_person ?? '',
			email: s.email ?? '',
			phone: s.phone ?? '',
			address: s.address ?? '',
			city: s.city ?? '',
			state: s.state ?? '',
			pincode: s.pincode ?? '',
			gst_number: s.gst_number ?? '',
			pan_number: s.pan_number ?? '',
			payment_terms: s.payment_terms ?? '',
			is_active: s.is_active,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			await deleteSupplier(deleteTarget.id)
			setSuppliers(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Supplier deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Suppliers</p>
							</div>
							<Truck className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.active}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Active</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.inactive}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Inactive</p>
							</div>
							<XCircle className="h-5 w-5 text-rose-500/40" />
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
								<h2 className="text-base font-semibold">Suppliers</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} supplier{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Supplier</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						{/* Row 2: Filters */}
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search name, code, email, city..."
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
											<TableHead className="text-xs font-semibold">Code</TableHead>
											<TableHead className="text-xs font-semibold">Name</TableHead>
											<TableHead className="text-xs font-semibold">Contact</TableHead>
											<TableHead className="text-xs font-semibold">City</TableHead>
											<TableHead className="text-xs font-semibold">GST</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading suppliers...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Truck className="h-8 w-8 opacity-20" />
														<span className="text-sm">No suppliers found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(s => (
											<TableRow key={s.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-mono font-medium">{s.supplier_code}</TableCell>
												<TableCell>
													<div className="text-sm font-medium">{s.supplier_name}</div>
													{s.contact_person && <div className="text-xs text-muted-foreground">{s.contact_person}</div>}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													<div>{s.email ?? '—'}</div>
													{s.phone && <div className="text-xs">{s.phone}</div>}
												</TableCell>
												<TableCell className="text-sm">{s.city ?? '—'}</TableCell>
												<TableCell className="text-sm font-mono text-muted-foreground">{s.gst_number ?? '—'}</TableCell>
												<TableCell>
													<Badge variant="outline" className={s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}>
														{s.is_active ? 'Active' : 'Inactive'}
													</Badge>
												</TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(s)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(s)}>
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
									<Truck className="h-8 w-8 opacity-20" />
									<span className="text-sm">No suppliers found</span>
								</div>
							) : paginated.map(s => (
								<div key={s.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">{s.supplier_name}</p>
											<p className="text-xs text-muted-foreground font-mono">{s.supplier_code}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleEdit(s)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(s)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}>
											{s.is_active ? 'Active' : 'Inactive'}
										</Badge>
										{s.city && <span className="text-xs text-muted-foreground">{s.city}</span>}
									</div>
									{s.contact_person && <p className="text-xs text-muted-foreground">{s.contact_person}</p>}
									{s.email && <p className="text-xs text-muted-foreground">{s.email}</p>}
									{s.gst_number && <p className="text-xs text-muted-foreground font-mono">GST: {s.gst_number}</p>}
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
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Supplier' : 'Add Supplier'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update supplier details below' : 'Fill in the details to register a new supplier'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Identity */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Supplier Code <span className="text-red-500">*</span></Label>
									<Input
										value={form.supplier_code}
										onChange={e => setForm(f => ({ ...f, supplier_code: e.target.value }))}
										className={errors.supplier_code ? 'border-red-500' : ''}
										placeholder="SUP-001"
									/>
									{errors.supplier_code && <p className="text-xs text-red-500">{errors.supplier_code}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Supplier Name <span className="text-red-500">*</span></Label>
									<Input
										value={form.supplier_name}
										onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
										className={errors.supplier_name ? 'border-red-500' : ''}
										placeholder="Full supplier name"
									/>
									{errors.supplier_name && <p className="text-xs text-red-500">{errors.supplier_name}</p>}
								</div>
							</div>
							<div className="flex items-center gap-3">
								<Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
								<Label className="text-sm">Active supplier</Label>
							</div>
						</div>

						{/* Section: Contact */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Contact Person</Label>
									<Input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="Name of contact" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Phone</Label>
									<Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 00000 00000" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Email</Label>
								<Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="supplier@example.com" />
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Address</Label>
								<Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street address" />
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">City</Label>
									<Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">State</Label>
									<Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="State" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Pincode</Label>
									<Input value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} placeholder="600001" />
								</div>
							</div>
						</div>

						{/* Section: Compliance */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compliance</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">GST Number</Label>
									<Input value={form.gst_number} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" className="font-mono" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">PAN Number</Label>
									<Input value={form.pan_number} onChange={e => setForm(f => ({ ...f, pan_number: e.target.value }))} placeholder="AAAAA0000A" className="font-mono" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Payment Terms</Label>
								<Input value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="e.g. Net 30, 50% advance" />
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Supplier' : 'Create Supplier')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Standalone Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Supplier</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.supplier_name}</strong> ({deleteTarget?.supplier_code})? This action cannot be undone.
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
