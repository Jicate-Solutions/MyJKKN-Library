'use client'

/**
 * Department Libraries — the small libraries kept inside a college's
 * departments, and the books the main library has sent out to them.
 *
 * The list of departments is MyJKKN's, read live. Nothing is stored here about
 * which departments exist, which is why adding one in MyJKKN makes it appear on
 * this screen with nothing changed on this side.
 *
 * What this screen owns is what the library put inside a department: whether it
 * has a library at all, who is in charge of it, and how many books are there.
 * Everything about the books themselves is one click further in.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { InchargePicker } from '@/components/library/incharge-picker'
import {
	fetchDepartments,
	openDepartmentLibrary,
	updateDepartmentLibrary,
} from '@/services/library/lib-departments-service'
import type { DepartmentRow, InchargeCandidate } from '@/types/lib-departments'
import {
	RefreshCw, Search, Building2, BookOpen, Lock, UserPlus, ChevronRight,
	AlertTriangle, Plus,
} from 'lucide-react'

const SUCCESS_TOAST =
	'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300'

export default function DepartmentsPage() {
	const { isReady, institutionId } = useInstitutionFilter()
	const { toast } = useToast()

	const [departments, setDepartments] = useState<DepartmentRow[]>([])
	const [loading, setLoading] = useState(true)
	const [problem, setProblem] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [saving, setSaving] = useState(false)

	/** The department being set up or edited in the side panel. */
	const [editing, setEditing] = useState<DepartmentRow | null>(null)
	const [chosen, setChosen] = useState<InchargeCandidate | null>(null)
	const [clearIncharge, setClearIncharge] = useState(false)
	const [lendable, setLendable] = useState(false)

	const load = useCallback(async () => {
		if (!isReady) return
		if (!institutionId) {
			setDepartments([])
			setProblem(null)
			setLoading(false)
			return
		}

		try {
			setLoading(true)
			setProblem(null)
			const { departments: rows } = await fetchDepartments(institutionId)
			setDepartments(rows)
		} catch (err) {
			setProblem(err instanceof Error ? err.message : 'Failed to load departments')
			setDepartments([])
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId])

	useEffect(() => { load() }, [load])

	const filtered = useMemo(() => {
		if (!search.trim()) return departments
		const q = search.trim().toLowerCase()
		return departments.filter(d =>
			d.department_name.toLowerCase().includes(q) ||
			d.department_code.toLowerCase().includes(q) ||
			(d.display_name?.toLowerCase().includes(q) ?? false) ||
			(d.library?.incharge_name?.toLowerCase().includes(q) ?? false)
		)
	}, [departments, search])

	const totals = useMemo(() => ({
		departments: departments.length,
		open: departments.filter(d => d.library?.is_active).length,
		books: departments.reduce((sum, d) => sum + (d.library?.book_count ?? 0), 0),
		issuable: departments.reduce((sum, d) => sum + (d.library?.issuable_count ?? 0), 0),
	}), [departments])

	const openPanel = (department: DepartmentRow) => {
		setEditing(department)
		setChosen(null)
		setClearIncharge(false)
		setLendable(department.library?.is_lendable ?? false)
	}

	const save = async () => {
		if (!editing || !institutionId) return

		try {
			setSaving(true)

			if (editing.library) {
				await updateDepartmentLibrary({
					id: editing.library.id,
					is_lendable: lendable,
					...(chosen
						? {
							incharge_myjkkn_id: chosen.myjkkn_id,
							incharge_name: chosen.display_name,
							incharge_designation: chosen.role_label,
							incharge_email: chosen.email,
						}
						: clearIncharge
							? { incharge_myjkkn_id: null }
							: {}),
				})
				toast({ title: '✅ Saved', description: editing.department_name, className: SUCCESS_TOAST })
			} else {
				await openDepartmentLibrary({
					institution_id: institutionId,
					myjkkn_department_id: editing.myjkkn_department_id,
					is_lendable: lendable,
					...(chosen
						? {
							incharge_myjkkn_id: chosen.myjkkn_id,
							incharge_name: chosen.display_name,
							incharge_designation: chosen.role_label,
							incharge_email: chosen.email ?? undefined,
						}
						: {}),
				})
				toast({
					title: '✅ Department library opened',
					description: `${editing.department_name} can now receive books from the main library.`,
					className: SUCCESS_TOAST,
				})
			}

			setEditing(null)
			load()
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to save'),
				variant: 'destructive',
			})
		} finally {
			setSaving(false)
		}
	}

	// ── A college has to be chosen first ─────────────────────────────────────
	//
	// Every college has its own departments, its own librarian and its own
	// rules. Seven colleges' departments in one list would be a list nobody
	// could act on.
	if (isReady && !institutionId) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="w-full max-w-md">
					<CardContent className="p-8 text-center">
						<Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
						<h2 className="mb-1 text-base font-semibold font-heading">Choose a college first</h2>
						<p className="text-sm text-muted-foreground">
							Department libraries belong to one college at a time — pick one from the switcher above.
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (problem) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="w-full max-w-md border-l-4 border-l-destructive">
					<CardContent className="p-8 text-center">
						<Lock className="mx-auto mb-3 h-10 w-10 text-destructive/50" />
						<h2 className="mb-1 text-base font-semibold font-heading">Could not load departments</h2>
						<p className="mb-4 text-sm text-muted-foreground">{problem}</p>
						<Button variant="outline" size="sm" onClick={load}>
							<RefreshCw className="mr-1.5 h-4 w-4" /> Try again
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			{/* What the college has, at a glance */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat label="Departments" value={totals.departments} hint="from MyJKKN" icon={Building2} />
				<Stat label="Libraries open" value={totals.open} hint="receiving books" icon={BookOpen} />
				<Stat label="Books out there" value={totals.books} hint="on department shelves" icon={BookOpen} />
				<Stat label="Of those, issuable" value={totals.issuable} hint="the rest are reference" icon={UserPlus} />
			</div>

			<Card className="flex min-h-0 flex-1 flex-col">
				<CardHeader className="flex-shrink-0 border-b px-4 py-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<h2 className="text-base font-semibold font-heading">Department Libraries</h2>
							<p className="text-xs text-muted-foreground">
								One catalogue, one accession number — a book sent to a department is the same copy on a different shelf
							</p>
						</div>
						<Button variant="outline" size="icon" className="h-8 w-8 shrink-0 p-0" onClick={load}>
							<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
						</Button>
					</div>
					<div className="relative mt-3 max-w-sm">
						<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search department or in-charge..."
							value={search}
							onChange={e => setSearch(e.target.value)}
							className="h-8 pl-8 text-sm"
						/>
					</div>
				</CardHeader>

				<CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-0">
					<div className="mt-3 min-h-[380px] flex-1 overflow-hidden rounded-md border">
						<div className="h-full overflow-auto">
							<Table className="min-w-[860px]">
								<TableHeader className="sticky top-0 z-10 bg-muted/50">
									<TableRow>
										<TableHead className="text-xs font-semibold">Department</TableHead>
										<TableHead className="w-[120px] text-xs font-semibold">Code</TableHead>
										<TableHead className="text-xs font-semibold">In-charge</TableHead>
										<TableHead className="w-[110px] text-xs font-semibold">Books</TableHead>
										<TableHead className="w-[130px] text-xs font-semibold">Books here</TableHead>
										<TableHead className="w-[150px] text-xs font-semibold"></TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading ? (
										<TableRow>
											<TableCell colSpan={6} className="h-32 text-center">
												<RefreshCw className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
											</TableCell>
										</TableRow>
									) : filtered.length === 0 ? (
										<TableRow>
											<TableCell colSpan={6} className="h-32 text-center">
												<div className="flex flex-col items-center gap-1 text-muted-foreground">
													<Building2 className="h-8 w-8 opacity-20" />
													<span className="text-sm">
														{search
															? 'No department matches that'
															: 'MyJKKN has no departments for this college yet'}
													</span>
												</div>
											</TableCell>
										</TableRow>
									) : filtered.map(department => (
										<TableRow key={department.myjkkn_department_id} className="hover:bg-muted/50">
											<TableCell>
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium">{department.department_name}</span>
													{!department.is_active_in_myjkkn && (
														<Badge
															variant="outline"
															className="gap-1 border-amber-300 text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-400"
														>
															<AlertTriangle className="h-3 w-3" /> Not active in MyJKKN
														</Badge>
													)}
												</div>
												{department.degree_name && (
													<p className="text-xs text-muted-foreground">{department.degree_name}</p>
												)}
											</TableCell>

											<TableCell>
												<Badge variant="outline" className="font-mono text-xs">
													{department.department_code}
												</Badge>
											</TableCell>

											<TableCell>
												{department.library?.incharge_name ? (
													<div className="min-w-0">
														<p className="truncate text-sm">{department.library.incharge_name}</p>
														{department.library.incharge_designation && (
															<p className="truncate text-xs text-muted-foreground">
																{department.library.incharge_designation}
															</p>
														)}
													</div>
												) : (
													<span className="text-xs text-muted-foreground">—</span>
												)}
											</TableCell>

											<TableCell>
												{department.library ? (
													<div className="text-sm">
														<span className="font-medium">{department.library.book_count ?? 0}</span>
														{(department.library.issuable_count ?? 0) > 0 && (
															<span className="ml-1 text-xs text-muted-foreground">
																· {department.library.issuable_count} issuable
															</span>
														)}
													</div>
												) : (
													<span className="text-xs text-muted-foreground">—</span>
												)}
											</TableCell>

											<TableCell>
												{!department.library ? (
													<span className="text-xs text-muted-foreground">No library</span>
												) : !department.library.is_active ? (
													<Badge variant="outline" className="text-[10px]">Closed</Badge>
												) : department.library.is_lendable ? (
													<Badge
														variant="outline"
														className="border-brand-green-200 text-[10px] text-brand-green-700 dark:border-brand-green-700 dark:text-brand-green-400"
													>
														Can be issued
													</Badge>
												) : (
													<Badge variant="secondary" className="text-[10px]">Reference only</Badge>
												)}
											</TableCell>

											<TableCell>
												<div className="flex items-center justify-end gap-1">
													{department.library ? (
														<>
															<Button
																variant="ghost" size="sm" className="h-7 text-xs"
																onClick={() => openPanel(department)}
															>
																Edit
															</Button>
															<Button asChild variant="outline" size="sm" className="h-7 text-xs">
																<Link href={`/departments/${department.library.id}`}>
																	Open <ChevronRight className="ml-0.5 h-3 w-3" />
																</Link>
															</Button>
														</>
													) : (
														<Button
															size="sm"
															className="h-7 bg-brand-green text-xs text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
															onClick={() => openPanel(department)}
														>
															<Plus className="mr-1 h-3 w-3" /> Set up
														</Button>
													)}
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Setting one up, or changing who holds it */}
			<Sheet open={!!editing} onOpenChange={o => { if (!o) setEditing(null) }}>
				<SheetContent className="overflow-y-auto sm:max-w-[520px]">
					<SheetHeader>
						<SheetTitle className="font-heading">
							{editing?.library ? editing.department_name : `Set up ${editing?.department_name ?? ''}`}
						</SheetTitle>
						<SheetDescription className="text-xs">
							{editing?.library
								? 'Who holds this department library, and what happens to books sent here.'
								: 'This creates a shelf for the department inside the main catalogue. No book moves until you send one.'}
						</SheetDescription>
					</SheetHeader>

					<div className="mt-6 space-y-6">
						<div className="space-y-2">
							<Label className="text-xs">In-charge</Label>
							<p className="text-[11px] text-muted-foreground">
								Anyone teaching at this college — HOD, facilitator, principal. This makes them
								answerable for the books; it does not give them a login.
							</p>
							{institutionId && (
								<InchargePicker
									institutionId={institutionId}
									current={
										chosen
											? { myjkkn_id: chosen.myjkkn_id, name: chosen.display_name, designation: chosen.role_label }
											: clearIncharge
												? null
												: editing?.library
													? {
														myjkkn_id: editing.library.incharge_myjkkn_id,
														name: editing.library.incharge_name,
														designation: editing.library.incharge_designation,
													}
													: null
									}
									disabled={saving}
									onChoose={person => {
										setChosen(person)
										setClearIncharge(person === null)
									}}
								/>
							)}
						</div>

						<div className="flex items-start justify-between gap-4 rounded-md border p-3">
							<div className="min-w-0">
								<Label className="text-xs">Books sent here can be issued</Label>
								<p className="mt-0.5 text-[11px] text-muted-foreground">
									Off is the normal setting — books arrive for reference. This is only the
									default for arriving books: a single copy can always be made issuable
									afterwards without opening the whole department.
								</p>
							</div>
							<Switch checked={lendable} onCheckedChange={setLendable} disabled={saving} />
						</div>

						{editing?.library && (
							<p className="text-[11px] text-muted-foreground">
								Changing this default does not change books already on the shelf.
							</p>
						)}

						<Button
							onClick={save}
							disabled={saving}
							className="w-full bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
						>
							{saving ? 'Saving...' : editing?.library ? 'Save' : 'Open this department library'}
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	)
}

function Stat({
	label, value, hint, icon: Icon,
}: {
	label: string
	value: number
	hint: string
	icon: React.ElementType
}) {
	return (
		<Card>
			<CardContent className="flex items-center gap-3 p-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/10">
					<Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
				</div>
				<div className="min-w-0">
					<p className="text-lg font-semibold leading-none font-heading">{value}</p>
					<p className="truncate text-xs text-muted-foreground">{label}</p>
					<p className="truncate text-[10px] text-muted-foreground/70">{hint}</p>
				</div>
			</CardContent>
		</Card>
	)
}
