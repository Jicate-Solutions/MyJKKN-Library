'use client'

/**
 * Knowledge Community Members.
 *
 * Nobody is enrolled here any more. Every Active learner and every Active staff
 * member of this college is a member of its library, read live from MyJKKN each
 * time this page loads — so a learner admitted this morning is a member this
 * afternoon, and somebody who leaves stops being one without anybody
 * remembering to remove them.
 *
 * That is why there is no Add, no Edit and no Delete on this screen: a name, an
 * email or a person's status is changed in MyJKKN, and this page shows what
 * MyJKKN says. What the library itself knows is the last column — whether they
 * have ever borrowed, and whether they owe anything.
 *
 * A librarian sees their own college. Only an admin or a super admin sees more
 * than one, and only by choosing "All Institutions".
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import {
	Users, GraduationCap, Briefcase, AlertTriangle,
	Search, RefreshCw, ChevronLeft, ChevronRight, Info,
} from 'lucide-react'
import type { LibDirectoryMember } from '@/types/lib'

const CATEGORIES = [
	{ value: 'learner', label: 'Learners' },
	{ value: 'facilitator', label: 'Staff' },
]

const initials = (name: string): string =>
	name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'

export default function MembersPage() {
	const { isReady, appendToUrl, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [members, setMembers] = useState<LibDirectoryMember[]>([])
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<string>('all')
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(25)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setLoadError(null)
			const res = await fetch(appendToUrl('/api/lib/members'))
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Failed to read the member list')
			setMembers(Array.isArray(data) ? data : [])
		} catch (err) {
			setMembers([])
			const message = err instanceof Error ? err.message : 'Failed to load members'
			setLoadError(message)
			toast({ title: '❌ ' + message, variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])

	// Scorecards count the whole college, not the filtered page
	const scorecardData = useMemo(() => ({
		total: members.length,
		learners: members.filter(m => m.member_category === 'learner').length,
		staff: members.filter(m => m.member_category === 'facilitator').length,
		owing: members.filter(m => m.is_delinquent).length,
	}), [members])

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return members.filter(m => {
			const matchSearch = !term
				|| m.member_number.toLowerCase().includes(term)
				|| m.display_name.toLowerCase().includes(term)
				|| (m.email?.toLowerCase().includes(term) ?? false)
			const matchCat = categoryFilter === 'all' || m.member_category === categoryFilter
			return matchSearch && matchCat
		})
	}, [members, search, categoryFilter])

	const pageSizeOptions = useMemo(() => {
		const options = [10, 25, 50, 100]
		if (filtered.length > 100) options.push(filtered.length)
		return options
	}, [filtered.length])

	const effectivePerPage = itemsPerPage > filtered.length ? filtered.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? filtered.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: filtered
	const colCount = mustSelectInstitution ? 7 : 6

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
				<Card className="border-l-4 border-l-blue-400 hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-blue-700 dark:text-blue-400">{scorecardData.learners}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Learners</p>
							</div>
							<GraduationCap className="h-5 w-5 text-blue-400/50" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-purple-400 hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-purple-700 dark:text-purple-400">{scorecardData.staff}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Staff</p>
							</div>
							<Briefcase className="h-5 w-5 text-purple-400/50" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-destructive hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-destructive">{scorecardData.owing}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Owing a Fine</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-destructive/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						{/* Row 1: Title */}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold font-heading">Knowledge Community Members</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
								<Info className="h-3.5 w-3.5" />
								<span className="hidden sm:inline">Everyone Active in MyJKKN is a member — nothing to add here</span>
								<span className="sm:hidden">From MyJKKN</span>
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
								<TooltipContent>Read again from MyJKKN</TooltipContent>
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
											<TableHead className="text-xs font-semibold">Role in MyJKKN</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">Institution</TableHead>}
											<TableHead className="text-xs font-semibold">Email</TableHead>
											<TableHead className="text-xs font-semibold">Library</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Reading members from MyJKKN...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Users className="h-8 w-8 opacity-20" />
														<span className="text-sm">{loadError ?? 'No members found'}</span>
														<span className="text-xs">
															{loadError
																? 'Members are read from MyJKKN — try again in a moment'
																: 'Try adjusting your filters'}
														</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(m => (
											<TableRow key={m.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-mono font-medium">{m.member_number || '—'}</TableCell>
												<TableCell>
													<div className="flex items-center gap-2.5">
														<Avatar className="h-7 w-7 shrink-0">
															{m.photo_url && <AvatarImage src={m.photo_url} alt={m.display_name} />}
															<AvatarFallback className="text-[10px] bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
																{initials(m.display_name)}
															</AvatarFallback>
														</Avatar>
														<span className="text-sm font-medium truncate">{m.display_name}</span>
													</div>
												</TableCell>
												<TableCell><MemberCategoryBadge category={m.member_category} /></TableCell>
												<TableCell className="text-sm text-muted-foreground">{m.role_label}</TableCell>
												{mustSelectInstitution && <TableCell className="text-sm">{m.institution_id?.slice(0, 8) ?? '—'}</TableCell>}
												<TableCell className="text-sm">{m.email ?? '—'}</TableCell>
												<TableCell>
													{m.is_delinquent ? (
														<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
															Fine due
														</Badge>
													) : m.has_borrowed ? (
														<Badge variant="outline" className="bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/20 dark:text-brand-green-400 dark:border-brand-green-700">
															Has borrowed
														</Badge>
													) : (
														<span className="text-xs text-muted-foreground">—</span>
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
									<span className="text-sm">Reading from MyJKKN...</span>
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<Users className="h-8 w-8 opacity-20" />
									<span className="text-sm">{loadError ?? 'No members found'}</span>
								</div>
							) : paginated.map(m => (
								<div key={m.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start gap-3">
										<Avatar className="h-9 w-9 shrink-0">
											{m.photo_url && <AvatarImage src={m.photo_url} alt={m.display_name} />}
											<AvatarFallback className="text-xs bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
												{initials(m.display_name)}
											</AvatarFallback>
										</Avatar>
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">{m.display_name}</p>
											<p className="text-xs text-muted-foreground font-mono">{m.member_number || '—'}</p>
										</div>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<MemberCategoryBadge category={m.member_category} />
										{m.is_delinquent && (
											<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
												Fine due
											</Badge>
										)}
									</div>
									<p className="text-xs text-muted-foreground">{m.role_label}</p>
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
		</div>
	)
}
