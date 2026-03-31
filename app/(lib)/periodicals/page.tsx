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
	Newspaper, CheckCircle2, AlertCircle, Gift,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import type { LibPeriodicalSubscription, LibSubscriptionStatus } from '@/types/lib'

const STATUS_COLORS: Record<LibSubscriptionStatus, string> = {
	active: 'bg-green-50 text-green-700 border-green-200',
	expired: 'bg-red-50 text-red-700 border-red-200',
	cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
	gratis: 'bg-blue-50 text-blue-700 border-blue-200',
	suspended: 'bg-amber-50 text-amber-700 border-amber-200',
}

const STATUSES: LibSubscriptionStatus[] = ['active', 'expired', 'cancelled', 'gratis', 'suspended']
const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'bi-monthly', 'quarterly', 'semi-annual', 'annual'] as const

interface FormData {
	catalogue_record_id: string
	supplier_id: string
	subscription_number: string
	subscription_type: string
	frequency: string
	fiscal_year: string
	start_date: string
	end_date: string
	subscription_cost: string
	expected_issues: string
	access_url: string
	is_gratis: boolean
}

const defaultForm: FormData = {
	catalogue_record_id: '',
	supplier_id: '',
	subscription_number: '',
	subscription_type: 'print',
	frequency: 'monthly',
	fiscal_year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
	start_date: '',
	end_date: '',
	subscription_cost: '',
	expected_issues: '',
	access_url: '',
	is_gratis: false,
}

export default function PeriodicalSubscriptionsPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [subscriptions, setSubscriptions] = useState<LibPeriodicalSubscription[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibPeriodicalSubscription | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibPeriodicalSubscription | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/periodicals')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setSubscriptions(data)
		} catch {
			toast({ title: 'Failed to load subscriptions', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: subscriptions.length,
		active: subscriptions.filter(s => s.subscription_status === 'active').length,
		expired: subscriptions.filter(s => s.subscription_status === 'expired').length,
		gratis: subscriptions.filter(s => s.is_gratis).length,
	}), [subscriptions])

	const filtered = useMemo(() => {
		return subscriptions.filter(s => {
			const matchSearch = !search ||
				(s.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(s.subscription_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				s.fiscal_year.includes(search)
			const matchStatus = statusFilter === 'all' || s.subscription_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [subscriptions, search, statusFilter])

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
		if (!form.fiscal_year.trim()) e.fiscal_year = 'Fiscal year is required'
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
				subscription_cost: form.subscription_cost ? Number(form.subscription_cost) : undefined,
				expected_issues: form.expected_issues ? Number(form.expected_issues) : undefined,
				start_date: form.start_date || undefined,
				end_date: form.end_date || undefined,
				access_url: form.access_url || undefined,
			}
			const url = editingItem ? `/api/lib/periodicals/subscriptions/${editingItem.id}` : '/api/lib/periodicals'
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
				setSubscriptions(prev => prev.map(s => s.id === saved.id ? saved : s))
				toast({ title: '✅ Subscription updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setSubscriptions(prev => [saved, ...prev])
				toast({ title: '✅ Subscription created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (s: LibPeriodicalSubscription) => {
		setEditingItem(s)
		setForm({
			catalogue_record_id: s.catalogue_record_id,
			supplier_id: s.supplier_id ?? '',
			subscription_number: s.subscription_number ?? '',
			subscription_type: s.subscription_type ?? 'print',
			frequency: s.frequency ?? 'monthly',
			fiscal_year: s.fiscal_year,
			start_date: s.start_date?.split('T')[0] ?? '',
			end_date: s.end_date?.split('T')[0] ?? '',
			subscription_cost: s.subscription_cost?.toString() ?? '',
			expected_issues: s.expected_issues?.toString() ?? '',
			access_url: s.access_url ?? '',
			is_gratis: s.is_gratis,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/periodicals/subscriptions/${deleteTarget.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Delete failed')
			setSubscriptions(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Subscription deleted', className: 'bg-green-50 border-green-200 text-green-800' })
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Subscriptions</p>
							</div>
							<Newspaper className="h-5 w-5 text-blue-500/40" />
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
								<p className="text-2xl font-bold tracking-tight">{scorecardData.expired}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Expired</p>
							</div>
							<AlertCircle className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-sky-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.gratis}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Gratis</p>
							</div>
							<Gift className="h-5 w-5 text-sky-500/40" />
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
								<h2 className="text-base font-semibold">Periodical Subscriptions</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} subscription{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Subscription</span>
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
									placeholder="Search title or subscription #..."
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
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Supplier</TableHead>
											<TableHead className="text-xs font-semibold">Frequency</TableHead>
											<TableHead className="text-xs font-semibold">Fiscal Year</TableHead>
											<TableHead className="text-xs font-semibold">Issues (Rcvd/Exp)</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">Institution</TableHead>}
											<TableHead className="text-xs font-semibold w-10">Detail</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading subscriptions...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Newspaper className="h-8 w-8 opacity-20" />
														<span className="text-sm">No subscriptions found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(s => (
											<TableRow key={s.id} className="hover:bg-muted/50">
												<TableCell className="max-w-[200px]">
													<div className="truncate text-sm font-medium">
														{s.catalogue_record?.title ?? s.catalogue_record_id}
													</div>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">{s.supplier?.supplier_name ?? '—'}</TableCell>
												<TableCell className="text-sm capitalize">{s.frequency ?? '—'}</TableCell>
												<TableCell className="text-sm">{s.fiscal_year}</TableCell>
												<TableCell>
													<span className="text-emerald-600 font-medium">{s.received_issues}</span>
													<span className="text-muted-foreground">/{s.expected_issues ?? '?'}</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[s.subscription_status]}`}>
														{s.subscription_status}
													</Badge>
												</TableCell>
												{mustSelectInstitution && (
													<TableCell className="text-xs text-muted-foreground">{s.institution_id?.slice(0, 8) ?? '—'}</TableCell>
												)}
												<TableCell>
													<Button variant="ghost" size="icon" className="h-7 w-7 p-0" asChild>
														<Link href={`/periodicals/${s.id}`}>
															<ExternalLink className="h-3.5 w-3.5 text-blue-500" />
														</Link>
													</Button>
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
									<Newspaper className="h-8 w-8 opacity-20" />
									<span className="text-sm">No subscriptions found</span>
								</div>
							) : paginated.map(s => (
								<div key={s.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div className="flex-1 min-w-0">
											<p className="font-medium text-sm truncate">{s.catalogue_record?.title ?? s.catalogue_record_id}</p>
											<p className="text-xs text-muted-foreground">{s.supplier?.supplier_name ?? '—'} · {s.fiscal_year}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem asChild>
													<Link href={`/periodicals/${s.id}`}><ExternalLink className="h-4 w-4 mr-2" />View Detail</Link>
												</DropdownMenuItem>
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
										<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[s.subscription_status]}`}>{s.subscription_status}</Badge>
										<span className="text-xs text-muted-foreground capitalize">{s.frequency ?? '—'}</span>
									</div>
									<p className="text-xs text-muted-foreground">
										Issues: <span className="text-emerald-600 font-medium">{s.received_issues}</span>/{s.expected_issues ?? '?'}
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
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Subscription' : 'Add Subscription'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update subscription details below' : 'Register a new periodical subscription'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Subscription Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription Info</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Subscription Number</Label>
									<Input value={form.subscription_number} onChange={e => setForm(f => ({ ...f, subscription_number: e.target.value }))} placeholder="SUB-2025-001" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Fiscal Year <span className="text-red-500">*</span></Label>
									<Input
										value={form.fiscal_year}
										onChange={e => setForm(f => ({ ...f, fiscal_year: e.target.value }))}
										className={errors.fiscal_year ? 'border-red-500' : ''}
										placeholder="2025-26"
									/>
									{errors.fiscal_year && <p className="text-xs text-red-500">{errors.fiscal_year}</p>}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Type</Label>
									<Select value={form.subscription_type} onValueChange={v => setForm(f => ({ ...f, subscription_type: v }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="print">Print</SelectItem>
											<SelectItem value="online">Online</SelectItem>
											<SelectItem value="both">Both</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Frequency</Label>
									<Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{FREQUENCIES.map(freq => <SelectItem key={freq} value={freq} className="capitalize">{freq}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Start Date</Label>
									<Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">End Date</Label>
									<Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
								</div>
							</div>
						</div>

						{/* Section: Cost & Issues */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cost and Issues</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Subscription Cost (₹)</Label>
									<Input type="number" min="0" value={form.subscription_cost} onChange={e => setForm(f => ({ ...f, subscription_cost: e.target.value }))} placeholder="0.00" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Expected Issues</Label>
									<Input type="number" min="1" value={form.expected_issues} onChange={e => setForm(f => ({ ...f, expected_issues: e.target.value }))} placeholder="12" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Access URL</Label>
								<Input type="url" value={form.access_url} onChange={e => setForm(f => ({ ...f, access_url: e.target.value }))} placeholder="https://..." />
							</div>
							<div className="flex items-center gap-3">
								<Switch
									id="is_gratis"
									checked={form.is_gratis}
									onCheckedChange={v => setForm(f => ({ ...f, is_gratis: v }))}
								/>
								<Label htmlFor="is_gratis" className="text-sm">Gratis (complimentary / no charge)</Label>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Subscription' : 'Create Subscription')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Subscription</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the subscription for <strong>{deleteTarget?.catalogue_record?.title ?? deleteTarget?.catalogue_record_id}</strong>? This action cannot be undone.
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
