'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	PlusCircle, Search, RefreshCw, MoreHorizontal, Edit,
	Wrench, ScanSearch, Send, RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibConservationRequest } from '@/types/lib'

const statusColors: Record<string, string> = {
	identified: 'bg-amber-100 text-amber-800 border-amber-200',
	sent: 'bg-blue-100 text-blue-800 border-blue-200',
	returned: 'bg-green-100 text-green-800 border-green-200',
	cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
}

const typeColors: Record<string, string> = {
	binding: 'bg-indigo-100 text-indigo-800 border-indigo-200',
	repair: 'bg-orange-100 text-orange-800 border-orange-200',
	lamination: 'bg-purple-100 text-purple-800 border-purple-200',
	digitisation: 'bg-teal-100 text-teal-800 border-teal-200',
}

const conservationTypes = ['binding', 'repair', 'lamination', 'digitisation'] as const
type ConservationType = typeof conservationTypes[number]

interface FormData {
	conservation_type: ConservationType
	item_id: string
	binder_name: string
	sent_to_binder: string
	expected_return: string
	binding_cost: string
}

const defaultForm: FormData = {
	conservation_type: 'binding',
	item_id: '',
	binder_name: '',
	sent_to_binder: '',
	expected_return: '',
	binding_cost: '',
}

