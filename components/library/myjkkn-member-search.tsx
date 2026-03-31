'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
	identifier: string
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

function getInitials(name: string): string {
	return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

export function MyJKKNMemberSearch({
	category,
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
	const containerRef = useRef<HTMLDivElement>(null)

	// Close dropdown on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
				const endpoint = category === 'learner' ? '/api/myjkkn/learners' : '/api/myjkkn/staff'
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
		setQuery('')
		setShowDropdown(false)
	}

	// Show selected member chip
	if (selectedMember) {
		return (
			<div className="flex items-center gap-2 p-2.5 rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
				<Avatar className="h-8 w-8">
					<AvatarFallback className="text-xs bg-blue-100 text-blue-700">
						{getInitials(selectedMember.display_name)}
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
		<div className="space-y-2" ref={containerRef}>
			<div className="relative">
				<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
				<Input
					placeholder={`Search ${entityLabel} by name or ${category === 'learner' ? 'roll number' : 'staff code'}...`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="pl-9 pr-8"
				/>
				{loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
			</div>

			{showDropdown && (
				<div className="relative z-50 bg-popover border rounded-md shadow-lg max-h-[320px] overflow-y-auto">
					{results.map((item) => {
						const name = [item.first_name, item.last_name].filter(Boolean).join(' ')
						const identifier = category === 'learner'
							? (item as MyJKKNStudent).roll_number || (item as MyJKKNStudent).register_number
							: (item as MyJKKNStaff).staff_id || (item as MyJKKNStaff).staff_code
						const subtitle = category === 'learner'
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
										{getInitials(name)}
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
