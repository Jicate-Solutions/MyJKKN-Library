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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
	IndianRupee, AlertCircle, CheckCircle2, MinusCircle,
	MoreHorizontal, CreditCard, Undo2, Search, RefreshCw,
	ChevronLeft, ChevronRight,
} from 'lucide-react'
import { fetchCharges, collectPayment, waiveCharge } from '@/services/library/lib-late-charges-service'
import type { LibLateCharge, LibChargePaymentStatus } from '@/types/lib'

const STATUS_COLORS: Record<LibChargePaymentStatus, string> = {
	unpaid: 'bg-red-50 text-red-700 border-red-200',
	paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
	waived: 'bg-blue-50 text-blue-700 border-blue-200',
	partial: 'bg-amber-50 text-amber-700 border-amber-200',
}

type ActionMode = 'collect' | 'waive' | null

export default function ChargesPage() {
	const { isReady, institutionId, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [charges, setCharges] = useState<LibLateCharge[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState<string>('all')
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const [sheetOpen, setSheetOpen] = useState(false)
	const [actionMode, setActionMode] = useState<ActionMode>(null)
	const [selectedCharge, setSelectedCharge] = useState<LibLateCharge | null>(null)
	const [paymentReference, setPaymentReference] = useState('')
	const [waiverReason, setWaiverReason] = useState('')
	const [waiverAmount, setWaiverAmount] = useState('')
	const [processing, setProcessing] = useState(false)

	const fetchData = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			const data = await fetchCharges(institutionId)
			setCharges(data)
		} catch {
			toast({ title: 'Failed to load charges', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: charges.length,
		unpaid: charges.filter(c => c.payment_status === 'unpaid').length,
		paid: charges.filter(c => c.payment_status === 'paid').length,
		waived: charges.filter(c => c.payment_status === 'waived').length,
	}), [charges])

	const filtered = useMemo(() => {
		return charges.filter(c => {
			const matchSearch = !search ||
				(c.member?.display_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(c.member?.member_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(c.transaction?.item?.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchStatus = statusFilter === 'all' || c.payment_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [charges, search, statusFilter])

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

	const openCollect = (c: LibLateCharge) => {
		setSelectedCharge(c)
		setActionMode('collect')
		setPaymentReference('')
		setSheetOpen(true)
	}

	const openWaive = (c: LibLateCharge) => {
		setSelectedCharge(c)
		setActionMode('waive')
		setWaiverReason('')
		setWaiverAmount(String(c.net_payable))
		setSheetOpen(true)
	}

	const closeSheet = () => {
		setSheetOpen(false)
		setSelectedCharge(null)
		setActionMode(null)
	}

	const handleAction = async () => {
		if (!selectedCharge) return
		try {
			setProcessing(true)
			if (actionMode === 'collect') {
				const updated = await collectPayment(selectedCharge.id, { payment_reference: paymentReference })
				setCharges(prev => prev.map(c => c.id === updated.id ? updated : c))
				toast({ title: '✅ Payment collected', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				const amount = Number(waiverAmount)
				if (isNaN(amount) || amount <= 0) {
					toast({ title: '❌ Enter a valid waiver amount', variant: 'destructive' })
					return
				}
				if (!waiverReason.trim()) {
					toast({ title: '❌ Waiver reason is required', variant: 'destructive' })
					return
				}
				const updated = await waiveCharge(selectedCharge.id, { waiver_amount: amount, waiver_reason: waiverReason })
				setCharges(prev => prev.map(c => c.id === updated.id ? updated : c))
				toast({ title: '✅ Charge waived', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			closeSheet()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Action failed'), variant: 'destructive' })
		} finally {
			setProcessing(false)
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Charges</p>
							</div>
							<IndianRupee className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-red-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.unpaid}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Unpaid</p>
							</div>
							<AlertCircle className="h-5 w-5 text-red-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.paid}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Paid</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-blue-400 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.waived}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Waived</p>
							</div>
							<MinusCircle className="h-5 w-5 text-blue-400/40" />
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
								<h2 className="text-base font-semibold">Late Charges</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} charge{filtered.length !== 1 ? 's' : ''}</p>
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
								<SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="unpaid">Unpaid</SelectItem>
									<SelectItem value="paid">Paid</SelectItem>
									<SelectItem value="waived">Waived</SelectItem>
									<SelectItem value="partial">Partial</SelectItem>
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
											<TableHead className="text-xs font-semibold">Days</TableHead>
											<TableHead className="text-xs font-semibold">Charge</TableHead>
											<TableHead className="text-xs font-semibold">Waiver</TableHead>
											<TableHead className="text-xs font-semibold">Net</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={8} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading charges...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={8} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<IndianRupee className="h-8 w-8 opacity-20" />
														<span className="text-sm">No charges found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(c => (
											<TableRow key={c.id} className="hover:bg-muted/50">
												<TableCell>
													<div className="text-sm font-medium">{c.member?.display_name ?? c.member_id}</div>
													<div className="text-xs text-muted-foreground">{c.member?.member_number}</div>
												</TableCell>
												<TableCell className="max-w-[180px]">
													<div className="truncate text-sm">{c.transaction?.item?.catalogue_record?.title ?? c.transaction_id}</div>
												</TableCell>
												<TableCell className="text-sm">{c.overdue_days}</TableCell>
												<TableCell className="text-sm">₹{c.total_charge.toFixed(2)}</TableCell>
												<TableCell className="text-sm text-blue-600">
													{c.waiver_amount > 0 ? `₹${c.waiver_amount.toFixed(2)}` : '—'}
												</TableCell>
												<TableCell className="text-sm font-medium">₹{c.net_payable.toFixed(2)}</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[c.payment_status]}`}>
														{c.payment_status}
													</Badge>
												</TableCell>
												<TableCell>
													{c.payment_status === 'unpaid' && (
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button variant="ghost" className="h-7 w-7 p-0">
																	<MoreHorizontal className="h-4 w-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem onClick={() => openCollect(c)}>
																	<CreditCard className="h-4 w-4 mr-2 text-emerald-600" />Collect Payment
																</DropdownMenuItem>
																<DropdownMenuSeparator />
																<DropdownMenuItem onClick={() => openWaive(c)}>
																	<Undo2 className="h-4 w-4 mr-2 text-blue-500" />Waive Charge
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
									<IndianRupee className="h-8 w-8 opacity-20" />
									<span className="text-sm">No charges found</span>
								</div>
							) : paginated.map(c => (
								<div key={c.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">{c.member?.display_name ?? c.member_id}</p>
											<p className="text-xs text-muted-foreground">{c.member?.member_number}</p>
										</div>
										{c.payment_status === 'unpaid' && (
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => openCollect(c)}>
														<CreditCard className="h-4 w-4 mr-2 text-emerald-600" />Collect Payment
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem onClick={() => openWaive(c)}>
														<Undo2 className="h-4 w-4 mr-2 text-blue-500" />Waive Charge
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</div>
									<p className="text-sm truncate">{c.transaction?.item?.catalogue_record?.title ?? c.transaction_id}</p>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[c.payment_status]}`}>
											{c.payment_status}
										</Badge>
										<span className="text-xs text-muted-foreground">{c.overdue_days} days overdue</span>
									</div>
									<div className="flex items-center justify-between text-sm">
										<span className="text-muted-foreground text-xs">Net payable</span>
										<span className="font-medium">₹{c.net_payable.toFixed(2)}</span>
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

			{/* Action Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) closeSheet(); else setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[480px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">
							{actionMode === 'collect' ? 'Collect Payment' : 'Waive Charge'}
						</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{actionMode === 'collect'
								? 'Record payment for the outstanding late charge'
								: 'Apply a waiver to reduce the outstanding charge'}
						</p>
					</SheetHeader>
					{selectedCharge && (
						<div className="mt-6 space-y-8">
							{/* Charge Summary */}
							<div className="space-y-4">
								<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Charge Summary</h3>
								<div className="rounded-lg bg-muted/50 border p-4 space-y-2 text-sm">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Member</span>
										<span className="font-medium">{selectedCharge.member?.display_name ?? selectedCharge.member_id}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Overdue Days</span>
										<span className="font-medium">{selectedCharge.overdue_days}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Total Charge</span>
										<span>₹{selectedCharge.total_charge.toFixed(2)}</span>
									</div>
									<div className="flex justify-between border-t pt-2">
										<span className="text-muted-foreground font-medium">Net Payable</span>
										<span className="font-bold">₹{selectedCharge.net_payable.toFixed(2)}</span>
									</div>
								</div>
							</div>

							{/* Action Fields */}
							<div className="space-y-4 pt-2 border-t">
								<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
									{actionMode === 'collect' ? 'Payment Details' : 'Waiver Details'}
								</h3>
								{actionMode === 'collect' ? (
									<div className="space-y-2">
										<Label className="text-sm font-semibold">Payment Reference</Label>
										<Input
											value={paymentReference}
											onChange={e => setPaymentReference(e.target.value)}
											placeholder="Receipt no. / UPI ref / Cash..."
										/>
									</div>
								) : (
									<div className="space-y-4">
										<div className="space-y-2">
											<Label className="text-sm font-semibold">Waiver Amount (₹) <span className="text-red-500">*</span></Label>
											<Input
												type="number"
												min="0"
												max={selectedCharge.net_payable}
												value={waiverAmount}
												onChange={e => setWaiverAmount(e.target.value)}
												placeholder="0.00"
											/>
										</div>
										<div className="space-y-2">
											<Label className="text-sm font-semibold">Reason <span className="text-red-500">*</span></Label>
											<Input
												value={waiverReason}
												onChange={e => setWaiverReason(e.target.value)}
												placeholder="Reason for waiver"
											/>
										</div>
									</div>
								)}
							</div>

							{/* Actions */}
							<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
								<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={closeSheet}>Cancel</Button>
								<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleAction} disabled={processing}>
									{processing ? 'Processing...' : (actionMode === 'collect' ? 'Collect Payment' : 'Apply Waiver')}
								</Button>
							</div>
						</div>
					)}
				</SheetContent>
			</Sheet>
		</div>
	)
}
