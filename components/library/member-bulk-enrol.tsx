'use client'

/**
 * Enrolling a whole program at once — the Bulk tab of Add Member.
 *
 * A new academic year arrives as a list, not as a queue at the counter: one
 * program, ninety learners, all of them joining the library on the same day.
 * Ticking them off a list is the honest shape of that job.
 *
 * Two rules the screen never bends:
 *   * Only learners who are not already members can be ticked. The rest are
 *     shown, greyed, with the reason — a library that hides them leaves the
 *     librarian wondering who is missing.
 *   * Each learner's membership runs for their own batch's dates. Two learners
 *     from different batches get different periods, which is why there is no
 *     date box on this tab at all. A learner whose MyJKKN profile carries no
 *     batch cannot be ticked here; the Individual tab takes them with dates
 *     typed by hand.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
	AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { BulkProgressDialog } from '@/components/library/bulk-progress-dialog'
import { useToast } from '@/hooks/common/use-toast'
import { Loader2, Search, Users, UserPlus } from 'lucide-react'

interface Option {
	id: string
	code: string
	name: string
	department_id?: string | null
}

interface Candidate {
	id: string
	name: string
	roll_number: string | null
	email: string | null
	phone: string | null
	program_id: string | null
	program_name: string | null
	batch_id: string | null
	batch_label: string | null
	membership_start_date: string | null
	membership_end_date: string | null
	blocked_code: string | null
	blocked_reason: string | null
}

interface Props {
	institutionId: string | null
	/** Called once the enrolment finishes, so the members list behind refreshes. */
	onEnrolled: () => void
	/** Closes the sheet. */
	onClose: () => void
}

/** People are sent in chunks so the bar moves while the work happens. */
const CHUNK = 25

const ALL = 'all'

/**
 * The two kinds of member MyJKKN already knows.
 *
 * They are enrolled the same way — tick a list, save — but they are filed
 * differently: a learner belongs to a program and a batch, a facilitator to a
 * department and a staff category, and only the learner brings dates with them.
 */
type Kind = 'learner' | 'facilitator'

function formatDay(value: string | null): string {
	if (!value) return '—'
	const [year, month, day] = value.split('-')
	return year && month && day ? `${day}-${month}-${year}` : value
}

