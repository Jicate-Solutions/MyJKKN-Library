# MyJKKN Member Enrollment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable librarians to search and select learners/facilitators from MyJKKN when enrolling library members, and display live profile data (photo, name, roll number) in the members table.

**Architecture:** Hybrid search UX — inline debounced search in the Add Member sheet with a "Browse All" modal for filtered browsing. Live profile display via `<MemberProfileCell>` with in-memory 5-min TTL cache. Manual entry preserved for team_member/guest/alumni categories.

**Tech Stack:** Next.js 15, TypeScript, Shadcn UI (Dialog, Avatar, Skeleton, Input, Select, Table), MyJKKN API (`/api-management/students`, `/api-management/staff`), Supabase (`lib_members` table)

**Design Doc:** `docs/plans/2026-03-20-myjkkn-member-enrollment-design.md`

---

## Task 1: Create Staff [id] API Route

The `/api/myjkkn/staff/[id]` route is missing. Needed for live profile fetching of facilitator members.

**Files:**
- Create: `app/api/myjkkn/staff/[id]/route.ts`
- Reference: `app/api/myjkkn/students/[id]/route.ts` (same pattern)

**Step 1: Create the route**

```typescript
// app/api/myjkkn/staff/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

const MYJKKN_BASE_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''

export async function GET(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	try {
		const staffId = params.id
		if (!staffId) {
			return NextResponse.json({ error: 'Staff ID is required' }, { status: 400 })
		}

		const response = await fetch(`${MYJKKN_BASE_URL}/api-management/staff/${staffId}`, {
			headers: {
				'Authorization': `Bearer ${MYJKKN_API_KEY}`,
				'Content-Type': 'application/json',
			},
			cache: 'no-store',
		})

		if (!response.ok) {
			if (response.status === 404) {
				return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
			}
			return NextResponse.json(
				{ error: `Failed to fetch staff details: ${response.statusText}` },
				{ status: response.status }
			)
		}

		const data = await response.json()
		return NextResponse.json(data)
	} catch (error) {
		console.error('MyJKKN Staff Detail API Error:', error)
		return NextResponse.json({ error: 'Failed to fetch staff details' }, { status: 500 })
	}
}
```

**Step 2: Verify route loads**

Start dev server, hit `http://localhost:3000/api/myjkkn/staff/any-uuid` — should return 404 from MyJKKN (confirming the route works and forwards correctly).

**Step 3: Commit**

```
feat: add staff [id] API route for MyJKKN profile fetching
```

---

## Task 2: Create Profile Cache Utility

In-memory cache to avoid re-fetching the same MyJKKN profile on every table re-render.

**Files:**
- Create: `lib/myjkkn-profile-cache.ts`

**Step 1: Implement the cache**

```typescript
// lib/myjkkn-profile-cache.ts
'use client'

interface CacheEntry<T> {
	data: T
	timestamp: number
}

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry<unknown>>()

export function getCachedProfile<T>(key: string): T | null {
	const entry = cache.get(key)
	if (!entry) return null
	if (Date.now() - entry.timestamp > TTL_MS) {
		cache.delete(key)
		return null
	}
	return entry.data as T
}

export function setCachedProfile<T>(key: string, data: T): void {
	cache.set(key, { data, timestamp: Date.now() })
}

export function clearProfileCache(): void {
	cache.clear()
}
```

**Step 2: Commit**

```
feat: add in-memory MyJKKN profile cache with 5-min TTL
```

---

## Task 3: Create MemberProfileCell Component

Displays live MyJKKN profile (avatar + name + identifier) in the members table.

**Files:**
- Create: `components/library/member-profile-cell.tsx`
- Reference: `types/myjkkn.ts` for `MyJKKNStudent`, `MyJKKNStaff`
- Reference: `components/ui/avatar.tsx`, `components/ui/skeleton.tsx`

**Step 1: Implement the component**

