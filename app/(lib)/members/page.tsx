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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { MemberBulkEnrol } from '@/components/library/member-bulk-enrol'
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

/**
 * The three kinds of member a library enrols.
 *
 * Learner and Facilitator are people MyJKKN already knows, so they are picked
 * rather than typed. Other is everyone else the library lends to — a research
 * scholar, a visiting doctor, a retired teacher — and the librarian writes what
 * to call them, because no fixed list would ever cover all seven campuses.
 */
const CATEGORIES: { value: LibMemberCategory; label: string }[] = [
	{ value: 'learner', label: 'Learner' },
	{ value: 'facilitator', label: 'Facilitator' },
	{ value: 'other', label: 'Other' },
]

/** A date coming back from MyJKKN may carry a time; the form wants only the day. */
const dayOnly = (value: unknown): string => {
	const text = (value ?? '').toString().trim()
	return text ? text.split('T')[0] : ''
}

/** dd-mm-yyyy, the way the register reads dates. */
const readableDay = (value: string): string => {
	const [year, month, day] = value.split('-')
	return year && month && day ? `${day}-${month}-${year}` : value
}

/**
 * A batch of this college, as MyJKKN keeps it.
 *
 * Membership dates come from here and nowhere else: a learner belongs to the
 * library for as long as their batch runs. Many MyJKKN profiles have no batch
 * recorded against them, which is why the batch can also be chosen by hand —
 * chosen, never guessed, because a Pharm D learner given a B.Pharm batch's
 * dates would quietly hold a membership that ends two years early.
 */
interface BatchOption {
	id: string
	label: string
	start: string
	end: string
}

interface FormData {
	member_number: string
	member_category: LibMemberCategory
	/** Only for "Other" — what this member is called */
	category_label: string
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
	category_label: '',
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
	// Which half of the Add Member sheet is showing: one member, or a program
	const [addTab, setAddTab] = useState<'individual' | 'bulk'>('individual')
	// Where the membership dates came from, so the librarian can see they were
	// filled from the learner's batch and not typed by somebody
	const [batchNote, setBatchNote] = useState<string | null>(null)
	const [batchLoading, setBatchLoading] = useState(false)
	// This college's batches, for the learners MyJKKN has not filed under one
	const [collegeBatches, setCollegeBatches] = useState<BatchOption[]>([])
	const [chosenBatchId, setChosenBatchId] = useState<string>('')
	const [batchMissing, setBatchMissing] = useState(false)
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

	// This college's batches, read once the first time a learner is being added.
	// MyJKKN returns every campus's batches whatever is asked of it, so they are
	// filtered here — another college's batch must never appear in this list.
	useEffect(() => {
		if (!sheetOpen || editingItem || collegeBatches.length > 0) return
		if (currentMyJKKNInstitutionIds.length === 0) return

		let cancelled = false
		const loadBatches = async () => {
			try {
				const res = await fetch('/api/myjkkn/batches?limit=200')
				if (!res.ok) return
				const json = await res.json()
				const rows: Record<string, any>[] = json.data || json || []
				const mine = rows
					.filter(b => currentMyJKKNInstitutionIds.includes(b.institution_id) && b.start_date)
					.map(b => ({
						id: b.id as string,
						label: [b.batch_code, b.batch_year || b.batch_name].filter(Boolean).join(' · '),
						start: dayOnly(b.start_date),
						end: dayOnly(b.end_date),
					}))
					// Newest first — a librarian enrolling today wants this year's batch
					.sort((a, b) => b.start.localeCompare(a.start))
				if (!cancelled) setCollegeBatches(mine)
			} catch {
				// The form still works: the dates can be typed
			}
		}
		loadBatches()
		return () => { cancelled = true }
	}, [sheetOpen, editingItem, collegeBatches.length, currentMyJKKNInstitutionIds])

	// MyJKKN ids already enrolled here — one person may hold only one membership,
	// so the search lists them but blocks re-selection
	const existingMemberIds = useMemo(() => {
		const ids = new Set<string>()
		for (const m of members) {
			if (m.learner_id) ids.add(m.learner_id)
			if (m.facilitator_id) ids.add(m.facilitator_id)
			if (m.team_member_id) ids.add(m.team_member_id)
		}
		return ids
	}, [members])

