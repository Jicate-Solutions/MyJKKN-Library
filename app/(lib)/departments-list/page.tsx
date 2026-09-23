'use client'

/**
 * Departments List — the hub every department dropdown reads.
 *
 * A college's departments come from two places. MyJKKN holds most of them and
 * is read live, so a department added there appears here by itself. But MyJKKN
 * does not hold them all — Dental shelves by twenty-one subjects, Arts &
 * Science keeps a "Main Library" and a "Miscellaneous" section — so the library
 * adds its own here, and the two sit in one list.
 *
 * What is decided on this screen reaches everywhere a department is chosen: the
 * New Title form, bulk upload and edit, and the Department Libraries screen.
 * Switching one off stops it being offered for new books; the books already
 * filed under it keep their department and stay readable.
 *
 * The in-charge is not set here. That stays on Department Libraries, and still
 * comes only from MyJKKN staff.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useLibrarianWrite } from '@/hooks/library/use-librarian-write'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	fetchDepartmentMaster, addDepartment, updateDepartment, removeDepartment,
} from '@/services/library/lib-departments-service'
import type { DepartmentMasterRow, DepartmentMasterList } from '@/types/lib-departments'
import {
	RefreshCw, Search, Plus, Layers, Building2, BookOpen, Trash2, Pencil, AlertTriangle,
} from 'lucide-react'

const SUCCESS_TOAST =
	'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300'

const EMPTY: DepartmentMasterList = {
	departments: [], total: 0, active: 0, from_myjkkn: 0, added_here: 0,
	myjkkn_ok: true, table_missing: false, migration: null,
}

export default function DepartmentsListPage() {
	const canWrite = useLibrarianWrite()
	const { isReady, institutionId } = useInstitutionFilter()
	const { toast } = useToast()

	const [list, setList] = useState<DepartmentMasterList>(EMPTY)
	const [loading, setLoading] = useState(true)
	const [problem, setProblem] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [saving, setSaving] = useState(false)

	/** The department being added or edited in the side panel. */
	const [editing, setEditing] = useState<DepartmentMasterRow | 'new' | null>(null)
	const [name, setName] = useState('')
	const [code, setCode] = useState('')
	const [removing, setRemoving] = useState<DepartmentMasterRow | null>(null)

	const load = useCallback(async () => {
		if (!isReady) return
		if (!institutionId) {
			setList(EMPTY)
			setProblem(null)
			setLoading(false)
			return
		}
		try {
			setLoading(true)
			setProblem(null)
			setList(await fetchDepartmentMaster(institutionId))
		} catch (err) {
			setProblem(err instanceof Error ? err.message : 'Failed to load the departments list')
			setList(EMPTY)
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId])

	useEffect(() => { load() }, [load])

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase()
		if (!q) return list.departments
		return list.departments.filter(d =>
			d.department_name.toLowerCase().includes(q) ||
			d.department_code.toLowerCase().includes(q) ||
			(d.display_name?.toLowerCase().includes(q) ?? false)
		)
	}, [list.departments, search])

	const openPanel = (department: DepartmentMasterRow | 'new') => {
		setEditing(department)
		setName(department === 'new' ? '' : department.department_name)
		setCode(department === 'new' ? '' : department.department_code)
	}

	const save = async () => {
		if (!editing || !institutionId) return
		const trimmed = name.trim()
		if (!trimmed) {
			toast({ title: 'Give the department a name', variant: 'destructive' })
			return
		}
		try {
			setSaving(true)
			if (editing === 'new') {
				await addDepartment({ institution_id: institutionId, department_name: trimmed, department_code: code.trim() })
				toast({ title: `${trimmed} added`, className: SUCCESS_TOAST })
			} else {
				await updateDepartment({ id: editing.local_id!, department_name: trimmed, department_code: code.trim() })
				toast({ title: 'Saved', className: SUCCESS_TOAST })
			}
			setEditing(null)
			await load()
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Failed to save', variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	/** On means offered wherever a department is chosen; off leaves old books untouched. */
	const toggle = async (department: DepartmentMasterRow, next: boolean) => {
		if (!institutionId) return
		try {
			await updateDepartment(department.source === 'local'
				? { id: department.local_id!, is_active: next }
				: { institution_id: institutionId, myjkkn_department_id: department.myjkkn_department_id!, is_active: next })
			toast({
				title: next ? `${department.department_name} is offered again` : `${department.department_name} switched off`,
				description: next ? undefined : 'Books already filed under it keep their department',
				className: SUCCESS_TOAST,
			})
			await load()
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Failed to save', variant: 'destructive' })
		}
	}

	const remove = async () => {
		if (!removing?.local_id) return
		try {
			setSaving(true)
			await removeDepartment(removing.local_id)
			toast({ title: `${removing.department_name} removed`, className: SUCCESS_TOAST })
			setRemoving(null)
			await load()
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Failed to remove', variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold">Departments List</h1>
					<p className="text-xs text-muted-foreground">
						MyJKKN&apos;s departments and the ones added here — this list is what every department dropdown offers
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={load} disabled={loading}>
						<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
					</Button>
					{canWrite && (
						<Button size="sm" className="h-8" onClick={() => openPanel('new')} disabled={!institutionId}>
							<Plus className="h-4 w-4 mr-1" /> Add Department
						</Button>
					)}
				</div>
			</div>

			{/* A college has to be chosen: departments belong to one college */}
			{isReady && !institutionId && (
				<Card className="border-dashed border-2 bg-muted/30">
					<CardContent className="p-6 text-center">
						<Layers className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
						<p className="text-sm font-medium">Choose a college first</p>
						<p className="text-xs text-muted-foreground mt-1">Every college keeps its own departments</p>
					</CardContent>
				</Card>
			)}

			{/* The migration, said plainly — the person reading it is the one who runs it */}
			{list.table_missing && (
				<Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
					<CardContent className="p-4 flex items-start gap-3">
						<AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
						<div className="text-sm">
							<p className="font-medium">The departments table has not been created on this database yet</p>
							<p className="text-xs text-muted-foreground mt-1">
								Run <code className="font-mono">{list.migration}</code> in Supabase. Until then MyJKKN&apos;s
								departments still show, and the older per-college list still fills the New Title dropdown.
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{problem && (
				<Card className="border-red-300 bg-red-50 dark:bg-red-900/20">
					<CardContent className="p-4 text-sm text-red-700 dark:text-red-300">{problem}</CardContent>
				</Card>
			)}

			{institutionId && (
				<>
					{/* Counts */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						{[
							{ label: 'Departments', value: list.total, icon: <Layers className="h-5 w-5 text-blue-500/40" />, accent: 'border-l-blue-500' },
							{ label: 'Offered now', value: list.active, icon: <BookOpen className="h-5 w-5 text-emerald-500/40" />, accent: 'border-l-emerald-500' },
							{ label: 'From MyJKKN', value: list.from_myjkkn, icon: <Building2 className="h-5 w-5 text-indigo-500/40" />, accent: 'border-l-indigo-500' },
							{ label: 'Added here', value: list.added_here, icon: <Plus className="h-5 w-5 text-amber-500/40" />, accent: 'border-l-amber-500' },
						].map(card => (
							<Card key={card.label} className={`border-l-4 ${card.accent}`}>
								<CardContent className="p-4 flex items-center justify-between gap-2">
									<div className="min-w-0">
										<p className="text-2xl font-bold tracking-tight">{loading ? '—' : card.value}</p>
										<p className="text-xs font-medium text-muted-foreground mt-0.5">{card.label}</p>
									</div>
									{card.icon}
								</CardContent>
							</Card>
						))}
					</div>

					{/* Search */}
					<div className="relative max-w-sm">
						<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search departments…"
							value={search}
							onChange={e => setSearch(e.target.value)}
							className="pl-8 h-9"
						/>
					</div>

					{/* The list */}
					<Card>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Department</TableHead>
										<TableHead className="hidden sm:table-cell">Code</TableHead>
										<TableHead className="hidden md:table-cell">Source</TableHead>
										<TableHead className="hidden md:table-cell text-right">Titles</TableHead>
										<TableHead className="text-center">Offered</TableHead>
										<TableHead className="w-[90px]" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading ? (
										<TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Loading…</TableCell></TableRow>
									) : filtered.length === 0 ? (
										<TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
											{search ? 'No department matches that' : 'No departments yet — add the first one'}
										</TableCell></TableRow>
									) : filtered.map(d => (
										<TableRow key={d.key} className={d.is_active ? '' : 'opacity-60'}>
											<TableCell className="font-medium">
												<div className="flex items-center gap-2 min-w-0">
													<span className="truncate" title={d.department_name}>{d.department_name}</span>
													{d.display_name && <span className="text-xs text-muted-foreground shrink-0">({d.display_name})</span>}
													{d.has_library && (
														<Link href="/departments" className="shrink-0">
															<Badge variant="outline" className="text-[10px]">Has library</Badge>
														</Link>
													)}
												</div>
												{d.degree_name && <p className="text-xs text-muted-foreground truncate">{d.degree_name}</p>}
											</TableCell>
											<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{d.department_code || '—'}</TableCell>
											<TableCell className="hidden md:table-cell">
												{d.source === 'myjkkn' ? (
													<Badge variant="secondary" className="text-[10px]">MyJKKN</Badge>
												) : (
													<Badge variant="outline" className="text-[10px]">Added here</Badge>
												)}
												{d.is_active_in_myjkkn === false && (
													<Badge variant="outline" className="text-[10px] ml-1 border-amber-400 text-amber-700">Inactive in MyJKKN</Badge>
												)}
											</TableCell>
											<TableCell className="hidden md:table-cell text-right text-sm text-muted-foreground">{d.title_count || '—'}</TableCell>
											<TableCell className="text-center">
												<Switch
													checked={d.is_active}
													onCheckedChange={next => toggle(d, next)}
													disabled={!canWrite || (d.source === 'myjkkn' && d.is_active_in_myjkkn === false)}
												/>
											</TableCell>
											<TableCell>
												{canWrite && d.source === 'local' && (
													<div className="flex items-center justify-end gap-1">
														<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openPanel(d)}>
															<Pencil className="h-4 w-4" />
														</Button>
														<Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => setRemoving(d)}>
															<Trash2 className="h-4 w-4" />
														</Button>
													</div>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</>
			)}

			{/* Add or rename — only ever one of ours */}
			<Sheet open={editing !== null} onOpenChange={open => !open && setEditing(null)}>
				<SheetContent className="w-full sm:max-w-md">
					<SheetHeader>
						<SheetTitle>{editing === 'new' ? 'Add a department' : 'Edit department'}</SheetTitle>
						<SheetDescription>
							It is offered wherever a department is chosen — the New Title form, bulk upload and Department Libraries.
						</SheetDescription>
					</SheetHeader>
					<div className="mt-6 space-y-4">
						<div className="space-y-2">
							<Label className="text-sm font-semibold">Department name</Label>
							<Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Anatomy" autoFocus />
						</div>
						<div className="space-y-2">
							<Label className="text-sm font-semibold">Short code <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
							<Input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. ANAT" />
						</div>
						<div className="flex gap-2 pt-2">
							<Button onClick={save} disabled={saving} className="flex-1">
								{saving ? 'Saving…' : editing === 'new' ? 'Add department' : 'Save'}
							</Button>
							<Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Removing is refused by the server while books or a library use it */}
			<AlertDialog open={removing !== null} onOpenChange={open => !open && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {removing?.department_name}?</AlertDialogTitle>
						<AlertDialogDescription>
							It stops being offered anywhere. If books are filed under it, the removal is refused and you
							can switch it off instead — the books then keep their department.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={remove} disabled={saving} className="bg-red-600 hover:bg-red-700">
							{saving ? 'Removing…' : 'Remove'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