```typescript
// components/library/member-profile-cell.tsx
'use client'

import { useState, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { getCachedProfile, setCachedProfile } from '@/lib/myjkkn-profile-cache'
import type { LibMemberCategory } from '@/types/lib'

interface MemberProfileCellProps {
	memberId?: string | null
	memberCategory: LibMemberCategory
	learnerId?: string | null
	facilitatorId?: string | null
	fallbackName?: string | null
}

interface ResolvedProfile {
	name: string
	identifier: string // roll_number or staff_code
	photoUrl?: string
	subtitle?: string // program_code or designation
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map(w => w[0])
		.filter(Boolean)
		.slice(0, 2)
		.join('')
		.toUpperCase()
}

export function MemberProfileCell({
	memberCategory,
	learnerId,
	facilitatorId,
	fallbackName,
}: MemberProfileCellProps) {
	const [profile, setProfile] = useState<ResolvedProfile | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState(false)

	const needsFetch =
		(memberCategory === 'learner' && !!learnerId) ||
		(memberCategory === 'facilitator' && !!facilitatorId)

	const cacheKey = memberCategory === 'learner'
		? `learner:${learnerId}`
		: `facilitator:${facilitatorId}`

	useEffect(() => {
		if (!needsFetch) return

		// Check cache first
		const cached = getCachedProfile<ResolvedProfile>(cacheKey)
		if (cached) {
			setProfile(cached)
			return
		}

		let cancelled = false

		const fetchProfile = async () => {
			setLoading(true)
			setError(false)
			try {
				const apiId = memberCategory === 'learner' ? learnerId : facilitatorId
				const endpoint = memberCategory === 'learner'
					? `/api/myjkkn/students/${apiId}`
					: `/api/myjkkn/staff/${apiId}`

				const res = await fetch(endpoint)
				if (!res.ok) throw new Error('fetch failed')

				const json = await res.json()
				// MyJKKN returns { data: {...} } or direct object
				const d = json.data || json

				const resolved: ResolvedProfile = memberCategory === 'learner'
					? {
						name: [d.first_name, d.last_name].filter(Boolean).join(' '),
						identifier: d.roll_number || d.register_number || '',
						photoUrl: d.student_photo_url,
						subtitle: d.program_code || d.program_id || '',
					}
					: {
						name: [d.first_name, d.last_name].filter(Boolean).join(' '),
						identifier: d.staff_code || '',
						photoUrl: d.staff_photo_url,
						subtitle: d.designation || '',
					}

				if (!cancelled) {
					setProfile(resolved)
					setCachedProfile(cacheKey, resolved)
				}
			} catch {
				if (!cancelled) setError(true)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		fetchProfile()
		return () => { cancelled = true }
	}, [needsFetch, cacheKey, memberCategory, learnerId, facilitatorId])

	// Loading skeleton
	if (loading) {
		return (
			<div className="flex items-center gap-2.5">
				<Skeleton className="h-8 w-8 rounded-full" />
				<div className="space-y-1">
					<Skeleton className="h-3.5 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
			</div>
		)
	}

	// Resolved profile (from MyJKKN)
	if (profile && !error) {
		const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name)}&backgroundColor=059669&textColor=ffffff&fontSize=40`
		return (
			<div className="flex items-center gap-2.5">
				<Avatar className="h-8 w-8">
					<AvatarImage src={profile.photoUrl || diceBearUrl} alt={profile.name} />
					<AvatarFallback className="text-xs bg-blue-100 text-blue-700">
						{getInitials(profile.name)}
					</AvatarFallback>
				</Avatar>
				<div className="min-w-0">
					<div className="text-sm font-medium truncate">{profile.name}</div>
					<div className="text-xs text-muted-foreground truncate">
						{profile.identifier}{profile.subtitle ? ` · ${profile.subtitle}` : ''}
					</div>
				</div>
			</div>
		)
	}

	// Fallback (no MyJKKN profile or error)
	const displayName = fallbackName || 'Unknown Member'
	const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=6b7280&textColor=ffffff&fontSize=40`
	return (
		<div className="flex items-center gap-2.5">
			<Avatar className="h-8 w-8">
				<AvatarImage src={diceBearUrl} alt={displayName} />
				<AvatarFallback className="text-xs">{getInitials(displayName)}</AvatarFallback>
			</Avatar>
			<div className="text-sm font-medium truncate">{displayName}</div>
		</div>
	)
}
```

**Step 2: Commit**

```
feat: add MemberProfileCell with live MyJKKN profile fetching
```

---

## Task 4: Create MyJKKN Member Search Component

Inline debounced search dropdown for selecting learners/staff from MyJKKN.

