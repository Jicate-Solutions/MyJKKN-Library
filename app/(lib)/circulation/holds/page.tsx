'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
	BookCopy, Clock, CheckCircle2, BookCheck,
	MoreHorizontal, XCircle, Search, RefreshCw,
	ChevronLeft, ChevronRight,
} from 'lucide-react'
import { fetchHolds, cancelHold } from '@/services/library/lib-circulation-service'
import type { LibResourceHold } from '@/types/lib'

const HOLD_STATUS_COLORS: Record<string, string> = {
	pending: 'bg-amber-50 text-amber-700 border-amber-200',
	available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
	fulfilled: 'bg-blue-50 text-blue-700 border-blue-200',
	cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
	expired: 'bg-red-50 text-red-700 border-red-200',
}

export default function HoldsPage() {
	const { isReady, institutionId, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [holds, setHolds] = useState<LibResourceHold[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState<string>('all')
	const [cancelTarget, setCancelTarget] = useState<LibResourceHold | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			const data = await fetchHolds(institutionId)
			setHolds(data)
		} catch {
			toast({ title: 'Failed to load holds', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: holds.length,
		pending: holds.filter(h => h.hold_status === 'pending').length,
		available: holds.filter(h => h.hold_status === 'available').length,
		fulfilled: holds.filter(h => h.hold_status === 'fulfilled').length,
	}), [holds])

	const filtered = useMemo(() => {
		return holds.filter(h => {
			const matchSearch = !search ||
				(h.member?.display_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(h.member?.member_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(h.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchStatus = statusFilter === 'all' || h.hold_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [holds, search, statusFilter])

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

	const handleCancel = async () => {
		if (!cancelTarget) return
		try {
			await cancelHold(cancelTarget.id)
			setHolds(prev => prev.filter(h => h.id !== cancelTarget.id))
			toast({ title: '✅ Hold cancelled', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Cancel failed'), variant: 'destructive' })
		} finally {
			setCancelTarget(null)
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Holds</p>
							</div>
							<BookCopy className="h-5 w-5 text-blue-500/40" />
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
								<p className="text-2xl font-bold tracking-tight">{scorecardData.available}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Available</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-violet-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.fulfilled}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Fulfilled</p>
							</div>
							<BookCheck className="h-5 w-5 text-violet-500/40" />
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
								<h2 className="text-base font-semibold">Holds Queue</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} hold{filtered.length !== 1 ? 's' : ''}</p>
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
						{/* Row 2: Filters */}
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="pending">Pending</SelectItem>
									<SelectItem value="available">Available</SelectItem>
									<SelectItem value="fulfilled">Fulfilled</SelectItem>
									<SelectItem value="cancelled">Cancelled</SelectItem>
									<SelectItem value="expired">Expired</SelectItem>
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search member or title..."
									value={search}
									onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
									className="pl-8 h-8 text-sm"
								/>
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
											<TableHead className="text-xs font-semibold">Member</TableHead>
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold">Placed At</TableHead>
											<TableHead className="text-xs font-semibold">Expires</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={6} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading holds...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={6} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookCopy className="h-8 w-8 opacity-20" />
														<span className="text-sm">No holds found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(h => (
											<TableRow key={h.id} className="hover:bg-muted/50">
												<TableCell>
													<div className="text-sm font-medium">{h.member?.display_name ?? h.member_id}</div>
													<div className="text-xs text-muted-foreground">{h.member?.member_number}</div>
												</TableCell>
												<TableCell className="max-w-[200px]">
													<div className="truncate text-sm">{h.catalogue_record?.title ?? h.catalogue_record_id}</div>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${HOLD_STATUS_COLORS[h.hold_status] ?? ''}`}>
														{h.hold_status}
													</Badge>
												</TableCell>
												<TableCell className="text-sm">{new Date(h.hold_placed_at).toLocaleDateString('en-IN')}</TableCell>
												<TableCell className="text-sm">
													{h.hold_expires_at ? new Date(h.hold_expires_at).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell>
													{(h.hold_status === 'pending' || h.hold_status === 'available') && (
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button variant="ghost" className="h-7 w-7 p-0">
																	<MoreHorizontal className="h-4 w-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setCancelTarget(h)}>
																	<XCircle className="h-4 w-4 mr-2" />Cancel Hold
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
									<BookCopy className="h-8 w-8 opacity-20" />
									<span className="text-sm">No holds found</span>
								</div>
							) : paginated.map(h => (
								<div key={h.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">{h.member?.display_name ?? h.member_id}</p>
											<p className="text-xs text-muted-foreground">{h.member?.member_number}</p>
										</div>
										{(h.hold_status === 'pending' || h.hold_status === 'available') && (
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setCancelTarget(h)}>
														<XCircle className="h-4 w-4 mr-2" />Cancel Hold
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</div>
									<p className="text-sm truncate">{h.catalogue_record?.title ?? h.catalogue_record_id}</p>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${HOLD_STATUS_COLORS[h.hold_status] ?? ''}`}>
											{h.hold_status}
										</Badge>
										<span className="text-xs text-muted-foreground">
											Placed {new Date(h.hold_placed_at).toLocaleDateString('en-IN')}
										</span>
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

			{/* Cancel Confirm Dialog */}
			<AlertDialog open={!!cancelTarget} onOpenChange={o => { if (!o) setCancelTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel Hold</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to cancel the hold for <strong>{cancelTarget?.member?.display_name ?? cancelTarget?.member_id}</strong> on <strong>{cancelTarget?.catalogue_record?.title}</strong>?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep Hold</AlertDialogCancel>
						<AlertDialogAction onClick={handleCancel} className="bg-red-600 hover:bg-red-700">Cancel Hold</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
