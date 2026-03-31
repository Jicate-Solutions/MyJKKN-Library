'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
	MonitorPlay, BookOpen, Database, Globe2,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import type { LibDigitalResource, LibDigitalResourceType } from '@/types/lib'

const RESOURCE_TYPES: LibDigitalResourceType[] = [
	'ebook', 'ejournal', 'database', 'open_access', 'inflibnet', 'institutional_repository', 'other',
]

const TYPE_COLORS: Record<LibDigitalResourceType, string> = {
	ebook: 'bg-blue-50 text-blue-700 border-blue-200',
	ejournal: 'bg-purple-50 text-purple-700 border-purple-200',
	database: 'bg-indigo-50 text-indigo-700 border-indigo-200',
	open_access: 'bg-green-50 text-green-700 border-green-200',
	inflibnet: 'bg-amber-50 text-amber-700 border-amber-200',
	institutional_repository: 'bg-teal-50 text-teal-700 border-teal-200',
	other: 'bg-gray-50 text-gray-600 border-gray-200',
}

interface FormData {
	resource_title: string
	resource_type: LibDigitalResourceType
	provider: string
	access_url: string
	coverage_years: string
	annual_cost: string
	concurrent_users: string
	subscription_start: string
	subscription_end: string
	is_active: boolean
	is_open_access: boolean
	naac_reportable: boolean
}

const defaultForm: FormData = {
	resource_title: '',
	resource_type: 'database',
	provider: '',
	access_url: '',
	coverage_years: '',
	annual_cost: '',
	concurrent_users: '',
	subscription_start: '',
	subscription_end: '',
	is_active: true,
	is_open_access: false,
	naac_reportable: true,
}

