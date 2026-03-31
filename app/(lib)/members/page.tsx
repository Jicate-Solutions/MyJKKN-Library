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
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import { MemberProfileCell } from '@/components/library/member-profile-cell'
import { MyJKKNMemberSearch, type SelectedMember } from '@/components/library/myjkkn-member-search'
import { MyJKKNBrowseModal } from '@/components/library/myjkkn-browse-modal'
import {
	Users, UserCheck, UserX, UserPlus,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibMember, LibMemberCategory } from '@/types/lib'
import { useInstitution } from '@/context/institution-context'
import {
	fetchMembers,
	createMember,
	updateMember,
	deleteMember,
} from '@/services/library/lib-members-service'

const CATEGORIES: LibMemberCategory[] = ['learner', 'facilitator', 'team_member', 'guest', 'alumni']

interface FormData {
	member_number: string
	member_category: LibMemberCategory
	display_name: string
	email: string
	phone: string
	membership_start_date: string
	membership_end_date: string
	is_active: boolean
}

const defaultForm: FormData = {
	member_number: '',
	member_category: 'learner',
	display_name: '',
	email: '',
	phone: '',
	membership_start_date: new Date().toISOString().split('T')[0],
	membership_end_date: '',
	is_active: true,
}

export default function MembersPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [members, setMembers] = useState<LibMember[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<string>('all')
	const [activeFilter, setActiveFilter] = useState<string>('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibMember | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibMember | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)
	const [selectedMyjkknMember, setSelectedMyjkknMember] = useState<SelectedMember | null>(null)
	const [browseModalOpen, setBrowseModalOpen] = useState(false)
	const { currentMyJKKNInstitutionIds } = useInstitution()

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/members')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setMembers(data)
		} catch {
			toast({ title: 'Failed to load members', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	// Scorecards use institution-filtered data (no search/status filter)
	const scorecardData = useMemo(() => ({
		total: members.length,
		active: members.filter(m => m.is_active).length,
		inactive: members.filter(m => !m.is_active).length,
		delinquent: members.filter(m => m.is_delinquent).length,
	}), [members])

	// Table data = members + search + category + active filters
	const filtered = useMemo(() => {
		return members.filter(m => {
			const matchSearch = !search ||
				m.member_number.toLowerCase().includes(search.toLowerCase()) ||
				(m.display_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(m.email?.toLowerCase().includes(search.toLowerCase()) ?? false)
			const matchCat = categoryFilter === 'all' || m.member_category === categoryFilter
			const matchActive =
				activeFilter === 'all' ||
				(activeFilter === 'active' && m.is_active) ||
				(activeFilter === 'inactive' && !m.is_active)
			return matchSearch && matchCat && matchActive
		})
	}, [members, search, categoryFilter, activeFilter])

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
	const colCount = mustSelectInstitution ? 7 : 6

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
		setSelectedMyjkknMember(null)
	}

	const handleMyjkknSelect = (member: SelectedMember) => {
		setSelectedMyjkknMember(member)
		setForm(prev => ({
			...prev,
			display_name: member.display_name,
			email: member.email || '',
			phone: member.phone || '',
		}))
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		const isMyJKKNCategory = form.member_category === 'learner' || form.member_category === 'facilitator'

		if (isMyJKKNCategory && !editingItem && !selectedMyjkknMember) {
			e.myjkkn = `Please select a ${form.member_category === 'learner' ? 'learner' : 'learning facilitator'} from MyJKKN`
		}
		if (!isMyJKKNCategory && !form.display_name.trim()) {
			e.display_name = 'Name is required'
		}
		if (!form.membership_start_date) e.membership_start_date = 'Start date is required'
		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			const payload: Record<string, unknown> = {
				...form,
				institution_id: instId ?? '',
				membership_end_date: form.membership_end_date || undefined,
			}

			// Attach MyJKKN reference if selected
			if (selectedMyjkknMember) {
				if (form.member_category === 'learner') {
					payload.learner_id = selectedMyjkknMember.id
				} else if (form.member_category === 'facilitator') {
					payload.facilitator_id = selectedMyjkknMember.id
				}
			}

			if (editingItem) {
				const updated = await updateMember(editingItem.id, payload)
				setMembers(prev => prev.map(m => m.id === updated.id ? updated : m))
				toast({ title: '✅ Member updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				const created = await createMember(payload)
				setMembers(prev => [created, ...prev])
				toast({ title: '✅ Member enrolled', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (m: LibMember) => {
		setEditingItem(m)
		setForm({
			member_number: m.member_number,
			member_category: m.member_category,
			display_name: m.display_name ?? '',
			email: m.email ?? '',
			phone: m.phone ?? '',
			membership_start_date: m.membership_start_date.split('T')[0],
			membership_end_date: m.membership_end_date?.split('T')[0] ?? '',
			is_active: m.is_active,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			await deleteMember(deleteTarget.id)
			setMembers(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Member deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
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
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Members</p>
							</div>
							<Users className="h-5 w-5 text-blue-500/40" />
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
							<UserCheck className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.inactive}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Inactive</p>
							</div>
							<UserX className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.delinquent}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Delinquent</p>
							</div>
							<UserPlus className="h-5 w-5 text-rose-500/40" />
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
								<h2 className="text-base font-semibold">Knowledge Community Members</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Member</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						{/* Row 2: Filters */}
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Categories</SelectItem>
									{CATEGORIES.map(c => (
										<SelectItem key={c} value={c} className="capitalize">{c.replace('_', ' ')}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search name, number, email..."
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
											<TableHead className="text-xs font-semibold">Member #</TableHead>
											<TableHead className="text-xs font-semibold">Name</TableHead>
											<TableHead className="text-xs font-semibold">Category</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">Institution</TableHead>}
											<TableHead className="text-xs font-semibold">Email</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading members...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Users className="h-8 w-8 opacity-20" />
														<span className="text-sm">No members found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(m => (
											<TableRow key={m.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-mono font-medium">{m.member_number}</TableCell>
												<TableCell>
													<MemberProfileCell
														memberCategory={m.member_category}
														learnerId={m.learner_id}
														facilitatorId={m.facilitator_id}
														fallbackName={m.display_name}
													/>
												</TableCell>
												<TableCell><MemberCategoryBadge category={m.member_category} /></TableCell>
												{mustSelectInstitution && <TableCell className="text-sm">{m.institution_id?.slice(0, 8) ?? '—'}</TableCell>}
												<TableCell className="text-sm">{m.email ?? '—'}</TableCell>
												<TableCell>
													<Badge variant="outline" className={m.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}>
														{m.is_active ? 'Active' : 'Inactive'}
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
															<DropdownMenuItem onClick={() => handleEdit(m)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(m)}>
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
									<Users className="h-8 w-8 opacity-20" />
									<span className="text-sm">No members found</span>
								</div>
							) : paginated.map(m => (
								<div key={m.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">{m.display_name ?? m.member_number}</p>
											<p className="text-xs text-muted-foreground font-mono">{m.member_number}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleEdit(m)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(m)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<MemberCategoryBadge category={m.member_category} />
										<Badge variant="outline" className={m.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}>
											{m.is_active ? 'Active' : 'Inactive'}
										</Badge>
									</div>
									{m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
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
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Member' : 'Add Member'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update member details below' : 'Fill in the details to add a new Knowledge Community Member'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Identity */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Member Number</Label>
									<Input
										value={form.member_number}
										onChange={e => setForm(f => ({ ...f, member_number: e.target.value }))}
										className={errors.member_number ? 'border-red-500' : ''}
										placeholder="Auto-generated if blank"
									/>
									{errors.member_number && <p className="text-xs text-red-500">{errors.member_number}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Category</Label>
									<Select value={form.member_category} onValueChange={v => {
										setForm(f => ({ ...f, member_category: v as LibMemberCategory, display_name: '', email: '', phone: '' }))
										setSelectedMyjkknMember(null)
									}}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace('_', ' ')}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* MyJKKN search for learner/facilitator (new members only) */}
							{(form.member_category === 'learner' || form.member_category === 'facilitator') && !editingItem ? (
								<div className="space-y-2">
									<Label className="text-sm font-semibold">
										{form.member_category === 'learner' ? 'Select Learner' : 'Select Learning Facilitator'} <span className="text-red-500">*</span>
									</Label>
									<MyJKKNMemberSearch
										category={form.member_category}
										institutionId={institutionId ?? ''}
										myjkknInstitutionIds={currentMyJKKNInstitutionIds}
										onSelect={handleMyjkknSelect}
										onBrowseAll={() => setBrowseModalOpen(true)}
										selectedMember={selectedMyjkknMember}
										onClear={() => {
											setSelectedMyjkknMember(null)
											setForm(prev => ({ ...prev, display_name: '', email: '', phone: '' }))
										}}
									/>
									{errors.myjkkn && <p className="text-xs text-red-500">{errors.myjkkn}</p>}
								</div>
							) : (
								<>
									<div className="space-y-2">
										<Label className="text-sm font-semibold">Full Name <span className="text-red-500">*</span></Label>
										<Input
											value={form.display_name}
											onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
											className={errors.display_name ? 'border-red-500' : ''}
											placeholder="Full name"
										/>
										{errors.display_name && <p className="text-xs text-red-500">{errors.display_name}</p>}
									</div>
								</>
							)}
						</div>

						{/* Section: Contact — show for manual categories or editing, or after MyJKKN selection */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Email</Label>
									<Input
										type="email"
										value={form.email}
										onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
										placeholder="email@example.com"
										readOnly={!!selectedMyjkknMember}
										className={selectedMyjkknMember ? 'bg-muted' : ''}
									/>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Phone</Label>
									<Input
										value={form.phone}
										onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
										placeholder="+91 00000 00000"
										readOnly={!!selectedMyjkknMember}
										className={selectedMyjkknMember ? 'bg-muted' : ''}
									/>
								</div>
							</div>
						</div>

						{/* Section: Membership */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Membership</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Start Date <span className="text-red-500">*</span></Label>
									<Input
										type="date"
										value={form.membership_start_date}
										onChange={e => setForm(f => ({ ...f, membership_start_date: e.target.value }))}
										className={errors.membership_start_date ? 'border-red-500' : ''}
									/>
									{errors.membership_start_date && <p className="text-xs text-red-500">{errors.membership_start_date}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">End Date</Label>
									<Input type="date" value={form.membership_end_date} onChange={e => setForm(f => ({ ...f, membership_end_date: e.target.value }))} />
								</div>
							</div>
							<div className="flex items-center gap-3">
								<Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
								<Label className="text-sm">Active member</Label>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Member' : 'Create Member')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Standalone Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Member</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.display_name ?? deleteTarget?.member_number}</strong>? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Browse All Modal */}
			{(form.member_category === 'learner' || form.member_category === 'facilitator') && (
				<MyJKKNBrowseModal
					open={browseModalOpen}
					onOpenChange={setBrowseModalOpen}
					category={form.member_category}
					myjkknInstitutionIds={currentMyJKKNInstitutionIds}
					onSelect={handleMyjkknSelect}
				/>
			)}
		</div>
	)
}