export default function ConservationPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate } = useInstitutionFilter()
	const { toast } = useToast()

	const [requests, setRequests] = useState<LibConservationRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [typeFilter, setTypeFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibConservationRequest | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/conservation')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setRequests(data)
		} catch {
			toast({ title: 'Failed to load conservation requests', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [search, statusFilter, typeFilter])

	const scorecards = useMemo(() => ({
		total: requests.length,
		identified: requests.filter(r => r.conservation_status === 'identified').length,
		sent: requests.filter(r => r.conservation_status === 'sent').length,
		returned: requests.filter(r => r.conservation_status === 'returned').length,
	}), [requests])

	const filtered = useMemo(() => requests.filter(r => {
		const matchSearch = !search ||
			(r.item?.accession_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			(r.item?.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			(r.binder_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			r.conservation_type.toLowerCase().includes(search.toLowerCase())
		const matchStatus = statusFilter === 'all' || r.conservation_status === statusFilter
		const matchType = typeFilter === 'all' || r.conservation_type === typeFilter
		return matchSearch && matchStatus && matchType
	}), [requests, search, statusFilter, typeFilter])

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

	const resetForm = () => { setForm(defaultForm); setErrors({}); setEditingItem(null) }

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.item_id.trim()) e.item_id = 'Item ID is required'
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
				binding_cost: form.binding_cost ? Number(form.binding_cost) : undefined,
				sent_to_binder: form.sent_to_binder || undefined,
				expected_return: form.expected_return || undefined,
				binder_name: form.binder_name || undefined,
			}
			const res = await fetch('/api/lib/conservation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Save failed')
			}
			const created = await res.json()
			setRequests(prev => [created, ...prev])
			toast({ title: '✅ Conservation request created', className: 'bg-green-50 border-green-200 text-green-800' })
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (r: LibConservationRequest) => {
		setEditingItem(r)
		setForm({
			conservation_type: r.conservation_type,
			item_id: r.item_id ?? '',
			binder_name: r.binder_name ?? '',
			sent_to_binder: r.sent_to_binder?.split('T')[0] ?? '',
			expected_return: r.expected_return?.split('T')[0] ?? '',
			binding_cost: r.binding_cost?.toString() ?? '',
		})
		setSheetOpen(true)
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total</p>
							</div>
							<Wrench className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.identified}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Identified</p>
							</div>
							<ScanSearch className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.sent}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Sent</p>
							</div>
							<Send className="h-5 w-5 text-indigo-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.returned}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Returned</p>
							</div>
							<RotateCcw className="h-5 w-5 text-emerald-500/40" />
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
								<h2 className="text-base font-semibold">Conservation Requests</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} request{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">New Request</span>
									<span className="sm:hidden">New</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={typeFilter} onValueChange={v => setTypeFilter(v)}>
								<SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue placeholder="Type" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Types</SelectItem>
									{conservationTypes.map(t => (
										<SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
								<SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									{Object.keys(statusColors).map(s => (
										<SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search accession #, title, binder..."
									value={search}
									onChange={e => setSearch(e.target.value)}
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
											<TableHead className="text-xs font-semibold">Type</TableHead>
											<TableHead className="text-xs font-semibold">Accession #</TableHead>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Binder</TableHead>
											<TableHead className="text-xs font-semibold">Sent Date</TableHead>
											<TableHead className="text-xs font-semibold">Expected Return</TableHead>
											<TableHead className="text-xs font-semibold">Cost</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={9} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading requests...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={9} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Wrench className="h-8 w-8 opacity-20" />
														<span className="text-sm">No conservation requests found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.id} className="hover:bg-muted/50">
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${typeColors[r.conservation_type] ?? ''}`}>
														{r.conservation_type}
													</Badge>
												</TableCell>
												<TableCell className="text-sm font-mono font-medium">
													{r.item?.accession_number ?? r.item_id ?? '—'}
												</TableCell>
												<TableCell className="max-w-[150px]">
													<div className="truncate text-sm">{r.item?.catalogue_record?.title ?? '—'}</div>
												</TableCell>
												<TableCell className="text-sm">{r.binder_name ?? '—'}</TableCell>
												<TableCell className="text-sm">
													{r.sent_to_binder ? new Date(r.sent_to_binder).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell className="text-sm">
													{r.expected_return ? new Date(r.expected_return).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell className="text-sm">
													{r.binding_cost != null ? `₹${r.binding_cost.toFixed(2)}` : '—'}
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs ${statusColors[r.conservation_status] ?? ''}`}>
														{r.conservation_status}
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
															<DropdownMenuItem onClick={() => handleEdit(r)}>
																<Edit className="h-4 w-4 mr-2" />Edit
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
									<Wrench className="h-8 w-8 opacity-20" />
									<span className="text-sm">No requests found</span>
								</div>
							) : paginated.map(r => (
								<div key={r.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm font-mono">{r.item?.accession_number ?? r.item_id ?? '—'}</p>
											<p className="text-xs text-muted-foreground truncate max-w-[200px]">
												{r.item?.catalogue_record?.title ?? '—'}
											</p>
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
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${typeColors[r.conservation_type] ?? ''}`}>
											{r.conservation_type}
										</Badge>
										<Badge variant="outline" className={`text-xs ${statusColors[r.conservation_status] ?? ''}`}>
											{r.conservation_status}
										</Badge>
									</div>
									{r.binder_name && <p className="text-xs text-muted-foreground">Binder: {r.binder_name}</p>}
									{r.binding_cost != null && <p className="text-xs text-muted-foreground">Cost: ₹{r.binding_cost.toFixed(2)}</p>}
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

			{/* New / Edit Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">
							{editingItem ? 'Edit Conservation Request' : 'New Conservation Request'}
						</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update the conservation request details' : 'Log an item for binding, repair, or other conservation work'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Item */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Conservation Type</Label>
									<Select value={form.conservation_type} onValueChange={v => setForm(f => ({ ...f, conservation_type: v as ConservationType }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{conservationTypes.map(t => (
												<SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Item ID / Accession # <span className="text-red-500">*</span></Label>
									<Input
										value={form.item_id}
										onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}
										className={errors.item_id ? 'border-red-500' : ''}
										placeholder="ACC-2025-001 or Item UUID"
									/>
									{errors.item_id && <p className="text-xs text-red-500">{errors.item_id}</p>}
								</div>
							</div>
						</div>

						{/* Section: Binder Details */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Binder Details</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Binder / Vendor Name</Label>
								<Input value={form.binder_name} onChange={e => setForm(f => ({ ...f, binder_name: e.target.value }))} placeholder="Binding vendor name" />
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Sent Date</Label>
									<Input type="date" value={form.sent_to_binder} onChange={e => setForm(f => ({ ...f, sent_to_binder: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Expected Return</Label>
									<Input type="date" value={form.expected_return} onChange={e => setForm(f => ({ ...f, expected_return: e.target.value }))} />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Binding Cost (₹)</Label>
								<Input type="number" value={form.binding_cost} onChange={e => setForm(f => ({ ...f, binding_cost: e.target.value }))} placeholder="0.00" />
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Request' : 'Create Request')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	)
}