**Files:**
- Create: `components/library/myjkkn-member-search.tsx`
- Reference: `types/myjkkn.ts` for `MyJKKNStudent`, `MyJKKNStaff`
- Reference: `components/ui/input.tsx`, `components/ui/avatar.tsx`

**Step 1: Implement the search component**

```typescript
// components/library/myjkkn-member-search.tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Loader2, Search, Users, X } from 'lucide-react'
import type { MyJKKNStudent, MyJKKNStaff } from '@/types/myjkkn'
import type { LibMemberCategory } from '@/types/lib'

export interface SelectedMember {
	id: string
	category: LibMemberCategory
	display_name: string
	email?: string
	phone?: string
	identifier: string // roll_number or staff_code
}

interface MyJKKNMemberSearchProps {
	category: 'learner' | 'facilitator'
	institutionId: string
	myjkknInstitutionIds: string[]
	onSelect: (member: SelectedMember) => void
	onBrowseAll: () => void
	selectedMember?: SelectedMember | null
	onClear: () => void
}

export function MyJKKNMemberSearch({
	category,
	institutionId,
	myjkknInstitutionIds,
	onSelect,
	onBrowseAll,
	selectedMember,
	onClear,
}: MyJKKNMemberSearchProps) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<(MyJKKNStudent | MyJKKNStaff)[]>([])
	const [loading, setLoading] = useState(false)
	const [showDropdown, setShowDropdown] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	// Close dropdown on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setShowDropdown(false)
			}
		}
		document.addEventListener('mousedown', handler)
		return () => document.removeEventListener('mousedown', handler)
	}, [])

	// Debounced search
	useEffect(() => {
		if (query.length < 2) {
			setResults([])
			setShowDropdown(false)
			return
		}

		const timer = setTimeout(async () => {
			setLoading(true)
			try {
				const endpoint = category === 'learner' ? '/api/myjkkn/students' : '/api/myjkkn/staff'
				// Search across all MyJKKN institution IDs
				const allResults: (MyJKKNStudent | MyJKKNStaff)[] = []
				for (const myjkknId of myjkknInstitutionIds) {
					const res = await fetch(
						`${endpoint}?search=${encodeURIComponent(query)}&institution_id=${myjkknId}&limit=10`
					)
					if (res.ok) {
						const json = await res.json()
						const items = json.data || json || []
						allResults.push(...items)
					}
				}
				// Deduplicate by id and limit to 8
				const seen = new Set<string>()
				const deduped = allResults.filter(item => {
					if (seen.has(item.id)) return false
					seen.add(item.id)
					return true
				}).slice(0, 8)

				setResults(deduped)
				setShowDropdown(deduped.length > 0)
			} catch {
				setResults([])
			} finally {
				setLoading(false)
			}
		}, 400)

		return () => clearTimeout(timer)
	}, [query, category, myjkknInstitutionIds])

	const handleSelect = (item: MyJKKNStudent | MyJKKNStaff) => {
		const isLearner = category === 'learner'
		const student = item as MyJKKNStudent
		const staff = item as MyJKKNStaff

		const selected: SelectedMember = {
			id: item.id,
			category,
			display_name: [item.first_name, item.last_name].filter(Boolean).join(' '),
			email: item.email || undefined,
			phone: item.phone || undefined,
			identifier: isLearner
				? student.roll_number || student.register_number || ''
				: staff.staff_code || '',
		}

		onSelect(selected)
		setQuery('')
		setShowDropdown(false)
	}

	// If a member is already selected, show the selection
	if (selectedMember) {
		return (
			<div className="flex items-center gap-2 p-2.5 rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
				<Avatar className="h-8 w-8">
					<AvatarFallback className="text-xs bg-blue-100 text-blue-700">
						{selectedMember.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium truncate">{selectedMember.display_name}</div>
					<div className="text-xs text-muted-foreground">{selectedMember.identifier}</div>
				</div>
				<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClear}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>
		)
	}

	const entityLabel = category === 'learner' ? 'learner' : 'learning facilitator'

	return (
		<div className="space-y-2" ref={dropdownRef}>
			<div className="relative">
				<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
				<Input
					ref={inputRef}
					placeholder={`Search ${entityLabel} by name or ${category === 'learner' ? 'roll number' : 'staff code'}...`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="pl-9 pr-8"
				/>
				{loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
			</div>

			{/* Dropdown results */}
			{showDropdown && (
				<div className="absolute z-50 w-[calc(100%-3rem)] mt-1 bg-popover border rounded-md shadow-lg max-h-[320px] overflow-y-auto">
					{results.map((item) => {
						const isLearner = category === 'learner'
						const name = [item.first_name, item.last_name].filter(Boolean).join(' ')
						const identifier = isLearner
							? (item as MyJKKNStudent).roll_number || (item as MyJKKNStudent).register_number
							: (item as MyJKKNStaff).staff_code
						const subtitle = isLearner
							? (item as MyJKKNStudent).program_code || ''
							: (item as MyJKKNStaff).designation || ''

						return (
							<button
								key={item.id}
								type="button"
								className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-accent transition-colors"
								onClick={() => handleSelect(item)}
							>
								<Avatar className="h-7 w-7 shrink-0">
									<AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
										{name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium truncate">{name}</div>
									<div className="text-xs text-muted-foreground truncate">
										{identifier}{subtitle ? ` · ${subtitle}` : ''}
									</div>
								</div>
							</button>
						)
					})}
				</div>
			)}

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full text-xs"
				onClick={onBrowseAll}
			>
				<Users className="h-3.5 w-3.5 mr-1.5" />
				Browse All {category === 'learner' ? 'Learners' : 'Learning Facilitators'}
			</Button>
		</div>
	)
}
```

