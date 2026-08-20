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
	/** Learners only — becomes their library member number */
	roll_number?: string
	/** Learners only — the batch they belong to, which carries its start and end dates */
	batch_id?: string
}

interface MyJKKNMemberSearchProps {
	category: 'learner' | 'facilitator'
	institutionId: string
	myjkknInstitutionIds: string[]
	onSelect: (member: SelectedMember) => void
	onBrowseAll: () => void
	selectedMember?: SelectedMember | null
	onClear: () => void
	/** MyJKKN ids already enrolled — shown but not selectable */
	existingMemberIds?: Set<string>
}

function getInitials(name: string): string {
	return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

// MyJKKN names these columns differently across learner and staff payloads, and
// sometimes nests them one level down. Reading only `email`/`phone` left the form
// blank, so try each known spelling in order of preference.
function pickField(source: Record<string, any> | null | undefined, keys: string[]): string | undefined {
	if (!source) return undefined

	for (const key of keys) {
		const value = source[key]
		if (typeof value === 'string' && value.trim()) return value.trim()
	}

	// One level down (e.g. contact: { college_email: '...' })
	for (const value of Object.values(source)) {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const nested = pickField(value as Record<string, any>, keys)
			if (nested) return nested
		}
	}

	return undefined
}

// College/institution address first — the form labels this "College Mail ID"
export const EMAIL_KEYS = [
	'college_email', 'institution_email', 'official_email', 'student_email',
	'email', 'personal_email', 'email_id', 'mail_id',
]

export const PHONE_KEYS = [
	'student_mobile', 'mobile_number', 'mobile', 'phone_number',
	'phone', 'contact_number', 'contact_no',
]

// The learner's roll number becomes their library member number, so the order
// matters: roll_number is the one printed on the college ID card. Anything that
// looks like a placeholder ("NOT APPLICABLE", "-") is treated as absent.
export const ROLL_KEYS = [
	'roll_number', 'roll_no', 'register_number', 'registration_number',
	'admission_number', 'student_id',
]

const PLACEHOLDERS = new Set(['not applicable', 'na', 'n/a', 'nil', 'none', '-', '--'])

export function extractEmail(item: Record<string, any>): string | undefined {
	return pickField(item, EMAIL_KEYS)
}

export function extractPhone(item: Record<string, any>): string | undefined {
	return pickField(item, PHONE_KEYS)
}

export function extractRollNumber(item: Record<string, any>): string | undefined {
	const value = pickField(item, ROLL_KEYS)
	if (!value) return undefined
	return PLACEHOLDERS.has(value.trim().toLowerCase()) ? undefined : value.trim()
}

export function MyJKKNMemberSearch({
	category,
	myjkknInstitutionIds,
	onSelect,
	onBrowseAll,
	selectedMember,
	onClear,
	existingMemberIds,
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
			email: extractEmail(item as Record<string, any>),
			phone: extractPhone(item as Record<string, any>),
			identifier: isLearner
				? student.roll_number || student.register_number || ''
				: staff.staff_id || staff.staff_code || '',
			roll_number: isLearner ? extractRollNumber(item as Record<string, any>) : undefined,
			batch_id: isLearner ? (student.batch_id || undefined) : undefined,
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
					placeholder={`Search ${entityLabel} by name, email or ${category === 'learner' ? 'roll number' : 'staff code'}...`}
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
						const alreadyMember = existingMemberIds?.has(item.id) ?? false

						return (
							<button
								key={item.id}
								type="button"
								disabled={alreadyMember}
								aria-disabled={alreadyMember}
								title={alreadyMember ? 'Already a member' : undefined}
								className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
									alreadyMember ? 'opacity-60 cursor-not-allowed' : 'hover:bg-accent'
								}`}
								onClick={() => { if (!alreadyMember) handleSelect(item) }}
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
								{alreadyMember && (
									<span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
										Already a member
									</span>
								)}
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
