'use client'

import { useState, useEffect, useCallback } from 'react'
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MyJKKNStudent, MyJKKNStaff, MyJKKNProgram, MyJKKNDepartment } from '@/types/myjkkn'
import type { SelectedMember } from './myjkkn-member-search'

interface BrowseModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	category: 'learner' | 'facilitator'
	myjkknInstitutionIds: string[]
	onSelect: (member: SelectedMember) => void
}

function getInitials(name: string): string {
	return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

export function MyJKKNBrowseModal({
	open,
	onOpenChange,
	category,
	myjkknInstitutionIds,
	onSelect,
}: BrowseModalProps) {
	const [search, setSearch] = useState('')
	const [programFilter, setProgramFilter] = useState<string>('all')
	const [departmentFilter, setDepartmentFilter] = useState<string>('all')
	const [results, setResults] = useState<(MyJKKNStudent | MyJKKNStaff)[]>([])
	const [loading, setLoading] = useState(false)
	const [page, setPage] = useState(1)
	const [totalPages, setTotalPages] = useState(1)
	const [hasSearched, setHasSearched] = useState(false)
	const [programs, setPrograms] = useState<MyJKKNProgram[]>([])
	const [departments, setDepartments] = useState<MyJKKNDepartment[]>([])

	// Load filter options when modal opens
	useEffect(() => {
		if (!open || myjkknInstitutionIds.length === 0) return

		const loadFilters = async () => {
			const allPrograms: MyJKKNProgram[] = []
			const allDepts: MyJKKNDepartment[] = []

			for (const myjkknId of myjkknInstitutionIds) {
				const [progRes, deptRes] = await Promise.all([
					fetch(`/api/myjkkn/programs?institution_id=${myjkknId}&limit=100`).catch(() => null),
					fetch(`/api/myjkkn/departments?institution_id=${myjkknId}&limit=100`).catch(() => null),
				])

				if (progRes?.ok) {
					const json = await progRes.json()
					allPrograms.push(...(json.data || json || []))
				}
				if (deptRes?.ok) {
					const json = await deptRes.json()
					allDepts.push(...(json.data || json || []))
				}
			}

			const seenProg = new Set<string>()
			setPrograms(allPrograms.filter(p => {
				const code = p.program_code || p.id
				if (seenProg.has(code)) return false
				seenProg.add(code)
				return true
			}))

			const seenDept = new Set<string>()
			setDepartments(allDepts.filter(d => {
				const code = d.department_code || d.id
				if (seenDept.has(code)) return false
				seenDept.add(code)
				return true
			}))
		}

		loadFilters()
	}, [open, myjkknInstitutionIds])

	const canSearch = search.length >= 2 || programFilter !== 'all' || departmentFilter !== 'all'

	const doSearch = useCallback(async (pageNum: number = 1) => {
		if (!canSearch) return
		setLoading(true)
		setHasSearched(true)

		try {
			const endpoint = category === 'learner' ? '/api/myjkkn/learners' : '/api/myjkkn/staff'
			const allResults: (MyJKKNStudent | MyJKKNStaff)[] = []
			let maxPages = 1

			for (const myjkknId of myjkknInstitutionIds) {
				const params = new URLSearchParams({
					institution_id: myjkknId,
					page: String(pageNum),
					limit: '20',
				})
				if (search.length >= 2) params.set('search', search)
				if (programFilter !== 'all' && programFilter !== 'undefined') params.set('program_code', programFilter)
				if (departmentFilter !== 'all' && departmentFilter !== 'undefined') params.set('department_code', departmentFilter)

				const res = await fetch(`${endpoint}?${params}`)
				if (res.ok) {
					const json = await res.json()
					const items = json.data || json || []
					allResults.push(...items)
					if (json.metadata?.totalPages > maxPages) {
						maxPages = json.metadata.totalPages
					}
				}
			}

			const seen = new Set<string>()
			setResults(allResults.filter(item => {
				if (seen.has(item.id)) return false
				seen.add(item.id)
				return true
			}))
			setTotalPages(maxPages)
			setPage(pageNum)
		} catch {
			setResults([])
		} finally {
			setLoading(false)
		}
	}, [canSearch, search, programFilter, departmentFilter, category, myjkknInstitutionIds])

	const handleSelect = (item: MyJKKNStudent | MyJKKNStaff) => {
		const isLearner = category === 'learner'
		const student = item as MyJKKNStudent
		const staff = item as MyJKKNStaff

		onSelect({
			id: item.id,
			category,
			display_name: [item.first_name, item.last_name].filter(Boolean).join(' '),
			email: item.email || undefined,
			phone: item.phone || undefined,
			identifier: isLearner
				? student.roll_number || student.register_number || ''
				: staff.staff_id || staff.staff_code || '',
		})
		onOpenChange(false)
	}

	// Reset on close
	useEffect(() => {
		if (!open) {
			setSearch('')
			setProgramFilter('all')
			setDepartmentFilter('all')
			setResults([])
			setHasSearched(false)
			setPage(1)
		}
	}, [open])

	const entityLabel = category === 'learner' ? 'Learners' : 'Learning Facilitators'

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Browse {entityLabel}</DialogTitle>
					<DialogDescription>
						Search or filter to find a {category === 'learner' ? 'learner' : 'learning facilitator'} from MyJKKN
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col sm:flex-row gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder={`Search by name or ${category === 'learner' ? 'roll number' : 'staff code'}...`}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
							onKeyDown={(e) => { if (e.key === 'Enter') doSearch(1) }}
						/>
					</div>
					{category === 'learner' && (
						<Select value={programFilter} onValueChange={setProgramFilter}>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="Program" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Programs</SelectItem>
								{programs.filter(p => p.program_code).map(p => (
									<SelectItem key={p.program_code} value={p.program_code}>
										{p.program_code} — {p.program_name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Select value={departmentFilter} onValueChange={setDepartmentFilter}>
						<SelectTrigger className="w-[180px]">
							<SelectValue placeholder="Department" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Departments</SelectItem>
							{departments.filter(d => d.department_code).map(d => (
								<SelectItem key={d.department_code} value={d.department_code}>
									{d.department_name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button onClick={() => doSearch(1)} disabled={!canSearch || loading}>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
					</Button>
				</div>

				<div className="flex-1 overflow-y-auto min-h-0 border rounded-md">
					{!hasSearched ? (
						<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
							Enter at least 2 characters or select a filter to search
						</div>
					) : loading ? (
						<div className="flex items-center justify-center h-48">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : results.length === 0 ? (
						<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
							No results found
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>{category === 'learner' ? 'Roll Number' : 'Staff Code'}</TableHead>
									<TableHead>{category === 'learner' ? 'Program' : 'Designation'}</TableHead>
									<TableHead className="w-20">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{results.map((item) => {
									const name = [item.first_name, item.last_name].filter(Boolean).join(' ')
									const identifier = category === 'learner'
										? (item as MyJKKNStudent).roll_number || (item as MyJKKNStudent).register_number
										: (item as MyJKKNStaff).staff_id || (item as MyJKKNStaff).staff_code
									const detail = category === 'learner'
										? (item as MyJKKNStudent).program_code || ''
										: (item as MyJKKNStaff).designation || ''

									return (
										<TableRow key={item.id} className="cursor-pointer hover:bg-accent/50" onClick={() => handleSelect(item)}>
											<TableCell>
												<div className="flex items-center gap-2">
													<Avatar className="h-7 w-7">
														<AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
															{getInitials(name)}
														</AvatarFallback>
													</Avatar>
													<span className="text-sm font-medium">{name}</span>
												</div>
											</TableCell>
											<TableCell className="text-sm">{identifier}</TableCell>
											<TableCell className="text-sm text-muted-foreground">{detail}</TableCell>
											<TableCell>
												<Button variant="ghost" size="sm" className="h-7 text-xs">Select</Button>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</div>

				{hasSearched && results.length > 0 && totalPages > 1 && (
					<div className="flex items-center justify-between pt-2">
						<span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
						<div className="flex gap-1">
							<Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => doSearch(page - 1)}>
								<ChevronLeft className="h-3.5 w-3.5" />
							</Button>
							<Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => doSearch(page + 1)}>
								<ChevronRight className="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