export function MemberBulkEnrol({ institutionId, onEnrolled, onClose }: Props) {
	const { toast } = useToast()

	const [category, setCategory] = useState<Kind>('learner')
	const [departments, setDepartments] = useState<Option[]>([])
	const [programs, setPrograms] = useState<Option[]>([])
	const [staffCategories, setStaffCategories] = useState<{ id: string; name: string }[]>([])
	const [optionsLoaded, setOptionsLoaded] = useState(false)

	const [departmentId, setDepartmentId] = useState<string>(ALL)
	const [programId, setProgramId] = useState<string>(ALL)
	const [staffCategoryId, setStaffCategoryId] = useState<string>(ALL)

	// Staff have no batch, so one pair of dates covers everyone ticked
	const [staffStart, setStaffStart] = useState<string>(new Date().toISOString().split('T')[0])
	const [staffEnd, setStaffEnd] = useState<string>('')

	const [candidates, setCandidates] = useState<Candidate[]>([])
	const [listed, setListed] = useState(false)
	const [loading, setLoading] = useState(false)
	const [search, setSearch] = useState('')
	const [ticked, setTicked] = useState<Set<string>>(new Set())

	const [saving, setSaving] = useState(false)
	const [done, setDone] = useState(0)
	const [result, setResult] = useState<{ created: number; failures: { name: string; roll_number: string; error: string }[] } | null>(null)

	/** Ask the server for whatever this tab needs — dropdowns, people, or both. */
	const load = useCallback(async (
		kind: Kind,
		dept: string,
		program: string,
		staffCategory: string,
		withPeople: boolean
	) => {
		if (!institutionId) {
			toast({ title: 'Choose a college first', variant: 'destructive' })
			return
		}
		try {
			setLoading(true)
			const params = new URLSearchParams({ institution_id: institutionId, category: kind })
			if (withPeople) {
				if (dept !== ALL) params.set('department_id', dept)
				if (kind === 'learner') {
					if (program !== ALL) params.set('program_id', program)
				} else if (staffCategory !== ALL) {
					params.set('staff_category_id', staffCategory)
				}
			}

			const res = await fetch(`/api/lib/members/bulk-candidates?${params}`)
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not read the list')

			setDepartments(data.departments ?? [])
			setPrograms(data.programs ?? [])
			if (kind === 'facilitator') setStaffCategories(data.staff_categories ?? [])
			setOptionsLoaded(true)

			if (withPeople) {
				setCandidates(data.candidates ?? [])
				setTicked(new Set())
				setListed(true)
			}
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed to load'), variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [institutionId, toast])

	// The dropdowns are filled the first time the tab is opened
	useEffect(() => {
		if (institutionId && !optionsLoaded) void load('learner', ALL, ALL, ALL, false)
	}, [institutionId, optionsLoaded, load])

	/** Switching kind starts a fresh list — staff categories arrive with the first staff read. */
	const switchCategory = (next: Kind) => {
		setCategory(next)
		setDepartmentId(ALL)
		setProgramId(ALL)
		setStaffCategoryId(ALL)
		setCandidates([])
		setTicked(new Set())
		setListed(false)
		if (next === 'facilitator' && staffCategories.length === 0) {
			void load('facilitator', ALL, ALL, ALL, false)
		}
	}

	// A department narrows the programs, because every program sits in one
	const programsShown = useMemo(() => (
		departmentId === ALL ? programs : programs.filter(p => p.department_id === departmentId)
	), [programs, departmentId])

	const shown = useMemo(() => {
		const term = search.trim().toLowerCase()
		if (!term) return candidates
		return candidates.filter(c =>
			c.name.toLowerCase().includes(term) ||
			(c.roll_number ?? '').toLowerCase().includes(term)
		)
	}, [candidates, search])

	const selectable = useMemo(() => shown.filter(c => !c.blocked_code), [shown])
	const allTicked = selectable.length > 0 && selectable.every(c => ticked.has(c.id))
	const readyCount = useMemo(() => candidates.filter(c => !c.blocked_code).length, [candidates])

	const toggle = (id: string) => {
		setTicked(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const toggleAll = () => {
		setTicked(prev => {
			const next = new Set(prev)
			if (allTicked) selectable.forEach(c => next.delete(c.id))
			else selectable.forEach(c => next.add(c.id))
			return next
		})
	}

	const enrol = async () => {
		const chosen = candidates.filter(c => ticked.has(c.id) && !c.blocked_code)
		if (chosen.length === 0 || !institutionId) return

		// Staff bring no dates of their own, so the pair typed above is theirs
		if (category === 'facilitator') {
			if (!staffStart || !staffEnd) {
				toast({ title: 'Give the membership start and end dates first', variant: 'destructive' })
				return
			}
			if (staffEnd <= staffStart) {
				toast({ title: 'The end date must be after the start date', variant: 'destructive' })
				return
			}
		}

		try {
			setSaving(true)
			setDone(0)
			let created = 0
			const failures: { name: string; roll_number: string; error: string }[] = []

			for (let start = 0; start < chosen.length; start += CHUNK) {
				const slice = chosen.slice(start, start + CHUNK)
				const res = await fetch('/api/lib/members/bulk', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						institution_id: institutionId,
						category,
						learners: slice.map(c => ({
							learner_id: c.id,
							display_name: c.name,
							roll_number: c.roll_number,
							email: c.email,
							phone: c.phone,
							// A learner's own batch dates — the reason this tab exists.
							// Staff take the pair the librarian typed.
							membership_start_date: category === 'facilitator' ? staffStart : c.membership_start_date,
							membership_end_date: category === 'facilitator' ? staffEnd : c.membership_end_date,
						})),
					}),
				})
				const data = await res.json()
				if (!res.ok) throw new Error(data.error || 'Enrolment failed')

				created += data.created ?? 0
				failures.push(...(data.failures ?? []))
				setDone(start + slice.length)
			}

			setResult({ created, failures })
			// Anyone who went in is now a member, so the list must be read again
			// before the same person can be ticked a second time
			if (created > 0) {
				onEnrolled()
				await load(category, departmentId, programId, staffCategoryId, true)
			}
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Enrolment failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const tickedCount = candidates.filter(c => ticked.has(c.id) && !c.blocked_code).length

	// A super admin looking at all seven libraries at once has not said which
	// one these learners are joining
	if (!institutionId) {
		return (
			<div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4">
				<p className="text-sm font-medium text-amber-800 dark:text-amber-300">Choose a college first</p>
				<p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
					Bulk enrolment works one library at a time — pick the institution at the top of the page, then come back to this tab.
				</p>
			</div>
		)
	}

	const isStaff = category === 'facilitator'
	// A whole college's learners is thousands of rows, so a program or department
	// must be named first. Staff are a hundred or so — the whole list is fine.
	const canList = isStaff || departmentId !== ALL || programId !== ALL

	return (
		<div className="space-y-5">
			{/* Learners or facilitators */}
			<div className="space-y-2">
				<Label className="text-sm font-semibold">Category</Label>
				<Select value={category} onValueChange={value => switchCategory(value as Kind)}>
					<SelectTrigger className="sm:max-w-[280px]"><SelectValue /></SelectTrigger>
					<SelectContent>
						<SelectItem value="learner">Learner</SelectItem>
						<SelectItem value="facilitator">Facilitator</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Who to look at */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label className="text-sm font-semibold">Department</Label>
					<Select
						value={departmentId}
						onValueChange={value => {
							setDepartmentId(value)
							setProgramId(ALL)
							setListed(false)
							setCandidates([])
						}}
					>
						<SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All departments</SelectItem>
							{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">From MyJKKN, for this college</p>
				</div>
				{isStaff ? (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Staff Category</Label>
						<Select
							value={staffCategoryId}
							onValueChange={value => {
								setStaffCategoryId(value)
								setListed(false)
								setCandidates([])
							}}
						>
							<SelectTrigger>
								<SelectValue placeholder={staffCategories.length === 0 ? 'Reading from MyJKKN...' : 'All staff categories'} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>All staff categories</SelectItem>
								{staffCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">Teaching, Library, Lab Assistant — as MyJKKN files them</p>
					</div>
				) : (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Program</Label>
						<Select
							value={programId}
							onValueChange={value => {
								setProgramId(value)
								setListed(false)
								setCandidates([])
							}}
						>
							<SelectTrigger><SelectValue placeholder="All programs" /></SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>All programs of this department</SelectItem>
								{programsShown.map(p => (
									<SelectItem key={p.id} value={p.id}>{p.name}{p.code ? ` — ${p.code}` : ''}</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">From MyJKKN, for this college</p>
					</div>
				)}
			</div>

			{/* Staff have no batch to read dates from, so they are given here — once,
			    for everyone ticked */}
			{isStaff && (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border p-3 bg-muted/30">
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Start Date <span className="text-destructive">*</span></Label>
						<Input type="date" value={staffStart} onChange={e => setStaffStart(e.target.value)} />
					</div>
					<div className="space-y-2">
						<Label className="text-sm font-semibold">End Date <span className="text-destructive">*</span></Label>
						<Input type="date" value={staffEnd} min={staffStart || undefined} onChange={e => setStaffEnd(e.target.value)} />
						<p className="text-xs text-muted-foreground">Staff have no batch in MyJKKN — these dates apply to everyone ticked</p>
					</div>
				</div>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					onClick={() => load(category, departmentId, programId, staffCategoryId, true)}
					disabled={loading || !canList}
					className="h-9 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
				>
					{loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
					{loading ? 'Reading MyJKKN...' : isStaff ? 'Show facilitators' : 'Show learners'}
				</Button>
				{!canList && (
					<span className="text-xs text-muted-foreground">Choose a department or a program first</span>
				)}
			</div>

			{/* The list */}
			{listed && (
				<div className="space-y-3 pt-2 border-t">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<p className="text-sm font-semibold">
								{candidates.length} {isStaff ? 'facilitator' : 'learner'}{candidates.length === 1 ? '' : 's'}
								<span className="text-muted-foreground font-normal"> · {readyCount} can be added</span>
							</p>
							<p className="text-xs text-muted-foreground">
								{isStaff
									? 'Everyone ticked joins for the dates above'
									: 'Each one joins for their own batch\'s dates'}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<div className="relative w-[190px]">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder={isStaff ? 'Name or staff ID' : 'Name or roll number'}
									value={search}
									onChange={e => setSearch(e.target.value)}
									className="pl-8 h-8 text-sm"
								/>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-8 text-xs"
								onClick={toggleAll}
								disabled={selectable.length === 0}
							>
								{allTicked ? 'Unselect all' : 'Select all'}
							</Button>
						</div>
					</div>

					<div className="rounded-md border max-h-[340px] overflow-auto">
						{shown.length === 0 ? (
							<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
								<Users className="h-8 w-8 opacity-20" />
								<span className="text-sm">
									{candidates.length === 0
										? `No ${isStaff ? 'staff' : 'learners'} in MyJKKN for this choice`
										: 'Nobody matches that'}
								</span>
							</div>
						) : shown.map(c => {
							const blocked = !!c.blocked_code
							return (
								<label
									key={c.id}
									className={`flex items-start gap-3 px-3 py-2.5 border-b last:border-b-0 ${
										blocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50'
									}`}
								>
									<Checkbox
										checked={ticked.has(c.id)}
										disabled={blocked}
										onCheckedChange={() => { if (!blocked) toggle(c.id) }}
										className="mt-0.5"
									/>
									<div className="min-w-0 flex-1">
										<div className="text-sm font-medium truncate">{c.name}</div>
										<div className="text-xs text-muted-foreground truncate">
											<span className="font-mono">
												{c.roll_number ?? (isStaff ? 'Number given on saving' : 'No roll number')}
											</span>
											{c.program_name ? ` · ${c.program_name}` : ''}
										</div>
									</div>
									<div className="text-right shrink-0">
										{blocked ? (
											<span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
												{c.blocked_reason}
											</span>
										) : isStaff ? (
											// Their staff category; the dates are the shared pair above
											<div className="text-xs font-medium">{c.batch_label ?? 'Staff'}</div>
										) : (
											<>
												<div className="text-xs font-medium">{c.batch_label ?? 'Batch'}</div>
												<div className="text-[11px] text-muted-foreground tabular-nums">
													{formatDay(c.membership_start_date)} → {formatDay(c.membership_end_date)}
												</div>
											</>
										)}
									</div>
								</label>
							)
						})}
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t">
				<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={onClose}>Close</Button>
				<Button
					className="h-10 px-6 w-full sm:w-auto bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900 focus-ring"
					onClick={enrol}
					disabled={saving || tickedCount === 0}
				>
					<UserPlus className="h-4 w-4 mr-2" />
					{tickedCount === 0 ? 'Add members' : `Add ${tickedCount} member${tickedCount === 1 ? '' : 's'}`}
				</Button>
			</div>

			<BulkProgressDialog
				open={saving}
				title={isStaff ? 'Enrolling facilitators' : 'Enrolling learners'}
				done={done}
				total={tickedCount || done}
				unit={isStaff ? 'facilitators' : 'learners'}
				note={isStaff
					? 'Everyone is joined for the dates you gave'
					: 'Each learner is joined for their own batch\'s dates'}
			/>

			<AlertDialog open={!!result} onOpenChange={o => { if (!o) setResult(null) }}>
				<AlertDialogContent className="max-w-lg">
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">
							{result?.created ? `✅ ${result.created} member${result.created === 1 ? '' : 's'} added` : 'Nobody was added'}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-3">
								<p className="text-sm">
									{result?.failures.length
										? `${result.failures.length} could not be added:`
										: 'Every learner you ticked is now a member.'}
								</p>
								{!!result?.failures.length && (
									<div className="max-h-[240px] overflow-auto rounded-md border text-xs">
										{result.failures.map((f, index) => (
											<div key={`${f.roll_number}-${index}`} className="px-3 py-2 border-b last:border-b-0">
												<span className="font-medium">{f.name}</span>
												<span className="text-muted-foreground font-mono"> {f.roll_number}</span>
												<div className="text-muted-foreground">{f.error}</div>
											</div>
										))}
									</div>
								)}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setResult(null)}>Done</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
