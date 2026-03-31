'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	PlusCircle, Search, RefreshCw, MoreHorizontal, Edit,
	ArrowLeftRight, Clock, Send, RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibIntercampusRequest } from '@/types/lib'

const statusColors: Record<string, string> = {
	pending: 'bg-amber-100 text-amber-800 border-amber-200',
	approved: 'bg-blue-100 text-blue-800 border-blue-200',
	dispatched: 'bg-indigo-100 text-indigo-800 border-indigo-200',
	received: 'bg-green-100 text-green-800 border-green-200',
	returned: 'bg-gray-100 text-gray-800 border-gray-200',
	rejected: 'bg-red-100 text-red-800 border-red-200',
	lost: 'bg-red-200 text-red-900 border-red-300',
}

interface FormData {
	member_id: string
	title: string
	author: string
	isbn: string
	request_note: string
}

const defaultForm: FormData = {
	member_id: '',
	title: '',
	author: '',
	isbn: '',
	request_note: '',
}

export default function IntercampusPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate } = useInstitutionFilter()
	const { toast } = useToast()

	const [requests, setRequests] = useState<LibIntercampusRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibIntercampusRequest | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/intercampus')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setRequests(data)
		} catch {
			toast({ title: 'Failed to load inter-campus requests', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [search, statusFilter])

	const scorecards = useMemo(() => ({
		total: requests.length,
		pending: requests.filter(r => r.request_status === 'pending').length,
		dispatched: requests.filter(r => r.request_status === 'dispatched').length,
		returned: requests.filter(r => r.request_status === 'returned').length,
	}), [requests])

	const filtered = useMemo(() => requests.filter(r => {
		const matchSearch = !search ||
			r.title.toLowerCase().includes(search.toLowerCase()) ||
			(r.author?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			(r.member?.display_name?.toLowerCase().includes(search.toLowerCase()) ?? false)
		const matchStatus = statusFilter === 'all' || r.request_status === statusFilter
		return matchSearch && matchStatus
	}), [requests, search, statusFilter])

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
		if (!form.member_id.trim()) e.member_id = 'Member ID is required'
		if (!form.title.trim()) e.title = 'Title is required'
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
				request_date: new Date().toISOString().split('T')[0],
			}
			const res = await fetch('/api/lib/intercampus', {
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
			toast({ title: '✅ Request submitted', className: 'bg-green-50 border-green-200 text-green-800' })
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (r: LibIntercampusRequest) => {
		setEditingItem(r)
		setForm({
			member_id: r.member_id,
			title: r.title,
			author: r.author ?? '',
			isbn: r.isbn ?? '',
			request_note: r.request_note ?? '',
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
							<ArrowLeftRight className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.pending}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Pending</p>
							</div>
							<Clock className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.dispatched}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Dispatched</p>
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
								<h2 className="text-base font-semibold">Inter-Campus Requests</h2>
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
							<Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
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
									placeholder="Search title, author, member..."
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
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Member</TableHead>
											<TableHead className="text-xs font-semibold">Providing Institution</TableHead>
											<TableHead className="text-xs font-semibold">Request Date</TableHead>
											<TableHead className="text-xs font-semibold">Due Date</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading requests...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<ArrowLeftRight className="h-8 w-8 opacity-20" />
														<span className="text-sm">No inter-campus requests found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.id} className="hover:bg-muted/50">
												<TableCell className="max-w-[180px]">
													<div className="truncate text-sm font-medium">{r.title}</div>
													{r.author && <div className="text-xs text-muted-foreground truncate">{r.author}</div>}
												</TableCell>
												<TableCell>
													<div className="text-sm font-medium">{r.member?.display_name ?? r.member_id}</div>
													{r.member?.member_number && (
														<div className="text-xs text-muted-foreground font-mono">{r.member.member_number}</div>
													)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{r.providing_institution_id ? r.providing_institution_id.slice(0, 12) + '…' : '—'}
												</TableCell>
												<TableCell className="text-sm">
													{new Date(r.request_date).toLocaleDateString('en-IN')}
												</TableCell>
												<TableCell className="text-sm">
													{r.due_date ? new Date(r.due_date).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs ${statusColors[r.request_status] ?? ''}`}>
														{r.request_status}
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
									<ArrowLeftRight className="h-8 w-8 opacity-20" />
									<span className="text-sm">No requests found</span>
								</div>
							) : paginated.map(r => (
								<div key={r.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm truncate max-w-[200px]">{r.title}</p>
											<p className="text-xs text-muted-foreground">{r.member?.display_name ?? r.member_id}</p>
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
										<Badge variant="outline" className={`text-xs ${statusColors[r.request_status] ?? ''}`}>
											{r.request_status}
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground">
										Requested: {new Date(r.request_date).toLocaleDateString('en-IN')}
										{r.due_date ? ` · Due: ${new Date(r.due_date).toLocaleDateString('en-IN')}` : ''}
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

			{/* New / Edit Request Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">
							{editingItem ? 'Edit Request' : 'New Inter-Campus Request'}
						</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update request details below' : 'Request a resource from another campus'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Requester */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Requester</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Member ID <span className="text-red-500">*</span></Label>
								<Input
									value={form.member_id}
									onChange={e => setForm(f => ({ ...f, member_id: e.target.value }))}
									className={errors.member_id ? 'border-red-500' : ''}
									placeholder="Member UUID or member number"
								/>
								{errors.member_id && <p className="text-xs text-red-500">{errors.member_id}</p>}
							</div>
						</div>

						{/* Section: Resource */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resource</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Title <span className="text-red-500">*</span></Label>
								<Input
									value={form.title}
									onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
									className={errors.title ? 'border-red-500' : ''}
									placeholder="Resource title"
								/>
								{errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Author</Label>
									<Input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">ISBN</Label>
									<Input value={form.isbn} onChange={e => setForm(f => ({ ...f, isbn: e.target.value }))} />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Request Note</Label>
								<Textarea
									value={form.request_note}
									onChange={e => setForm(f => ({ ...f, request_note: e.target.value }))}
									placeholder="Any special notes for the providing campus..."
									rows={3}
								/>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Submitting...' : (editingItem ? 'Update Request' : 'Submit Request')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	)
}