**Step 2: Commit**

```
feat: add MyJKKN inline member search with debounced dropdown
```

---

## Task 5: Create Browse All Modal

Full modal with filters (program, department) and search-first loading.

**Files:**
- Create: `components/library/myjkkn-browse-modal.tsx`
- Reference: `components/ui/dialog.tsx`, `components/ui/select.tsx`, `components/ui/table.tsx`

**Step 1: Implement the browse modal**

```typescript
// components/library/myjkkn-browse-modal.tsx
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

	// Filter options
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

			// Deduplicate by code
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
			const endpoint = category === 'learner' ? '/api/myjkkn/students' : '/api/myjkkn/staff'
			const allResults: (MyJKKNStudent | MyJKKNStaff)[] = []
			let maxPages = 1

			for (const myjkknId of myjkknInstitutionIds) {
				const params = new URLSearchParams({
					institution_id: myjkknId,
					page: String(pageNum),
					limit: '20',
				})
				if (search.length >= 2) params.set('search', search)
				if (programFilter !== 'all') params.set('program_code', programFilter)
				if (departmentFilter !== 'all') params.set('department_code', departmentFilter)

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

			// Deduplicate by id
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
				: staff.staff_code || '',
		})
		onOpenChange(false)
	}

	// Reset state when modal closes
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

				{/* Filters */}
				<div className="flex flex-col sm:flex-row gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder={`Search by name or ${category === 'learner' ? 'roll number' : 'staff code'}...`}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
					{category === 'learner' && (
						<Select value={programFilter} onValueChange={setProgramFilter}>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="Program" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Programs</SelectItem>
								{programs.map(p => (
									<SelectItem key={p.program_code || p.id} value={p.program_code}>
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
							{departments.map(d => (
								<SelectItem key={d.department_code || d.id} value={d.department_code}>
									{d.department_name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button onClick={() => doSearch(1)} disabled={!canSearch || loading}>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
					</Button>
				</div>

				{/* Results */}
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
									const isLearner = category === 'learner'
									const name = [item.first_name, item.last_name].filter(Boolean).join(' ')
									const identifier = isLearner
										? (item as MyJKKNStudent).roll_number || (item as MyJKKNStudent).register_number
										: (item as MyJKKNStaff).staff_code
									const detail = isLearner
										? (item as MyJKKNStudent).program_code || ''
										: (item as MyJKKNStaff).designation || ''

									return (
										<TableRow key={item.id} className="cursor-pointer hover:bg-accent/50" onClick={() => handleSelect(item)}>
											<TableCell>
												<div className="flex items-center gap-2">
													<Avatar className="h-7 w-7">
														<AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
															{name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
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

				{/* Pagination */}
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
```

**Step 2: Commit**

```
feat: add Browse All modal with filters and search-first loading
```

---

## Task 6: Integrate Enrollment into Members Page

Wire the search + browse components into the existing Add Member sheet, and add `MemberProfileCell` to the table.