export default function DigitalResourcesPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [resources, setResources] = useState<LibDigitalResource[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [typeFilter, setTypeFilter] = useState<string>('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibDigitalResource | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibDigitalResource | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(12)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/digital')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setResources(data)
		} catch {
			toast({ title: 'Failed to load digital resources', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	const scorecardData = useMemo(() => ({
		total: resources.length,
		ebooks: resources.filter(r => r.resource_type === 'ebook' || r.resource_type === 'ejournal').length,
		databases: resources.filter(r => r.resource_type === 'database' || r.resource_type === 'inflibnet').length,
		openAccess: resources.filter(r => r.is_open_access).length,
	}), [resources])

	const filtered = useMemo(() => {
		return resources.filter(r => {
			const matchSearch = !search ||
				r.resource_title.toLowerCase().includes(search.toLowerCase()) ||
				(r.provider?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchType = typeFilter === 'all' || r.resource_type === typeFilter
			return matchSearch && matchType
		})
	}, [resources, search, typeFilter])

	const pageSizeOptions = useMemo(() => {
		const opts = [12, 24, 48]
		if (filtered.length > 48) opts.push(filtered.length)
		return opts
	}, [filtered.length])

	const effectivePerPage = itemsPerPage > filtered.length ? filtered.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? filtered.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: filtered

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.resource_title.trim()) e.resource_title = 'Title is required'
		if (!form.access_url.trim()) e.access_url = 'Access URL is required'
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
				annual_cost: form.annual_cost ? Number(form.annual_cost) : undefined,
				concurrent_users: form.concurrent_users ? Number(form.concurrent_users) : undefined,
				subscription_start: form.subscription_start || undefined,
				subscription_end: form.subscription_end || undefined,
				coverage_years: form.coverage_years || undefined,
			}
			const url = editingItem ? `/api/lib/digital/${editingItem.id}` : '/api/lib/digital'
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
				setResources(prev => prev.map(r => r.id === saved.id ? saved : r))
				toast({ title: '✅ Resource updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setResources(prev => [saved, ...prev])
				toast({ title: '✅ Resource created', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (r: LibDigitalResource) => {
		setEditingItem(r)
		setForm({
			resource_title: r.resource_title,
			resource_type: r.resource_type,
			provider: r.provider ?? '',
			access_url: r.access_url,
			coverage_years: r.coverage_years ?? '',
			annual_cost: r.annual_cost?.toString() ?? '',
			concurrent_users: r.concurrent_users?.toString() ?? '',
			subscription_start: r.subscription_start?.split('T')[0] ?? '',
			subscription_end: r.subscription_end?.split('T')[0] ?? '',
			is_active: r.is_active,
			is_open_access: r.is_open_access,
			naac_reportable: r.naac_reportable,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/digital/${deleteTarget.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Delete failed')
			setResources(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Resource deleted', className: 'bg-green-50 border-green-200 text-green-800' })
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Resources</p>
							</div>
							<MonitorPlay className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.ebooks}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">E-books / E-journals</p>
							</div>
							<BookOpen className="h-5 w-5 text-indigo-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-purple-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.databases}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Databases</p>
							</div>
							<Database className="h-5 w-5 text-purple-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.openAccess}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Open Access</p>
							</div>
							<Globe2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Toolbar */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-shrink-0">
					<CardHeader className="px-4 py-3 border-b">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Digital Resources</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} resource{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Resource</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Types</SelectItem>
									{RESOURCE_TYPES.map(t => (
										<SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search title or provider..."
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
				</Card>

				{/* Resource Card Grid */}
				<div className="flex-1 min-h-0">
					{loading ? (
						<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
							<RefreshCw className="h-6 w-6 animate-spin" />
							<span className="text-sm">Loading resources...</span>
						</div>
					) : paginated.length === 0 ? (
						<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
							<MonitorPlay className="h-10 w-10 opacity-20" />
							<span className="text-sm">No digital resources found</span>
							<span className="text-xs">Try adjusting your filters</span>
						</div>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
							{paginated.map(r => (
								<Card key={r.id} className={`hover:shadow-md transition-shadow ${!r.is_active ? 'opacity-60' : ''}`}>
									<CardContent className="p-4 space-y-3">
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1 min-w-0">
												<p className="font-semibold text-sm leading-tight line-clamp-2">{r.resource_title}</p>
												<p className="text-xs text-muted-foreground mt-0.5">{r.provider ?? 'Unknown provider'}</p>
											</div>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0 shrink-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem asChild>
														<a href={r.access_url} target="_blank" rel="noreferrer">
															<ExternalLink className="h-4 w-4 mr-2" />Open Resource
														</a>
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => handleEdit(r)}>
														<Edit className="h-4 w-4 mr-2" />Edit
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(r)}>
														<Trash2 className="h-4 w-4 mr-2" />Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>

										<Badge variant="outline" className={`text-xs capitalize w-fit ${TYPE_COLORS[r.resource_type]}`}>
											{r.resource_type.replace('_', ' ')}
										</Badge>

										{r.coverage_years && (
											<p className="text-xs text-muted-foreground">Coverage: {r.coverage_years}</p>
										)}

										<div className="flex items-center justify-between pt-1 border-t">
											<div className="flex gap-1 flex-wrap">
												{r.is_open_access && (
													<Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200 bg-emerald-50">Open Access</Badge>
												)}
												{r.naac_reportable && (
													<Badge variant="outline" className="text-[10px] text-purple-700 border-purple-200 bg-purple-50">NAAC</Badge>
												)}
												{!r.is_active && (
													<Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">Inactive</Badge>
												)}
											</div>
											<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
												<a href={r.access_url} target="_blank" rel="noreferrer" title="Open resource">
													<ExternalLink className="h-3.5 w-3.5 text-blue-500" />
												</a>
											</Button>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</div>

				{/* Pagination */}
				{filtered.length > 0 && (
					<Card className="flex-shrink-0">
						<CardContent className="px-4 py-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground hidden sm:inline">Items per page</span>
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
				)}
			</TooltipProvider>

			{/* Sheet Form */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Digital Resource' : 'Add Digital Resource'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update resource details below' : 'Register a new digital resource or database'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Resource Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resource Info</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Title <span className="text-red-500">*</span></Label>
								<Input
									value={form.resource_title}
									onChange={e => setForm(f => ({ ...f, resource_title: e.target.value }))}
									className={errors.resource_title ? 'border-red-500' : ''}
									placeholder="Resource title"
								/>
								{errors.resource_title && <p className="text-xs text-red-500">{errors.resource_title}</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Type</Label>
									<Select value={form.resource_type} onValueChange={v => setForm(f => ({ ...f, resource_type: v as LibDigitalResourceType }))}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{RESOURCE_TYPES.map(t => (
												<SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Provider</Label>
									<Input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="e.g. EBSCO, JSTOR, INFLIBNET" />
								</div>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Access URL <span className="text-red-500">*</span></Label>
								<Input
									type="url"
									value={form.access_url}
									onChange={e => setForm(f => ({ ...f, access_url: e.target.value }))}
									className={errors.access_url ? 'border-red-500' : ''}
									placeholder="https://..."
								/>
								{errors.access_url && <p className="text-xs text-red-500">{errors.access_url}</p>}
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Coverage Years</Label>
								<Input value={form.coverage_years} onChange={e => setForm(f => ({ ...f, coverage_years: e.target.value }))} placeholder="2000-present" />
							</div>
						</div>

						{/* Section: Subscription Details */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription Details</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Annual Cost (₹)</Label>
									<Input type="number" min="0" value={form.annual_cost} onChange={e => setForm(f => ({ ...f, annual_cost: e.target.value }))} placeholder="0.00" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Concurrent Users</Label>
									<Input type="number" min="1" value={form.concurrent_users} onChange={e => setForm(f => ({ ...f, concurrent_users: e.target.value }))} placeholder="e.g. 5" />
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Subscription Start</Label>
									<Input type="date" value={form.subscription_start} onChange={e => setForm(f => ({ ...f, subscription_start: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Subscription End</Label>
									<Input type="date" value={form.subscription_end} onChange={e => setForm(f => ({ ...f, subscription_end: e.target.value }))} />
								</div>
							</div>
							<div className="space-y-3">
								<div className="flex items-center gap-3">
									<Switch id="dig_active" checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
									<Label htmlFor="dig_active" className="text-sm">Active</Label>
								</div>
								<div className="flex items-center gap-3">
									<Switch id="dig_oa" checked={form.is_open_access} onCheckedChange={v => setForm(f => ({ ...f, is_open_access: v }))} />
									<Label htmlFor="dig_oa" className="text-sm">Open Access</Label>
								</div>
								<div className="flex items-center gap-3">
									<Switch id="dig_naac" checked={form.naac_reportable} onCheckedChange={v => setForm(f => ({ ...f, naac_reportable: v }))} />
									<Label htmlFor="dig_naac" className="text-sm">NAAC Reportable</Label>
								</div>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Resource' : 'Create Resource')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Digital Resource</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.resource_title}</strong>? This action cannot be undone.
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