	// A learner's member number is their roll number, so show it before saving
	// rather than making the librarian save first to find out what it will be.
	const pendingRollNumber = useMemo(() => {
		if (form.member_category !== 'learner' || !selectedMyjkknMember) return null
		return selectedMyjkknMember.roll_number ?? null
	}, [form.member_category, selectedMyjkknMember])

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
		setBatchNote(null)
		setBatchMissing(false)
		setChosenBatchId('')
		setAddTab('individual')
	}

	const handleMyjkknSelect = async (member: SelectedMember) => {
		setSelectedMyjkknMember(member)
		setForm(prev => ({
			...prev,
			display_name: member.display_name,
			email: member.email || '',
			phone: member.phone || '',
		}))
		setBatchNote(null)
		setBatchMissing(false)
		setChosenBatchId('')

		// A learner's membership should run for as long as their course does, so
		// the dates come from their batch rather than from whoever is at the desk.
		// Facilitators have no batch — their dates stay as typed.
		if (member.category !== 'learner') return

		// Plenty of MyJKKN profiles have no batch recorded. Rather than leaving
		// the dates silently empty, the form says so and offers this college's
		// batches to pick from — the dates still come from a real batch.
		if (!member.batch_id) {
			setBatchMissing(true)
			return
		}

		try {
			setBatchLoading(true)
			const res = await fetch(`/api/myjkkn/batches/${member.batch_id}`)
			if (!res.ok) { setBatchMissing(true); return }
			const batch = await res.json()
			const start = dayOnly(batch?.start_date)
			const end = dayOnly(batch?.end_date)
			if (!start && !end) { setBatchMissing(true); return }

			setForm(prev => ({
				...prev,
				membership_start_date: start || prev.membership_start_date,
				membership_end_date: end || prev.membership_end_date,
			}))
			setErrors(prev => {
				const { membership_start_date: _s, membership_end_date: _e, ...rest } = prev
				return rest
			})
			setChosenBatchId(member.batch_id)
			const batchName = [batch?.batch_code, batch?.batch_year].filter(Boolean).join(' · ')
			setBatchNote(batchName ? `Filled from batch ${batchName}` : 'Filled from the learner\'s batch')
		} catch {
			setBatchMissing(true)
		} finally {
			setBatchLoading(false)
		}
	}

	/** Dates from a batch the librarian picked, when MyJKKN did not name one. */
	const applyBatch = (batchId: string) => {
		const batch = collegeBatches.find(b => b.id === batchId)
		setChosenBatchId(batchId)
		if (!batch) return

		setForm(prev => ({
			...prev,
			membership_start_date: batch.start || prev.membership_start_date,
			membership_end_date: batch.end || prev.membership_end_date,
		}))
		setErrors(prev => {
			const { membership_start_date: _s, membership_end_date: _e, ...rest } = prev
			return rest
		})
		setBatchNote(`Filled from batch ${batch.label}`)
		setBatchMissing(false)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		const isMyJKKNCategory = form.member_category === 'learner' || form.member_category === 'facilitator'

		if (isMyJKKNCategory && !editingItem && !selectedMyjkknMember) {
			e.myjkkn = `Please select a ${form.member_category === 'learner' ? 'learner' : 'learning facilitator'} from MyJKKN`
		}
		// Catches a selection made before another librarian enrolled the same person
		if (!editingItem && selectedMyjkknMember && existingMemberIds.has(selectedMyjkknMember.id)) {
			e.myjkkn = `${selectedMyjkknMember.display_name} is already a member`
		}
		if (!isMyJKKNCategory && !form.display_name.trim()) {
			e.display_name = 'Name is required'
		}
		// "Other" is only meaningful once it is named
		if (form.member_category === 'other' && !form.category_label.trim()) {
			e.category_label = 'Type what this member is called'
		}
		if (!form.membership_start_date) e.membership_start_date = 'Start date is required'
		if (!form.membership_end_date) e.membership_end_date = 'End date is required'

		// Both present — the range itself must make sense
		if (form.membership_start_date && form.membership_end_date) {
			if (form.membership_end_date < form.membership_start_date) {
				e.membership_end_date = 'End date cannot be before the start date'
			} else if (form.membership_end_date === form.membership_start_date) {
				e.membership_end_date = 'End date must be after the start date'
			}
		}

		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const instId = getInstitutionIdForCreate() ?? institutionId
			// member_number is always assigned by the server — never sent from the form
			const { member_number: _ignored, ...formWithoutMemberNumber } = form
			const { category_label: _typedLabel, ...formWithoutLabel } = formWithoutMemberNumber
			const payload: Record<string, unknown> = {
				...formWithoutLabel,
				institution_id: instId ?? '',
				membership_end_date: form.membership_end_date || undefined,
			}

			// Only "Other" carries a typed name; the other two are named already.
			// The field is sent only when it means something — so a library still
			// running the older database is never asked to store a column it has
			// not been given yet.
			if (form.member_category === 'other') {
				payload.category_label = form.category_label.trim()
			} else if (editingItem?.category_label) {
				payload.category_label = null
			}

			// Attach MyJKKN reference if selected
			if (selectedMyjkknMember) {
				if (form.member_category === 'learner') {
					payload.learner_id = selectedMyjkknMember.id
					// A learner's member number IS their roll number, so the card
					// they already carry is the card the desk scans.
					payload.roll_number = selectedMyjkknMember.roll_number
				} else if (form.member_category === 'facilitator') {
					payload.facilitator_id = selectedMyjkknMember.id
				}
			}

			if (editingItem) {
				const updated = await updateMember(editingItem.id, payload)
				setMembers(prev => prev.map(m => m.id === updated.id ? updated : m))
				toast({ title: '✅ Member updated', className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300' })
			} else {
				const created = await createMember(payload)
				setMembers(prev => [created, ...prev])
				toast({ title: '✅ Member enrolled', className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300' })
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
		setBatchNote(null)
		setForm({
			member_number: m.member_number,
			member_category: m.member_category,
			category_label: m.category_label ?? '',
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
			toast({ title: '✅ Member deleted', className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300' })
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
				<Card className="border-l-4 border-l-brand-green dark:border-l-brand-green-400 hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-brand-green dark:text-brand-green-400">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Members</p>
							</div>
							<Users className="h-5 w-5 text-brand-green/40 dark:text-brand-green-400/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-brand-green-400 hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-brand-green-600 dark:text-brand-green-300">{scorecardData.active}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Active</p>
							</div>
							<UserCheck className="h-5 w-5 text-brand-green-400/50" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-brand-yellow hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-brand-yellow-800 dark:text-brand-yellow-500">{scorecardData.inactive}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Inactive</p>
							</div>
							<UserX className="h-5 w-5 text-brand-yellow-700/50 dark:text-brand-yellow-500/50" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-destructive hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-destructive">{scorecardData.delinquent}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Delinquent</p>
							</div>
							<UserPlus className="h-5 w-5 text-destructive/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						{/* Row 1: Title + Actions */}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold font-heading">Knowledge Community Members</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								<Button className="h-8 text-sm px-4 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900 focus-ring" onClick={() => { resetForm(); setSheetOpen(true) }}>
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
										<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
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
												<TableCell><MemberCategoryBadge category={m.member_category} label={m.category_label} /></TableCell>
												{mustSelectInstitution && <TableCell className="text-sm">{m.institution_id?.slice(0, 8) ?? '—'}</TableCell>}
												<TableCell className="text-sm">{m.email ?? '—'}</TableCell>
												<TableCell>
													<Badge variant="outline" className={m.is_active
														? 'bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/20 dark:text-brand-green-400 dark:border-brand-green-700'
														: 'bg-brand-yellow-100 text-brand-yellow-900 border-brand-yellow-300 dark:bg-brand-yellow-900/20 dark:text-brand-yellow-500 dark:border-brand-yellow-800'}>
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
															<DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10" onClick={() => setDeleteTarget(m)}>
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
												<DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10" onClick={() => setDeleteTarget(m)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<MemberCategoryBadge category={m.member_category} label={m.category_label} />
										<Badge variant="outline" className={m.is_active
											? 'bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/20 dark:text-brand-green-400 dark:border-brand-green-700'
											: 'bg-brand-yellow-100 text-brand-yellow-900 border-brand-yellow-300 dark:bg-brand-yellow-900/20 dark:text-brand-yellow-500 dark:border-brand-yellow-800'}>
											{m.is_active ? 'Active' : 'Inactive'}
										</Badge>
									</div>
									{m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
								</div>
							))}
						</div>

						{/* Pagination */}
						<div className="flex flex-wrap items-center justify-between gap-2 pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
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
						<SheetTitle className="text-lg font-semibold font-heading">{editingItem ? 'Edit Member' : 'Add Member'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem
								? 'Update member details below'
								: addTab === 'bulk'
									? 'Enrol a program\'s learners, or the college\'s facilitators, together'
									: 'Fill in the details to add a new Knowledge Community Member'}
						</p>
					</SheetHeader>

					{/* One at a time, or a whole program at once. Editing is always
					    one member, so the tabs only appear while adding. */}
					<Tabs
						value={editingItem ? 'individual' : addTab}
						onValueChange={value => setAddTab(value as 'individual' | 'bulk')}
						className="mt-4"
					>
						{!editingItem && (
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="individual">Individual</TabsTrigger>
								<TabsTrigger value="bulk">Bulk</TabsTrigger>
							</TabsList>
						)}

						<TabsContent value="individual" className="mt-6 space-y-8">
						{/* Section: Identity */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-brand-green dark:text-brand-green-400 uppercase tracking-wider font-heading">Identity</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Member Number</Label>
									<Input
										value={editingItem ? form.member_number : (pendingRollNumber ?? '')}
										readOnly
										disabled={!editingItem}
										className="bg-muted font-mono"
										placeholder="Generated automatically on save"
									/>
									<p className="text-xs text-muted-foreground">
										{editingItem
											? 'Member numbers cannot be changed'
											: form.member_category === 'learner'
												? pendingRollNumber
													? 'This is their MyJKKN roll number'
													: 'Select a learner — their roll number becomes the member number'
												: 'Assigned by the system — no manual entry'}
									</p>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Category</Label>
									<Select value={form.member_category} onValueChange={v => {
										const next = v as LibMemberCategory
										setForm(f => ({
											...f,
											member_category: next,
											// The typed name belongs to "Other" alone
											category_label: next === 'other' ? f.category_label : '',
											display_name: '',
											email: '',
											phone: '',
											// Dates filled from a learner's batch do not belong to the next person
											membership_start_date: defaultForm.membership_start_date,
											membership_end_date: '',
										}))
										setSelectedMyjkknMember(null)
										setBatchNote(null)
									}}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* What "Other" is called here — a research scholar, a visiting
							    doctor, a school teacher. Every campus words it differently. */}
							{form.member_category === 'other' && (
								<div className="space-y-2">
									<Label className="text-sm font-semibold">
										Category Name <span className="text-destructive">*</span>
									</Label>
									<Input
										value={form.category_label}
										onChange={e => setForm(f => ({ ...f, category_label: e.target.value }))}
										className={errors.category_label ? 'border-destructive' : ''}
										placeholder="e.g. Research Scholar, Visiting Faculty, Alumni"
									/>
									{errors.category_label
										? <p className="text-xs text-destructive">{errors.category_label}</p>
										: <p className="text-xs text-muted-foreground">This is what shows against their name in the members list</p>}
								</div>
							)}

							{/* MyJKKN search for learner/facilitator (new members only) */}
							{(form.member_category === 'learner' || form.member_category === 'facilitator') && !editingItem ? (
								<div className="space-y-2">
									<Label className="text-sm font-semibold">
										{form.member_category === 'learner' ? 'Select Learner' : 'Select Learning Facilitator'} <span className="text-destructive">*</span>
									</Label>
									<MyJKKNMemberSearch
										category={form.member_category}
										institutionId={institutionId ?? ''}
										myjkknInstitutionIds={currentMyJKKNInstitutionIds}
										onSelect={handleMyjkknSelect}
										onBrowseAll={() => setBrowseModalOpen(true)}
										existingMemberIds={existingMemberIds}
										selectedMember={selectedMyjkknMember}
										onClear={() => {
											setSelectedMyjkknMember(null)
											setForm(prev => ({
												...prev,
												display_name: '',
												email: '',
												phone: '',
												membership_start_date: defaultForm.membership_start_date,
												membership_end_date: '',
											}))
											setBatchNote(null)
										}}
									/>
									{errors.myjkkn && <p className="text-xs text-destructive">{errors.myjkkn}</p>}
								</div>
							) : (
								<>
									<div className="space-y-2">
										<Label className="text-sm font-semibold">Full Name <span className="text-destructive">*</span></Label>
										<Input
											value={form.display_name}
											onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
											className={errors.display_name ? 'border-destructive' : ''}
											placeholder="Full name"
										/>
										{errors.display_name && <p className="text-xs text-destructive">{errors.display_name}</p>}
									</div>
								</>
							)}
						</div>

						{/* Section: Contact — show for manual categories or editing, or after MyJKKN selection */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-brand-green dark:text-brand-green-400 uppercase tracking-wider font-heading">Contact</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">College Mail ID</Label>
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
									<Label className="text-sm font-semibold">Mobile</Label>
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
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-xs font-semibold text-brand-green dark:text-brand-green-400 uppercase tracking-wider font-heading">Membership</h3>
								{batchLoading && (
									<span className="text-xs text-muted-foreground">Reading the batch dates...</span>
								)}
								{!batchLoading && batchNote && (
									<span className="text-xs font-medium px-2 py-0.5 rounded-full border border-brand-green-200 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/20 dark:border-brand-green-700 dark:text-brand-green-400">
										{batchNote}
									</span>
								)}
							</div>

							{/* Which batch the dates come from. Filled in by itself when
							    MyJKKN knows the learner's batch; picked here when it does
							    not, which is common — the dates still come from a batch. */}
							{!editingItem && form.member_category === 'learner' && selectedMyjkknMember && (
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Batch</Label>
									<Select value={chosenBatchId} onValueChange={applyBatch}>
										<SelectTrigger className={batchMissing ? 'border-amber-400' : ''}>
											<SelectValue placeholder={
												collegeBatches.length === 0 ? 'Reading batches from MyJKKN...' : 'Choose the batch'
											} />
										</SelectTrigger>
										<SelectContent>
											{collegeBatches.map(b => (
												<SelectItem key={b.id} value={b.id}>
													{b.label} — {readableDay(b.start)} → {readableDay(b.end)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{batchMissing ? (
										<p className="text-xs text-amber-700 dark:text-amber-500">
											MyJKKN has no batch against {selectedMyjkknMember.display_name}, so the dates could not fill
											themselves — choose their batch here and both dates follow.
										</p>
									) : (
										<p className="text-xs text-muted-foreground">
											Taken from MyJKKN. Change it and the dates below follow.
										</p>
									)}
								</div>
							)}
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Start Date <span className="text-destructive">*</span></Label>
									<Input
										type="date"
										value={form.membership_start_date}
										onChange={e => setForm(f => ({ ...f, membership_start_date: e.target.value }))}
										className={errors.membership_start_date ? 'border-destructive' : ''}
									/>
									{errors.membership_start_date && <p className="text-xs text-destructive">{errors.membership_start_date}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">End Date <span className="text-destructive">*</span></Label>
									<Input
										type="date"
										value={form.membership_end_date}
										min={form.membership_start_date || undefined}
										onChange={e => setForm(f => ({ ...f, membership_end_date: e.target.value }))}
										className={errors.membership_end_date ? 'border-destructive' : ''}
									/>
									{errors.membership_end_date && <p className="text-xs text-destructive">{errors.membership_end_date}</p>}
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
							<Button className="h-10 px-6 w-full sm:w-auto bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900 focus-ring" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Member' : 'Create Member')}
							</Button>
						</div>
						</TabsContent>

						{!editingItem && (
							<TabsContent value="bulk" className="mt-6">
								<MemberBulkEnrol
									institutionId={getInstitutionIdForCreate() ?? institutionId}
									onEnrolled={fetchData}
									onClose={() => setSheetOpen(false)}
								/>
							</TabsContent>
						)}
					</Tabs>
				</SheetContent>
			</Sheet>

			{/* Standalone Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">Delete Member</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete <strong>{deleteTarget?.display_name ?? deleteTarget?.member_number}</strong>? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
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
					existingMemberIds={existingMemberIds}
					onSelect={handleMyjkknSelect}
				/>
			)}
		</div>
	)
}