**Files:**
- Modify: `app/(lib)/members/page.tsx`

**Step 1: Add imports and state**

At the top of the file, add these imports:

```typescript
import { MyJKKNMemberSearch, type SelectedMember } from '@/components/library/myjkkn-member-search'
import { MyJKKNBrowseModal } from '@/components/library/myjkkn-browse-modal'
import { MemberProfileCell } from '@/components/library/member-profile-cell'
import { useInstitution } from '@/context/institution-context'
```

Inside the component, add new state:

```typescript
const { currentMyJKKNInstitutionIds } = useInstitution()
const [selectedMyjkknMember, setSelectedMyjkknMember] = useState<SelectedMember | null>(null)
const [browseModalOpen, setBrowseModalOpen] = useState(false)
```

**Step 2: Modify form handling**

Update `resetForm` to also clear the MyJKKN selection:

```typescript
const resetForm = () => {
	setForm(defaultForm)
	setErrors({})
	setEditingItem(null)
	setSelectedMyjkknMember(null)
}
```

Add handler for MyJKKN member selection:

```typescript
const handleMyjkknSelect = (member: SelectedMember) => {
	setSelectedMyjkknMember(member)
	setForm(prev => ({
		...prev,
		display_name: member.display_name,
		email: member.email || '',
		phone: member.phone || '',
	}))
}
```

Update `handleSave` to include `learner_id`/`facilitator_id`:

```typescript
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
```

**Step 3: Modify the form sheet**

In the Sheet form, replace the static `display_name`/`email`/`phone` fields with conditional rendering based on `member_category`:

```tsx
{/* When learner or facilitator — show MyJKKN search */}
{(form.member_category === 'learner' || form.member_category === 'facilitator') && !editingItem ? (
	<div className="space-y-2">
		<Label>
			{form.member_category === 'learner' ? 'Select Learner' : 'Select Learning Facilitator'}
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
	</div>
) : (
	<>
		{/* Manual fields for team_member/guest/alumni or when editing */}
		<div className="space-y-2">
			<Label>Display Name *</Label>
			<Input value={form.display_name} onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))} />
			{errors.display_name && <p className="text-xs text-destructive">{errors.display_name}</p>}
		</div>
		<div className="space-y-2">
			<Label>Email</Label>
			<Input value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} />
		</div>
		<div className="space-y-2">
			<Label>Phone</Label>
			<Input value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} />
		</div>
	</>
)}
```

**Step 4: Add MemberProfileCell to the table**

Replace the plain `display_name` cell in the table with:

```tsx
<TableCell>
	<MemberProfileCell
		memberCategory={m.member_category}
		learnerId={m.learner_id}
		facilitatorId={m.facilitator_id}
		fallbackName={m.display_name}
	/>
</TableCell>
```

**Step 5: Add the Browse Modal**

At the bottom of the component JSX (before the closing `</div>`), add:

```tsx
<MyJKKNBrowseModal
	open={browseModalOpen}
	onOpenChange={setBrowseModalOpen}
	category={form.member_category as 'learner' | 'facilitator'}
	myjkknInstitutionIds={currentMyJKKNInstitutionIds}
	onSelect={handleMyjkknSelect}
/>
```

**Step 6: Update validation**

Update `validate()` to require MyJKKN selection for learner/facilitator:

```typescript
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
```

**Step 7: Commit**

```
feat: integrate MyJKKN enrollment into members page with live profiles
```

---

## Task 7: Verify End-to-End

**Step 1: Manual verification checklist**

1. Open Members page → table shows `MemberProfileCell` with skeleton → avatar + name for existing members
2. Click "Add Member" → select "Learner" → inline search appears
3. Type 3 characters → dropdown shows MyJKKN results after 400ms debounce
4. Select a result → form auto-fills display_name, email
5. Click "Browse All" → modal opens with empty state ("Enter 2+ chars...")
6. Type a name → click Search → results appear in table
7. Filter by program → results narrow
8. Click a row → modal closes, form auto-fills
9. Save → member created with `learner_id` set
10. Table row shows live profile from MyJKKN
11. Repeat steps 2-10 for "Learning Facilitator" category
12. Select "Guest" → manual form appears (no search)
13. Page reload → cached profiles load instantly for 5 minutes

**Step 2: Final commit**

```
feat: complete MyJKKN member enrollment integration
```
