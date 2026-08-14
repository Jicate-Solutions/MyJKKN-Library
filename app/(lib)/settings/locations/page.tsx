'use client'

/**
 * Shelf Locations — where a book physically sits.
 *
 * Pharmacy shelves by cupboard and rack ("28-B"), so typing every shelf one at
 * a time would mean hundreds of rows. The range creator makes a whole run of
 * cupboards at once and skips any code that already exists.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { RefreshCw, Plus, Trash2, Lock, Search, Layers } from 'lucide-react'

interface Location {
	id: string
	location_code: string
	location_name: string
	floor: string | null
	section: string | null
	is_lendable: boolean
	is_active: boolean
	sort_order: number
}

export default function LocationsPage() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const [locations, setLocations] = useState<Location[]>([])
	const [loading, setLoading] = useState(true)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [deleting, setDeleting] = useState<Location | null>(null)

	const [range, setRange] = useState({ from: '', to: '', racks: 'A,B,C,D', section: '', floor: '', lendable: true })

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setForbidden(null)
			const res = await fetch(appendToUrl('/api/lib/settings/locations'))
			if (!res.ok) {
				setForbidden((await res.json()).error || 'You do not have permission to view this page')
				setLocations([])
				return
			}
			setLocations(await res.json())
		} catch {
			toast({ title: 'Failed to load locations', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])

	const filtered = useMemo(() => {
		if (!search) return locations
		const q = search.toLowerCase()
		return locations.filter(l =>
			l.location_code.toLowerCase().includes(q) ||
			l.location_name.toLowerCase().includes(q) ||
			(l.section?.toLowerCase().includes(q) ?? false)
		)
	}, [locations, search])

	const createRange = async () => {
		if (!institutionId) {
			toast({ title: 'Select an institution first', variant: 'destructive' })
			return
		}
		const from = Number(range.from)
		const to = Number(range.to)
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
			toast({ title: 'Enter a valid cupboard range', variant: 'destructive' })
			return
		}

		try {
			setSaving(true)
			const res = await fetch('/api/lib/settings/locations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					institution_id: institutionId,
					cupboard_from: from,
					cupboard_to: to,
					racks: range.racks.split(',').map(r => r.trim()).filter(Boolean),
					section: range.section || null,
					floor: range.floor || null,
					is_lendable: range.lendable,
				}),
			})
			const json = await res.json()
			if (!res.ok) throw new Error(json.error || 'Failed to create shelves')

			toast({
				title: `✅ ${json.created} shelves created`,
				description: json.skipped ? `${json.skipped} already existed and were left alone.` : undefined,
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
			setSheetOpen(false)
			fetchData()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const toggleLendable = async (location: Location) => {
		try {
			const res = await fetch('/api/lib/settings/locations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...location, is_lendable: !location.is_lendable }),
			})
			if (!res.ok) throw new Error((await res.json()).error || 'Failed to update')
			setLocations(prev => prev.map(l => (l.id === location.id ? { ...l, is_lendable: !l.is_lendable } : l)))
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		}
	}

	const confirmDelete = async () => {
		if (!deleting) return
		try {
			const res = await fetch(`/api/lib/settings/locations?id=${deleting.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete')
			toast({ title: '✅ Shelf removed' })
			setDeleting(null)
			fetchData()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		}
	}

	if (forbidden) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="max-w-md w-full border-l-4 border-l-destructive">
					<CardContent className="p-8 text-center">
						<Lock className="h-10 w-10 mx-auto text-destructive/50 mb-3" />
						<h2 className="text-base font-semibold font-heading mb-1">Access restricted</h2>
						<p className="text-sm text-muted-foreground">{forbidden}</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="flex flex-1 flex-col gap-4 min-h-0">
			<Card className="flex-1 flex flex-col min-h-0">
				<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<h2 className="text-base font-semibold font-heading">Shelf Locations</h2>
							<p className="text-xs text-muted-foreground">
								{locations.length} shelves · a shelf marked reference never lets its books out
							</p>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
								<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
							</Button>
							<Button
								onClick={() => setSheetOpen(true)}
								className="h-8 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
							>
								<Plus className="h-4 w-4 mr-1.5" /> Add shelves
							</Button>
						</div>
					</div>
					<div className="relative max-w-sm mt-3">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search shelf code or section..."
							value={search}
							onChange={e => setSearch(e.target.value)}
							className="pl-8 h-8 text-sm"
						/>
					</div>
				</CardHeader>

				<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
					<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px]">
						<div className="h-full overflow-auto">
							<Table>
								<TableHeader className="sticky top-0 z-10 bg-muted/50">
									<TableRow>
										<TableHead className="text-xs font-semibold w-[120px]">Shelf</TableHead>
										<TableHead className="text-xs font-semibold">Name</TableHead>
										<TableHead className="text-xs font-semibold">Section</TableHead>
										<TableHead className="text-xs font-semibold w-[140px]">Books can go out</TableHead>
										<TableHead className="text-xs font-semibold w-[60px]"></TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading ? (
										<TableRow>
											<TableCell colSpan={5} className="h-32 text-center">
												<RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
											</TableCell>
										</TableRow>
									) : filtered.length === 0 ? (
										<TableRow>
											<TableCell colSpan={5} className="h-32 text-center">
												<div className="flex flex-col items-center gap-1 text-muted-foreground">
													<Layers className="h-8 w-8 opacity-20" />
													<span className="text-sm">No shelves yet — add a cupboard range to start</span>
												</div>
											</TableCell>
										</TableRow>
									) : filtered.map(l => (
										<TableRow key={l.id} className="hover:bg-muted/50">
											<TableCell>
												<Badge variant="outline" className="font-mono text-xs">{l.location_code}</Badge>
											</TableCell>
											<TableCell className="text-sm">{l.location_name}</TableCell>
											<TableCell className="text-sm text-muted-foreground">{l.section ?? '—'}</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<Switch checked={l.is_lendable} onCheckedChange={() => toggleLendable(l)} />
													<span className="text-xs text-muted-foreground">
														{l.is_lendable ? 'Yes' : 'Reference only'}
													</span>
												</div>
											</TableCell>
											<TableCell>
												<Button
													variant="ghost" size="icon"
													className="h-8 w-8 p-0 text-destructive hover:text-destructive"
													onClick={() => setDeleting(l)}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				</CardContent>
			</Card>

			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent className="sm:max-w-[520px] overflow-y-auto">
					<SheetHeader>
						<SheetTitle className="font-heading">Add shelves</SheetTitle>
					</SheetHeader>

					<div className="space-y-5 mt-6">
						<p className="text-xs text-muted-foreground">
							Cupboards 10 to 12 with racks A–D makes 12 shelves: 10-A through 12-D.
							Codes that already exist are skipped.
						</p>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label className="text-xs">Cupboard from</Label>
								<Input
									type="number" min={1} placeholder="10"
									value={range.from}
									onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
									className="h-9"
								/>
							</div>
							<div className="space-y-1.5">
								<Label className="text-xs">Cupboard to</Label>
								<Input
									type="number" min={1} placeholder="63"
									value={range.to}
									onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
									className="h-9"
								/>
							</div>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Racks in each cupboard</Label>
							<Input
								value={range.racks}
								onChange={e => setRange(r => ({ ...r, racks: e.target.value }))}
								className="h-9"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Section (optional)</Label>
							<Input
								placeholder="Pharmaceutical Chemistry"
								value={range.section}
								onChange={e => setRange(r => ({ ...r, section: e.target.value }))}
								className="h-9"
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<div>
								<Label className="text-xs">Books here can be issued</Label>
								<p className="text-[11px] text-muted-foreground">Turn off for a reference shelf</p>
							</div>
							<Switch
								checked={range.lendable}
								onCheckedChange={v => setRange(r => ({ ...r, lendable: v }))}
							/>
						</div>

						<Button
							onClick={createRange}
							disabled={saving}
							className="w-full bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
						>
							{saving ? 'Creating...' : 'Create shelves'}
						</Button>
					</div>
				</SheetContent>
			</Sheet>

			<AlertDialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">Remove shelf</AlertDialogTitle>
						<AlertDialogDescription>
							Remove <strong>{deleting?.location_code}</strong>? If books are shelved here this will
							be refused — mark it inactive instead.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={e => { e.preventDefault(); confirmDelete() }}>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
