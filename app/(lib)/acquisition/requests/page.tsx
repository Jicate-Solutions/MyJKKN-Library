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
	ShoppingCart, Clock, CheckCircle2, PackageCheck,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown,
} from 'lucide-react'
import type { LibProcurementRequest, LibProcurementRequestStatus } from '@/types/lib'

const STATUS_COLORS: Record<LibProcurementRequestStatus, string> = {
	pending: 'bg-amber-50 text-amber-700 border-amber-200',
	approved: 'bg-green-50 text-green-700 border-green-200',
	rejected: 'bg-red-50 text-red-700 border-red-200',
	ordered: 'bg-blue-50 text-blue-700 border-blue-200',
	received: 'bg-purple-50 text-purple-700 border-purple-200',
	cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
}

const PRIORITY_COLORS: Record<string, string> = {
	low: 'bg-gray-50 text-gray-600 border-gray-200',
	normal: 'bg-blue-50 text-blue-700 border-blue-200',
	high: 'bg-orange-50 text-orange-700 border-orange-200',
	urgent: 'bg-red-50 text-red-700 border-red-200',
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const STATUSES: LibProcurementRequestStatus[] = ['pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled']
const FORMATS = ['book', 'periodical', 'digital', 'thesis', 'report', 'other'] as const

interface FormData {
	title: string
	author: string
	publisher: string
	edition: string
	isbn: string
	resource_format: string
	quantity: string
	estimated_price: string
	department: string
	purpose: string
	priority: string
}

const defaultForm: FormData = {
	title: '',
	author: '',
	publisher: '',
	edition: '',
	isbn: '',
	resource_format: 'book',
	quantity: '1',
	estimated_price: '',
	department: '',
	purpose: '',
	priority: 'normal',
}

interface RejectDialogState {
	open: boolean
	request: LibProcurementRequest | null
	reason: string
}

export default function PurchaseRequestsPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [requests, setRequests] = useState<LibProcurementRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibProcurementRequest | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibProcurementRequest | null>(null)
	const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({ open: false, request: null, reason: '' })
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/acquisition/requests')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setRequests(data)
		} catch {
			toast({ title: 'Failed to load requests', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: requests.length,
		pending: requests.filter(r => r.request_status === 'pending').length,
		approved: requests.filter(r => r.request_status === 'approved').length,
		ordered: requests.filter(r => r.request_status === 'ordered').length,
	}), [requests])

	const filtered = useMemo(() => {
		return requests.filter(r => {
			const matchSearch = !search ||
				r.title.toLowerCase().includes(search.toLowerCase()) ||
				r.request_number.toLowerCase().includes(search.toLowerCase()) ||
				(r.author?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchStatus = statusFilter === 'all' || r.request_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [requests, search, statusFilter])

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
	const colCount = mustSelectInstitution ? 9 : 8

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.title.trim()) e.title = 'Title is required'
		if (!form.quantity || Number(form.quantity) < 1) e.quantity = 'Quantity must be at least 1'
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
				quantity: Number(form.quantity),
				estimated_price: form.estimated_price ? Number(form.estimated_price) : undefined,
				currency_code: 'INR',
			}
			const url = editingItem ? `/api/lib/acquisition/requests/${editingItem.id}` : '/api/lib/acquisition/requests'
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
				setRequests(prev => prev.map(r => r.id === saved.id ? saved : r))
				toast({ title: '✅ Request updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setRequests(prev => [saved, ...prev])
				toast({ title: '✅ Request submitted', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (r: LibProcurementRequest) => {
		setEditingItem(r)
		setForm({
			title: r.title,
			author: r.author ?? '',
			publisher: r.publisher ?? '',
			edition: r.edition ?? '',
			isbn: r.isbn ?? '',
			resource_format: r.resource_format,
			quantity: String(r.quantity),
			estimated_price: r.estimated_price?.toString() ?? '',
			department: r.department ?? '',
			purpose: r.purpose ?? '',
			priority: r.priority,
		})
		setSheetOpen(true)
	}

	const handleApprove = async (r: LibProcurementRequest) => {
		try {
			const res = await fetch(`/api/lib/acquisition/requests/${r.id}/approve`, { method: 'POST' })
			if (!res.ok) throw new Error('Approval failed')
			const updated = await res.json()
			setRequests(prev => prev.map(x => x.id === updated.id ? updated : x))
			toast({ title: '✅ Request approved', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Approval failed'), variant: 'destructive' })
		}
	}

	const handleRejectConfirm = async () => {
		if (!rejectDialog.request) return
		try {
			const res = await fetch(`/api/lib/acquisition/requests/${rejectDialog.request.id}/reject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rejection_reason: rejectDialog.reason }),
			})
			if (!res.ok) throw new Error('Rejection failed')
			const updated = await res.json()
			setRequests(prev => prev.map(x => x.id === updated.id ? updated : x))
			toast({ title: '✅ Request rejected', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Rejection failed'), variant: 'destructive' })
		} finally {
			setRejectDialog({ open: false, request: null, reason: '' })
		}
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/acquisition/requests/${deleteTarget.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Delete failed')
			setRequests(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Request deleted', className: 'bg-green-50 border-green-200 text-green-800' })
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Requests</p>
							</div>
							<ShoppingCart className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.pending}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Pending</p>
							</div>
							<Clock className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.approved}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Approved</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-purple-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.ordered}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Ordered</p>
							</div>
							<PackageCheck className="h-5 w-5 text-purple-500/40" />
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
								<h2 className="text-base font-semibold">Purchase Requests</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} request{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">New Request</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									{STATUSES.map(s => (
										<SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search title, author, req #..."
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
											<TableHead className="text-xs font-semibold">Req #</TableHead>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Author</TableHead>
											<TableHead className="text-xs font-semibold">Qty</TableHead>
											<TableHead className="text-xs font-semibold">Price</TableHead>
											<TableHead className="text-xs font-semibold">Priority</TableHead>
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
														<span className="text-sm">Loading requests...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<ShoppingCart className="h-8 w-8 opacity-20" />
														<span className="text-sm">No requests found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.id} className="hover:bg-muted/50">
												<TableCell className="text-xs font-mono font-medium">{r.request_number}</TableCell>
												<TableCell className="max-w-[180px]">
													<div className="truncate text-sm font-medium">{r.title}</div>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">{r.author ?? '—'}</TableCell>
												<TableCell className="text-sm">{r.quantity}</TableCell>
												<TableCell className="text-sm">
													{r.estimated_price != null ? `₹${r.estimated_price.toLocaleString('en-IN')}` : '—'}
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${PRIORITY_COLORS[r.priority]}`}>
														{r.priority}
													</Badge>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[r.request_status]}`}>
														{r.request_status}
													</Badge>
												</TableCell>
												{mustSelectInstitution && (
													<TableCell className="text-xs text-muted-foreground">{r.institution_id?.slice(0, 8) ?? '—'}</TableCell>
												)}
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(r)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															{r.request_status === 'pending' && (
																<>
																	<DropdownMenuSeparator />
																	<DropdownMenuItem className="text-green-700 focus:text-green-700 focus:bg-green-50" onClick={() => handleApprove(r)}>
																		<ThumbsUp className="h-4 w-4 mr-2" />Approve
																	</DropdownMenuItem>
																	<DropdownMenuItem className="text-amber-700 focus:text-amber-700 focus:bg-amber-50" onClick={() => setRejectDialog({ open: true, request: r, reason: '' })}>
																		<ThumbsDown className="h-4 w-4 mr-2" />Reject
																	</DropdownMenuItem>
																</>
															)}
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
									<ShoppingCart className="h-8 w-8 opacity-20" />
									<span className="text-sm">No requests found</span>
								</div>
							) : paginated.map(r => (
								<div key={r.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">{r.title}</p>
											<p className="text-xs text-muted-foreground font-mono">{r.request_number}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleEdit(r)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												{r.request_status === 'pending' && (
													<>
														<DropdownMenuSeparator />
														<DropdownMenuItem className="text-green-700 focus:text-green-700 focus:bg-green-50" onClick={() => handleApprove(r)}>
															<ThumbsUp className="h-4 w-4 mr-2" />Approve
														</DropdownMenuItem>
														<DropdownMenuItem className="text-amber-700 focus:text-amber-700 focus:bg-amber-50" onClick={() => setRejectDialog({ open: true, request: r, reason: '' })}>
															<ThumbsDown className="h-4 w-4 mr-2" />Reject
														</DropdownMenuItem>
													</>
												)}
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(r)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</Badge>
										<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[r.request_status]}`}>{r.request_status}</Badge>
									</div>
									{r.author && <p className="text-xs text-muted-foreground">{r.author}</p>}
									<p className="text-xs text-muted-foreground">Qty: {r.quantity}{r.estimated_price != null ? ` · ₹${r.estimated_price.toLocaleString('en-IN')}` : ''}</p>
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
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Request' : 'New Purchase Request'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update the request details below' : 'Submit a new resource acquisition request'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Resource Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resource Info</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Title <span className="text-red-500">*</span></Label>
								<Input
									value={form.title}
									onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
									className={errors.title ? 'border-red-500' : ''}
									placeholder="Book or resource title"
								/>
								{errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Author</Label>
									<Input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder="Author name" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Publisher</Label>
									<Input value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} placeholder="Publisher" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">ISBN</Label>
									<Input value={form.isbn} onChange={e => setForm(f => ({ ...f, isbn: e.target.value }))} placeholder="978-..." />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Edition</Label>
									<Input value={form.edition} onChange={e => setForm(f => ({ ...f, edition: e.target.value }))} placeholder="e.g. 3rd" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Format</Label>
								<Select value={form.resource_format} onValueChange={v => setForm(f => ({ ...f, resource_format: v }))}>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										{FORMATS.map(fmt => <SelectItem key={fmt} value={fmt} className="capitalize">{fmt}</SelectItem>)}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Section: Procurement Details */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Procurement Details</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Quantity <span className="text-red-500">*</span></Label>
									<Input
										type="number"
										min="1"
										value={form.quantity}
										onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
										className={errors.quantity ? 'border-red-500' : ''}
									/>
									{errors.quantity && <p className="text-xs text-red-500">{errors.quantity}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Estimated Price (₹)</Label>
									<Input
										type="number"
										min="0"
										value={form.estimated_price}
										onChange={e => setForm(f => ({ ...f, estimated_price: e.target.value }))}
										placeholder="0.00"
									/>
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Priority</Label>
									<Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Department</Label>
									<Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Requesting department" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Purpose / Justification</Label>
								<Textarea
									value={form.purpose}
									onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
									rows={3}
									placeholder="Why is this resource needed?"
								/>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Request' : 'Submit Request')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Request</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete request for <strong>{deleteTarget?.title}</strong>? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Reject Dialog */}
			<AlertDialog open={rejectDialog.open} onOpenChange={o => { if (!o) setRejectDialog({ open: false, request: null, reason: '' }) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reject Request</AlertDialogTitle>
						<AlertDialogDescription>
							Provide a reason for rejecting <strong>{rejectDialog.request?.title}</strong>.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="px-1 pb-2">
						<Textarea
							placeholder="Reason for rejection..."
							value={rejectDialog.reason}
							onChange={e => setRejectDialog(d => ({ ...d, reason: e.target.value }))}
							rows={3}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleRejectConfirm} className="bg-amber-600 hover:bg-amber-700">Reject Request</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
