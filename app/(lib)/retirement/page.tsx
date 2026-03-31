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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	PlusCircle, Search, RefreshCw, MoreHorizontal, CheckCircle, XCircle,
	Archive, Clock, ThumbsUp, PackageCheck, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibRetirementRequest } from '@/types/lib'

const statusColors: Record<string, string> = {
	pending: 'bg-amber-100 text-amber-800 border-amber-200',
	approved: 'bg-green-100 text-green-800 border-green-200',
	rejected: 'bg-red-100 text-red-800 border-red-200',
	completed: 'bg-blue-100 text-blue-800 border-blue-200',
}

interface FormData {
	item_id: string
	reason: string
	condition_at_retirement: string
}

const defaultForm: FormData = {
	item_id: '',
	reason: '',
	condition_at_retirement: '',
}

interface RejectDialogState {
	open: boolean
	target: LibRetirementRequest | null
	reason: string
}

export default function RetirementPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate } = useInstitutionFilter()
	const { toast } = useToast()

	const [requests, setRequests] = useState<LibRetirementRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)
	const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({ open: false, target: null, reason: '' })

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/retirement')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setRequests(data)
		} catch {
			toast({ title: 'Failed to load retirement requests', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [search, statusFilter])

	const scorecards = useMemo(() => ({
		total: requests.length,
		pending: requests.filter(r => r.retirement_status === 'pending').length,
		approved: requests.filter(r => r.retirement_status === 'approved').length,
		completed: requests.filter(r => r.retirement_status === 'completed').length,
	}), [requests])

	const filtered = useMemo(() => requests.filter(r => {
		const matchSearch = !search ||
			(r.item?.accession_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			(r.item?.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
			r.reason.toLowerCase().includes(search.toLowerCase())
		const matchStatus = statusFilter === 'all' || r.retirement_status === statusFilter
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

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.item_id.trim()) e.item_id = 'Item ID or accession # is required'
		if (!form.reason.trim()) e.reason = 'Reason is required'
		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			const payload = { ...form, institution_id: instId ?? '' }
			const res = await fetch('/api/lib/retirement', {
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
			toast({ title: '✅ Retirement request submitted', className: 'bg-green-50 border-green-200 text-green-800' })
			setSheetOpen(false)
			setForm(defaultForm)
			setErrors({})
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleApprove = async (r: LibRetirementRequest) => {
		try {
			const res = await fetch(`/api/lib/retirement/${r.id}/approve`, { method: 'POST' })
			if (!res.ok) throw new Error('Approval failed')
			const updated = await res.json()
			setRequests(prev => prev.map(x => x.id === updated.id ? updated : x))
			toast({ title: '✅ Request approved', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Action failed'), variant: 'destructive' })
		}
	}

	const handleRejectConfirm = async () => {
		if (!rejectDialog.target) return
		try {
			const res = await fetch(`/api/lib/retirement/${rejectDialog.target.id}/reject`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rejection_reason: rejectDialog.reason }),
			})
			if (!res.ok) throw new Error('Rejection failed')
			const updated = await res.json()
			setRequests(prev => prev.map(x => x.id === updated.id ? updated : x))
			toast({ title: '✅ Request rejected', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Action failed'), variant: 'destructive' })
		} finally {
			setRejectDialog({ open: false, target: null, reason: '' })
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
								<p className="text-2xl font-bold tracking-tight">{scorecards.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total</p>
							</div>
							<Archive className="h-5 w-5 text-blue-500/40" />
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
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.approved}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Approved</p>
							</div>
							<ThumbsUp className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.completed}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Completed</p>
							</div>
							<PackageCheck className="h-5 w-5 text-indigo-500/40" />
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
								<h2 className="text-base font-semibold">Retirement Requests</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} request{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { setForm(defaultForm); setErrors({}); setSheetOpen(true) }}>
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
									placeholder="Search accession #, title, reason..."
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
											<TableHead className="text-xs font-semibold">Accession #</TableHead>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Reason</TableHead>
											<TableHead className="text-xs font-semibold">Condition</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold">Date</TableHead>
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
														<Archive className="h-8 w-8 opacity-20" />
														<span className="text-sm">No retirement requests found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(r => (
											<TableRow key={r.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-mono font-medium">
													{r.item?.accession_number ?? r.item_id}
												</TableCell>
												<TableCell className="max-w-[160px]">
													<div className="truncate text-sm">{r.item?.catalogue_record?.title ?? '—'}</div>
												</TableCell>
												<TableCell className="max-w-[160px]">
													<div className="truncate text-sm">{r.reason}</div>
												</TableCell>
												<TableCell className="text-sm capitalize">{r.condition_at_retirement ?? '—'}</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs ${statusColors[r.retirement_status] ?? ''}`}>
														{r.retirement_status}
													</Badge>
												</TableCell>
												<TableCell className="text-sm">
													{new Date(r.created_at).toLocaleDateString('en-IN')}
												</TableCell>
												<TableCell>
													{r.retirement_status === 'pending' && (
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button variant="ghost" className="h-7 w-7 p-0">
																	<MoreHorizontal className="h-4 w-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem className="text-green-600 focus:text-green-600 focus:bg-green-50" onClick={() => handleApprove(r)}>
																	<CheckCircle className="h-4 w-4 mr-2" />Approve
																</DropdownMenuItem>
																<DropdownMenuSeparator />
																<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setRejectDialog({ open: true, target: r, reason: '' })}>
																	<XCircle className="h-4 w-4 mr-2" />Reject
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													)}
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
									<Archive className="h-8 w-8 opacity-20" />
									<span className="text-sm">No requests found</span>
								</div>
							) : paginated.map(r => (
								<div key={r.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm font-mono">{r.item?.accession_number ?? r.item_id}</p>
											<p className="text-xs text-muted-foreground truncate max-w-[200px]">
												{r.item?.catalogue_record?.title ?? '—'}
											</p>
										</div>
										{r.retirement_status === 'pending' && (
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem className="text-green-600 focus:text-green-600 focus:bg-green-50" onClick={() => handleApprove(r)}>
														<CheckCircle className="h-4 w-4 mr-2" />Approve
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setRejectDialog({ open: true, target: r, reason: '' })}>
														<XCircle className="h-4 w-4 mr-2" />Reject
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs ${statusColors[r.retirement_status] ?? ''}`}>
											{r.retirement_status}
										</Badge>
										{r.condition_at_retirement && (
											<Badge variant="outline" className="text-xs capitalize">{r.condition_at_retirement}</Badge>
										)}
									</div>
									<p className="text-xs text-muted-foreground line-clamp-2">{r.reason}</p>
									<p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-IN')}</p>
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

			{/* New Request Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) { setForm(defaultForm); setErrors({}) } setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">New Retirement Request</SheetTitle>
						<p className="text-sm text-muted-foreground">Submit a request to retire an item from the collection</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Item */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item</h3>
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
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Condition at Retirement</Label>
								<Input
									value={form.condition_at_retirement}
									onChange={e => setForm(f => ({ ...f, condition_at_retirement: e.target.value }))}
									placeholder="poor / damaged / lost"
								/>
							</div>
						</div>

						{/* Section: Reason */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Reason for Retirement <span className="text-red-500">*</span></Label>
								<Textarea
									value={form.reason}
									onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
									className={errors.reason ? 'border-red-500' : ''}
									rows={4}
									placeholder="Damaged beyond repair, obsolete content, lost..."
								/>
								{errors.reason && <p className="text-xs text-red-500">{errors.reason}</p>}
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Submitting...' : 'Submit Request'}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Reject Dialog */}
			<AlertDialog open={rejectDialog.open} onOpenChange={o => { if (!o) setRejectDialog({ open: false, target: null, reason: '' }) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reject Retirement Request</AlertDialogTitle>
						<AlertDialogDescription>
							Provide a reason for rejecting the request for item{' '}
							<strong>{rejectDialog.target?.item?.accession_number ?? rejectDialog.target?.item_id}</strong>.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="py-2">
						<Textarea
							value={rejectDialog.reason}
							onChange={e => setRejectDialog(d => ({ ...d, reason: e.target.value }))}
							placeholder="Rejection reason..."
							rows={3}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleRejectConfirm} className="bg-red-600 hover:bg-red-700">Reject</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
