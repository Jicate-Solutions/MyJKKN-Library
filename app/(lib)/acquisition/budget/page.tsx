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
import { Progress } from '@/components/ui/progress'
import {
	Wallet, PiggyBank, TrendingDown, BadgeCheck,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibBudgetHead } from '@/types/lib'

const RESOURCE_TYPES = ['books', 'periodicals', 'digital', 'binding', 'equipment', 'other'] as const

interface FormData {
	budget_head_code: string
	budget_head_name: string
	fiscal_year: string
	resource_type: string
	allocated_amount: string
	is_active: boolean
}

const defaultForm: FormData = {
	budget_head_code: '',
	budget_head_name: '',
	fiscal_year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
	resource_type: 'books',
	allocated_amount: '',
	is_active: true,
}

export default function BudgetPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [budgets, setBudgets] = useState<LibBudgetHead[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibBudgetHead | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibBudgetHead | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/acquisition/budget')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setBudgets(data)
		} catch {
			toast({ title: 'Failed to load budget heads', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => {
		const allocated = budgets.reduce((s, b) => s + b.allocated_amount, 0)
		const spent = budgets.reduce((s, b) => s + b.spent_amount, 0)
		const committed = budgets.reduce((s, b) => s + b.committed_amount, 0)
		return {
			total: budgets.length,
			allocated,
			spent,
			available: allocated - spent - committed,
		}
	}, [budgets])

	const filtered = useMemo(() => {
		return budgets.filter(b =>
			!search ||
			b.budget_head_name.toLowerCase().includes(search.toLowerCase()) ||
			b.budget_head_code.toLowerCase().includes(search.toLowerCase()) ||
			b.fiscal_year.includes(search)
		)
	}, [budgets, search])

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
		if (!form.budget_head_code.trim()) e.budget_head_code = 'Code is required'
		if (!form.budget_head_name.trim()) e.budget_head_name = 'Name is required'
		if (!form.allocated_amount || Number(form.allocated_amount) <= 0) e.allocated_amount = 'Enter a valid amount'
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
				allocated_amount: Number(form.allocated_amount),
			}
			const url = editingItem ? `/api/lib/acquisition/budget/${editingItem.id}` : '/api/lib/acquisition/budget'
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
				setBudgets(prev => prev.map(b => b.id === saved.id ? saved : b))
				toast({ title: '✅ Budget head updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setBudgets(prev => [saved, ...prev])
				toast({ title: '✅ Budget head created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (b: LibBudgetHead) => {
		setEditingItem(b)
		setForm({
			budget_head_code: b.budget_head_code,
			budget_head_name: b.budget_head_name,
			fiscal_year: b.fiscal_year,
			resource_type: b.resource_type ?? 'books',
			allocated_amount: String(b.allocated_amount),
			is_active: b.is_active,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/acquisition/budget/${deleteTarget.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Delete failed')
			setBudgets(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Budget head deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Budget Heads</p>
							</div>
							<Wallet className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-lg font-bold tracking-tight">{fmt(scorecardData.allocated)}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Allocated</p>
							</div>
							<PiggyBank className="h-5 w-5 text-indigo-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-lg font-bold tracking-tight">{fmt(scorecardData.spent)}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Spent</p>
							</div>
							<TrendingDown className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className={`text-lg font-bold tracking-tight ${scorecardData.available < 0 ? 'text-red-600' : ''}`}>{fmt(scorecardData.available)}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Available</p>
							</div>
							<BadgeCheck className="h-5 w-5 text-emerald-500/40" />
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
								<h2 className="text-base font-semibold">Budget Heads</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} head{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Budget Head</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search code, name, fiscal year..."
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
											<TableHead className="text-xs font-semibold">Type</TableHead>
											<TableHead className="text-xs font-semibold">Allocated</TableHead>
											<TableHead className="text-xs font-semibold">Spent</TableHead>
											<TableHead className="text-xs font-semibold">Committed</TableHead>
											<TableHead className="text-xs font-semibold min-w-[140px]">Utilisation</TableHead>
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
														<span className="text-sm">Loading budgets...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Wallet className="h-8 w-8 opacity-20" />
														<span className="text-sm">No budget heads found</span>
														<span className="text-xs">Try adjusting your search</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(b => {
											const utilPct = b.allocated_amount > 0
												? Math.min(100, Math.round((b.spent_amount / b.allocated_amount) * 100))
												: 0
											const available = b.allocated_amount - b.spent_amount - b.committed_amount
											return (
												<TableRow key={b.id} className="hover:bg-muted/50">
													<TableCell className="text-xs font-mono font-medium">{b.budget_head_code}</TableCell>
													<TableCell className="text-sm font-medium">{b.budget_head_name}</TableCell>
													<TableCell>
														<Badge variant="outline" className="text-xs capitalize">
															{b.resource_type ?? '—'}
														</Badge>
													</TableCell>
													<TableCell className="text-sm font-medium">{fmt(b.allocated_amount)}</TableCell>
													<TableCell className="text-sm text-rose-600">{fmt(b.spent_amount)}</TableCell>
													<TableCell className="text-sm text-amber-600">{fmt(b.committed_amount)}</TableCell>
													<TableCell>
														<div className="flex items-center gap-2">
															<Progress
																value={utilPct}
																className={`flex-1 h-2 ${utilPct > 90 ? '[&>div]:bg-red-500' : utilPct > 70 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`}
															/>
															<span className={`text-xs font-medium min-w-[36px] tabular-nums ${utilPct > 90 ? 'text-red-600' : utilPct > 70 ? 'text-amber-600' : 'text-emerald-600'}`}>
																{utilPct}%
															</span>
														</div>
													</TableCell>
													{mustSelectInstitution && (
														<TableCell className="text-xs text-muted-foreground">{b.institution_id?.slice(0, 8) ?? '—'}</TableCell>
													)}
													<TableCell>
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button variant="ghost" className="h-7 w-7 p-0">
																	<MoreHorizontal className="h-4 w-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem onClick={() => handleEdit(b)}>
																	<Edit className="h-4 w-4 mr-2" />Edit
																</DropdownMenuItem>
																<DropdownMenuSeparator />
																<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(b)}>
																	<Trash2 className="h-4 w-4 mr-2" />Delete
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
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
									<Wallet className="h-8 w-8 opacity-20" />
									<span className="text-sm">No budget heads found</span>
								</div>
							) : paginated.map(b => {
								const utilPct = b.allocated_amount > 0
									? Math.min(100, Math.round((b.spent_amount / b.allocated_amount) * 100))
									: 0
								return (
									<div key={b.id} className="rounded-lg border p-4 space-y-3">
										<div className="flex items-start justify-between">
											<div>
												<p className="font-medium text-sm">{b.budget_head_name}</p>
												<p className="text-xs text-muted-foreground font-mono">{b.budget_head_code} · {b.fiscal_year}</p>
											</div>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => handleEdit(b)}>
														<Edit className="h-4 w-4 mr-2" />Edit
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(b)}>
														<Trash2 className="h-4 w-4 mr-2" />Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
										<div className="flex items-center gap-2">
											<Progress value={utilPct} className="flex-1 h-2" />
											<span className="text-xs font-medium tabular-nums">{utilPct}%</span>
										</div>
										<div className="grid grid-cols-3 gap-2 text-xs">
											<div><p className="text-muted-foreground">Allocated</p><p className="font-medium">{fmt(b.allocated_amount)}</p></div>
											<div><p className="text-muted-foreground">Spent</p><p className="font-medium text-rose-600">{fmt(b.spent_amount)}</p></div>
											<div><p className="text-muted-foreground">Available</p><p className={`font-medium ${(b.allocated_amount - b.spent_amount - b.committed_amount) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(b.allocated_amount - b.spent_amount - b.committed_amount)}</p></div>
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

			{/* Sheet Form */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Budget Head' : 'Add Budget Head'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update budget head details below' : 'Define a new budget allocation head'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Budget Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Budget Info</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Code <span className="text-red-500">*</span></Label>
									<Input
										value={form.budget_head_code}
										onChange={e => setForm(f => ({ ...f, budget_head_code: e.target.value }))}
										className={errors.budget_head_code ? 'border-red-500' : ''}
										placeholder="BH-BOOKS"
									/>
									{errors.budget_head_code && <p className="text-xs text-red-500">{errors.budget_head_code}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Fiscal Year</Label>
									<Input value={form.fiscal_year} onChange={e => setForm(f => ({ ...f, fiscal_year: e.target.value }))} placeholder="2025-26" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Name <span className="text-red-500">*</span></Label>
								<Input
									value={form.budget_head_name}
									onChange={e => setForm(f => ({ ...f, budget_head_name: e.target.value }))}
									className={errors.budget_head_name ? 'border-red-500' : ''}
									placeholder="Books & Monographs Budget"
								/>
								{errors.budget_head_name && <p className="text-xs text-red-500">{errors.budget_head_name}</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Resource Type</Label>
									<Select value={form.resource_type} onValueChange={v => setForm(f => ({ ...f, resource_type: v }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{RESOURCE_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Allocated Amount (₹) <span className="text-red-500">*</span></Label>
									<Input
										type="number"
										min="0"
										value={form.allocated_amount}
										onChange={e => setForm(f => ({ ...f, allocated_amount: e.target.value }))}
										className={errors.allocated_amount ? 'border-red-500' : ''}
										placeholder="500000"
									/>
									{errors.allocated_amount && <p className="text-xs text-red-500">{errors.allocated_amount}</p>}
								</div>
							</div>
							<div className="flex items-center gap-3">
								<Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
								<Label className="text-sm">Active</Label>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Budget Head' : 'Create Budget Head')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Budget Head</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.budget_head_name}</strong>? This action cannot be undone.
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
