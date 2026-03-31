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
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
	Package, FileEdit, Send, PackageCheck,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibProcurementOrder, LibOrderStatus } from '@/types/lib'

const STATUS_COLORS: Record<LibOrderStatus, string> = {
	draft: 'bg-gray-50 text-gray-600 border-gray-200',
	placed: 'bg-blue-50 text-blue-700 border-blue-200',
	acknowledged: 'bg-indigo-50 text-indigo-700 border-indigo-200',
	partially_received: 'bg-amber-50 text-amber-700 border-amber-200',
	received: 'bg-green-50 text-green-700 border-green-200',
	cancelled: 'bg-red-50 text-red-700 border-red-200',
	claimed: 'bg-purple-50 text-purple-700 border-purple-200',
}

const STATUSES: LibOrderStatus[] = ['draft', 'placed', 'acknowledged', 'partially_received', 'received', 'cancelled', 'claimed']

interface FormData {
	supplier_id: string
	order_date: string
	expected_delivery_date: string
	order_type: string
	fiscal_year: string
	notes: string
}

const defaultForm: FormData = {
	supplier_id: '',
	order_date: new Date().toISOString().split('T')[0],
	expected_delivery_date: '',
	order_type: 'firm',
	fiscal_year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
	notes: '',
}

export default function OrdersPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [orders, setOrders] = useState<LibProcurementOrder[]>([])
	const [suppliers, setSuppliers] = useState<{ id: string; supplier_name: string }[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibProcurementOrder | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibProcurementOrder | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const [ordersRes, suppliersRes] = await Promise.all([
				fetch(appendToUrl('/api/lib/acquisition/orders')),
				fetch(appendToUrl('/api/lib/acquisition/suppliers')),
			])
			if (!ordersRes.ok) throw new Error('Failed to fetch orders')
			const [ordersData, suppliersData] = await Promise.all([ordersRes.json(), suppliersRes.json()])
			setOrders(ordersData)
			setSuppliers(suppliersData)
		} catch {
			toast({ title: 'Failed to load data', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: orders.length,
		draft: orders.filter(o => o.order_status === 'draft').length,
		placed: orders.filter(o => o.order_status === 'placed' || o.order_status === 'acknowledged').length,
		received: orders.filter(o => o.order_status === 'received').length,
	}), [orders])

	const filtered = useMemo(() => {
		return orders.filter(o => {
			const matchSearch = !search ||
				o.order_number.toLowerCase().includes(search.toLowerCase()) ||
				(o.supplier?.supplier_name.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchStatus = statusFilter === 'all' || o.order_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [orders, search, statusFilter])

	const pageSizeOptions = useMemo(() => {
		const opts = [10, 25, 50]
		if (filtered.length > 50) opts.push(filtered.length)
		return opts
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
		if (!form.supplier_id) e.supplier_id = 'Supplier is required'
		if (!form.order_date) e.order_date = 'Order date is required'
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
				currency_code: 'INR',
				expected_delivery_date: form.expected_delivery_date || undefined,
				notes: form.notes || undefined,
			}
			const url = editingItem ? `/api/lib/acquisition/orders/${editingItem.id}` : '/api/lib/acquisition/orders'
			const res = await fetch(url, {
				method: editingItem ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Save failed')
			}
			const saved = await res.json()
			if (editingItem) {
				setOrders(prev => prev.map(o => o.id === saved.id ? saved : o))
				toast({ title: '✅ Order updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setOrders(prev => [saved, ...prev])
				toast({ title: '✅ Order created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (o: LibProcurementOrder) => {
		setEditingItem(o)
		setForm({
			supplier_id: o.supplier_id,
			order_date: o.order_date.split('T')[0],
			expected_delivery_date: o.expected_delivery_date?.split('T')[0] ?? '',
			order_type: o.order_type,
			fiscal_year: o.fiscal_year ?? '',
			notes: o.notes ?? '',
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/acquisition/orders/${deleteTarget.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Delete failed')
			setOrders(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Order deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Orders</p>
							</div>
							<Package className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-gray-400 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.draft}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Draft</p>
							</div>
							<FileEdit className="h-5 w-5 text-gray-400/60" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.placed}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Placed</p>
							</div>
							<Send className="h-5 w-5 text-indigo-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.received}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Received</p>
							</div>
							<PackageCheck className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Procurement Orders</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">New Order</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									{STATUSES.map(s => (
										<SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search order # or supplier..."
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
											<TableHead className="text-xs font-semibold">Order #</TableHead>
											<TableHead className="text-xs font-semibold">Supplier</TableHead>
											<TableHead className="text-xs font-semibold">Date</TableHead>
											<TableHead className="text-xs font-semibold">Type</TableHead>
											<TableHead className="text-xs font-semibold">Amount</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">Institution</TableHead>}
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading orders...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Package className="h-8 w-8 opacity-20" />
														<span className="text-sm">No orders found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(o => (
											<TableRow key={o.id} className="hover:bg-muted/50">
												<TableCell className="text-xs font-mono font-medium">{o.order_number}</TableCell>
												<TableCell className="text-sm">{o.supplier?.supplier_name ?? '—'}</TableCell>
												<TableCell className="text-sm">{new Date(o.order_date).toLocaleDateString('en-IN')}</TableCell>
												<TableCell className="text-sm capitalize">{o.order_type.replace('_', ' ')}</TableCell>
												<TableCell className="text-sm font-medium">
													{o.total_amount != null ? `₹${o.total_amount.toLocaleString('en-IN')}` : '—'}
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[o.order_status]}`}>
														{o.order_status.replace('_', ' ')}
													</Badge>
												</TableCell>
												{mustSelectInstitution && (
													<TableCell className="text-xs text-muted-foreground">{o.institution_id?.slice(0, 8) ?? '—'}</TableCell>
												)}
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(o)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(o)}>
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
									<Package className="h-8 w-8 opacity-20" />
									<span className="text-sm">No orders found</span>
								</div>
							) : paginated.map(o => (
								<div key={o.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm font-mono">{o.order_number}</p>
											<p className="text-xs text-muted-foreground">{o.supplier?.supplier_name ?? '—'}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleEdit(o)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(o)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[o.order_status]}`}>
											{o.order_status.replace('_', ' ')}
										</Badge>
										<span className="text-xs text-muted-foreground capitalize">{o.order_type.replace('_', ' ')}</span>
									</div>
									<p className="text-xs text-muted-foreground">
										{new Date(o.order_date).toLocaleDateString('en-IN')}
										{o.total_amount != null ? ` · ₹${o.total_amount.toLocaleString('en-IN')}` : ''}
									</p>
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
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Order' : 'Create Order'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update order details below' : 'Create a new procurement order'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Order Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order Info</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Supplier <span className="text-red-500">*</span></Label>
								<Select value={form.supplier_id} onValueChange={v => setForm(f => ({ ...f, supplier_id: v }))}>
									<SelectTrigger className={errors.supplier_id ? 'border-red-500' : ''}><SelectValue placeholder="Select supplier" /></SelectTrigger>
									<SelectContent>
										{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>)}
									</SelectContent>
								</Select>
								{errors.supplier_id && <p className="text-xs text-red-500">{errors.supplier_id}</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Order Date <span className="text-red-500">*</span></Label>
									<Input
										type="date"
										value={form.order_date}
										onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}
										className={errors.order_date ? 'border-red-500' : ''}
									/>
									{errors.order_date && <p className="text-xs text-red-500">{errors.order_date}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Expected Delivery</Label>
									<Input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Order Type</Label>
									<Select value={form.order_type} onValueChange={v => setForm(f => ({ ...f, order_type: v }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="firm">Firm</SelectItem>
											<SelectItem value="on_approval">On Approval</SelectItem>
											<SelectItem value="gift">Gift</SelectItem>
											<SelectItem value="exchange">Exchange</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Fiscal Year</Label>
									<Input value={form.fiscal_year} onChange={e => setForm(f => ({ ...f, fiscal_year: e.target.value }))} placeholder="2025-26" />
								</div>
							</div>
						</div>

						{/* Section: Items */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Items</h3>
							<div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
								Items can be added after creating the order from the order detail view.
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Notes</Label>
								<Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional order notes" rows={3} />
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Order' : 'Create Order')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Order</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete order <strong>{deleteTarget?.order_number}</strong>? This action cannot be undone.
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
