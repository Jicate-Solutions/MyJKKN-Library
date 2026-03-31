'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
	AlertTriangle, Clock, Timer, AlarmClock,
	Search, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { fetchOverdue } from '@/services/library/lib-circulation-service'
import type { LibLendingTransaction } from '@/types/lib'

function getDaysOverdue(dueDate: string): number {
	const due = new Date(dueDate)
	const now = new Date()
	if (now <= due) return 0
	return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
}

function getOverdueBucket(days: number): '1-7' | '8-30' | '30+' {
	if (days <= 7) return '1-7'
	if (days <= 30) return '8-30'
	return '30+'
}

export default function OverduePage() {
	const { isReady, institutionId, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [transactions, setTransactions] = useState<LibLendingTransaction[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [bucketFilter, setBucketFilter] = useState<string>('all')
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			const data = await fetchOverdue(institutionId)
			setTransactions(data)
		} catch {
			toast({ title: 'Failed to load overdue items', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: transactions.length,
		bucket1to7: transactions.filter(t => { const d = getDaysOverdue(t.due_date); return d >= 1 && d <= 7 }).length,
		bucket8to30: transactions.filter(t => { const d = getDaysOverdue(t.due_date); return d >= 8 && d <= 30 }).length,
		bucket30plus: transactions.filter(t => getDaysOverdue(t.due_date) > 30).length,
	}), [transactions])

	const filtered = useMemo(() => {
		return transactions.filter(t => {
			const matchSearch = !search ||
				(t.member?.display_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(t.member?.member_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(t.item?.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const days = getDaysOverdue(t.due_date)
			const matchBucket =
				bucketFilter === 'all' ||
				(bucketFilter === '1-7' && days >= 1 && days <= 7) ||
				(bucketFilter === '8-30' && days >= 8 && days <= 30) ||
				(bucketFilter === '30+' && days > 30)
			return matchSearch && matchBucket
		})
	}, [transactions, search, bucketFilter])

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

	const totalCharge = filtered.reduce((sum, t) => sum + (t.late_charge_amount ?? 0), 0)

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Overdue</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.bucket1to7}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">1–7 Days</p>
							</div>
							<Clock className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-orange-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.bucket8to30}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">8–30 Days</p>
							</div>
							<Timer className="h-5 w-5 text-orange-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-red-600 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.bucket30plus}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">30+ Days</p>
							</div>
							<AlarmClock className="h-5 w-5 text-red-600/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Warning banner */}
			{transactions.length > 0 && (
				<div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700 flex-shrink-0">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					<span>
						{transactions.length} item{transactions.length !== 1 ? 's are' : ' is'} overdue.
						Total estimated charges: <strong>₹{totalCharge.toFixed(2)}</strong>
					</span>
				</div>
			)}

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						{/* Row 1: Title + Actions */}
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Overdue Items</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</p>
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
							<Select value={bucketFilter} onValueChange={v => { setBucketFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Overdue range" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Ranges</SelectItem>
									<SelectItem value="1-7">1–7 Days</SelectItem>
									<SelectItem value="8-30">8–30 Days</SelectItem>
									<SelectItem value="30+">30+ Days</SelectItem>
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
											<TableHead className="text-xs font-semibold">Due Date</TableHead>
											<TableHead className="text-xs font-semibold">Days Overdue</TableHead>
											<TableHead className="text-xs font-semibold">Est. Charge</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={5} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading overdue items...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={5} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<AlertTriangle className="h-8 w-8 opacity-20" />
														<span className="text-sm">No overdue items found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(t => {
											const days = getDaysOverdue(t.due_date)
											const bucket = getOverdueBucket(days)
											const badgeClass =
												bucket === '30+' ? 'bg-red-50 text-red-700 border-red-300' :
													bucket === '8-30' ? 'bg-orange-50 text-orange-700 border-orange-200' :
														'bg-amber-50 text-amber-700 border-amber-200'
											return (
												<TableRow key={t.id} className="hover:bg-muted/50">
													<TableCell>
														<div className="text-sm font-medium">{t.member?.display_name ?? t.member_id}</div>
														<div className="text-xs text-muted-foreground">{t.member?.member_number}</div>
													</TableCell>
													<TableCell className="max-w-[200px]">
														<div className="truncate text-sm">{t.item?.catalogue_record?.title ?? t.item_id}</div>
														<div className="text-xs text-muted-foreground">{t.item?.accession_number}</div>
													</TableCell>
													<TableCell className="text-sm text-red-600 font-medium">
														{new Date(t.due_date).toLocaleDateString('en-IN')}
													</TableCell>
													<TableCell>
														<Badge variant="outline" className={`text-xs ${badgeClass}`}>
															{days} {days === 1 ? 'day' : 'days'}
														</Badge>
													</TableCell>
													<TableCell className="text-sm font-medium">
														₹{(t.late_charge_amount ?? 0).toFixed(2)}
													</TableCell>
												</TableRow>
											)
										})}
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
									<AlertTriangle className="h-8 w-8 opacity-20" />
									<span className="text-sm">No overdue items found</span>
								</div>
							) : paginated.map(t => {
								const days = getDaysOverdue(t.due_date)
								const bucket = getOverdueBucket(days)
								const cardBorderClass =
									bucket === '30+' ? 'border-red-300' :
										bucket === '8-30' ? 'border-orange-200' :
											'border-amber-200'
								const badgeClass =
									bucket === '30+' ? 'bg-red-50 text-red-700 border-red-300' :
										bucket === '8-30' ? 'bg-orange-50 text-orange-700 border-orange-200' :
											'bg-amber-50 text-amber-700 border-amber-200'
								return (
									<div key={t.id} className={`rounded-lg border p-4 space-y-2 ${cardBorderClass}`}>
										<div className="flex items-start justify-between gap-2">
											<div>
												<p className="font-medium text-sm">{t.member?.display_name ?? t.member_id}</p>
												<p className="text-xs text-muted-foreground">{t.member?.member_number}</p>
											</div>
											<Badge variant="outline" className={`text-xs shrink-0 ${badgeClass}`}>
												{days}d overdue
											</Badge>
										</div>
										<p className="text-sm truncate">{t.item?.catalogue_record?.title ?? t.item_id}</p>
										<div className="flex items-center justify-between text-xs">
											<span className="text-red-600 font-medium">Due: {new Date(t.due_date).toLocaleDateString('en-IN')}</span>
											<span className="font-medium">₹{(t.late_charge_amount ?? 0).toFixed(2)}</span>
										</div>
									</div>
								)
							})}
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
		</div>
	)
}
