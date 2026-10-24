'use client'

/**
 * Who else may scan this college's shelves — managed from the Stock Check page.
 *
 * A stock check is counted by a few learners for a week. Letting one in used to
 * mean editing an environment variable in Vercel: a redeploy, an engineer, and
 * a librarian who could not add a helper on the morning the counting started.
 *
 * Super admin only, and the panel is not rendered at all for anybody else — the
 * route refuses them too, because a helper's own grant lets them read anything
 * under /api/lib/stock and hiding a button has never shut a door.
 *
 * A helper is picked from MyJKKN rather than typed, because the address is what
 * they sign in with: typed by hand, one wrong letter is a helper who cannot get
 * in and nobody can see why. Every grant carries a last day, so the list empties
 * itself after the counting is done.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
	UserPlus, Search, X, Loader2, ShieldCheck, Trash2, AlertTriangle, Pencil, Check, Users, CheckCircle2, Clock,
} from 'lucide-react'
import { StockCheckHelpersBulk } from '@/components/library/stock-check-helpers-bulk'
import { StockCheckTable, type StockColumn, type StockFacet } from '@/components/library/stock-check-table'

interface Helper {
	id: string
	/** The college whose shelves they may scan. */
	institution_id: string
	email: string
	display_name: string | null
	member_number: string | null
	myjkkn_id: string | null
	expires_on: string
	created_by_name: string | null
	/** Which college the person belongs to. A label only — see the migration. */
	member_college_code: string | null
	is_expired: boolean
}

interface Candidate {
	myjkkn_id: string
	member_number: string
	display_name: string
	email: string | null
	role_label: string
	/** Their own college, which is often not the one they are being lent to. */
	institution_id: string
}

interface College {
	id: string
	institution_code: string
}

/** A helper is let in for the counting, not for the year. */
const MAX_DAYS = 120

const dayAfter = (days: number) =>
	new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const readable = (day: string) =>
	day ? new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** Still working, or past their last day. */
const HELPER_FACET: StockFacet<Helper> = {
	label: 'Helpers',
	options: [
		{ value: 'active', label: 'Active' },
		{ value: 'ended', label: 'Ended' },
	],
	get: helper => helper.is_expired ? 'ended' : 'active',
}

export function StockCheckHelpers({ institutionId }: { institutionId: string }) {
	const { toast } = useToast()

	const [open, setOpen] = useState(false)
	const [helpers, setHelpers] = useState<Helper[]>([])
	const [loading, setLoading] = useState(false)
	const [setupError, setSetupError] = useState<string | null>(null)

	// Anybody in MyJKKN may be asked to help, so the search is not tied to the
	// college being managed: Engineering's staff count Pharmacy's shelves.
	const [colleges, setColleges] = useState<College[]>([])
	const [searchCollege, setSearchCollege] = useState('all')
	const [search, setSearch] = useState('')
	const [results, setResults] = useState<Candidate[]>([])
	const [searching, setSearching] = useState(false)
	const [picked, setPicked] = useState<Candidate | null>(null)
	// A week of counting is the usual answer, so it is already filled in.
	const [until, setUntil] = useState(dayAfter(7))
	const [saving, setSaving] = useState(false)
	const [removing, setRemoving] = useState<Helper | null>(null)
	// One helper at a time is changed in place: their college, or their date
	const [editing, setEditing] = useState<{ id: string; institutionId: string; until: string; name: string; email: string } | null>(null)
	const [adding, setAdding] = useState(false)
	const [updating, setUpdating] = useState(false)

	const searchRef = useRef<HTMLInputElement>(null)

	const load = useCallback(async () => {
		try {
			setLoading(true)
			// No college is All Institutions — every college's helpers
			const res = await fetch(institutionId
				? `/api/lib/stock/helpers?institution_id=${institutionId}`
				: '/api/lib/stock/helpers')
			const body = await res.json()
			if (!res.ok) {
				// 503 is the migration not having been run. It is said once, in
				// place of the list, rather than as a toast on every visit.
				if (res.status === 503) {
					setSetupError(body.error)
					setHelpers([])
					return
				}
				throw new Error(body.error || 'Could not read the helper list')
			}
			setSetupError(null)
			setHelpers(body as Helper[])
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not read the helper list',
				variant: 'destructive',
			})
		} finally {
			setLoading(false)
		}
	}, [institutionId, toast])

	useEffect(() => { load() }, [load])

	// Read once. A super admin is the only person who opens this panel, so the
	// switcher's list is every college.
	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch('/api/lib/institutions')
				if (!res.ok) return
				const rows = await res.json()
				setColleges((rows as College[]).map(row => ({ id: row.id, institution_code: row.institution_code })))
			} catch {
				// The picker stays on All colleges, which still finds everybody.
			}
		})()
	}, [])

	const codeOf = (id: string) => colleges.find(college => college.id === id)?.institution_code ?? ''

	// Typing should not fire a request per keystroke, and a single letter would
	// return most of the college.
	useEffect(() => {
		const term = search.trim()
		if (term.length < 2) {
			setResults([])
			setSearching(false)
			return
		}
		setSearching(true)
		const timer = setTimeout(async () => {
			try {
				// No college named means every college — which is what a super
				// admin's own member list does, and is the point of this panel.
				const scope = searchCollege === 'all' ? '' : `&institution_id=${searchCollege}`
				const res = await fetch(
					`/api/lib/members?search=${encodeURIComponent(term)}${scope}`
				)
				if (!res.ok) throw new Error()
				const rows = await res.json()
				setResults((rows as Candidate[]).slice(0, 8))
			} catch {
				setResults([])
			} finally {
				setSearching(false)
			}
		}, 400)
		return () => clearTimeout(timer)
	}, [search, searchCollege])

	const add = async () => {
		if (!picked) return
		try {
			setSaving(true)
			const res = await fetch('/api/lib/stock/helpers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					institution_id: institutionId,
					email: picked.email,
					display_name: picked.display_name,
					member_number: picked.member_number,
					myjkkn_id: picked.myjkkn_id,
					member_college_code: codeOf(picked.institution_id),
					expires_on: until,
				}),
			})
			const body = await res.json()
			if (!res.ok) throw new Error(body.error || 'Could not add this helper')

			toast({
				title: `✅ ${picked.display_name} can scan until ${readable(until)}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			setPicked(null)
			setSearch('')
			setResults([])
			await load()
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not add this helper',
				variant: 'destructive',
			})
		} finally {
			setSaving(false)
		}
	}

	const remove = async (helper: Helper) => {
		try {
			const res = await fetch(`/api/lib/stock/helpers?id=${helper.id}`, { method: 'DELETE' })
			const body = await res.json()
			if (!res.ok) throw new Error(body.error || 'Could not remove this helper')
			toast({ title: `${helper.display_name || helper.email} can no longer scan` })
			await load()
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not remove this helper',
				variant: 'destructive',
			})
		} finally {
			setRemoving(null)
		}
	}

	const change = async () => {
		if (!editing) return
		try {
			setUpdating(true)
			const res = await fetch('/api/lib/stock/helpers', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: editing.id,
					institution_id: editing.institutionId,
					expires_on: editing.until,
				}),
			})
			const body = await res.json()
			if (!res.ok) throw new Error(body.error || 'Could not change this helper')
			toast({
				title: `✅ ${body.display_name || body.email} can scan ${codeOf(editing.institutionId)} until ${readable(editing.until)}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			setEditing(null)
			await load()
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not change this helper',
				variant: 'destructive',
			})
		} finally {
			setUpdating(false)
		}
	}

	const live = helpers.filter(h => !h.is_expired)

	const helperColumns = useMemo<StockColumn<Helper>[]>(() => [
		{
			key: 'name',
			header: 'Helper',
			className: 'max-w-[220px]',
			cell: helper => (
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold" title={helper.display_name ?? helper.email}>
						{helper.display_name || helper.email}
						{helper.member_number && (
							<span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{helper.member_number}</span>
						)}
					</p>
					<p className="truncate text-xs text-muted-foreground" title={helper.email}>{helper.email}</p>
				</div>
			),
			sort: helper => helper.display_name ?? helper.email,
			excel: helper => helper.display_name ?? '',
		},
		{
			key: 'code',
			header: 'Staff ID',
			hideOnMobile: true,
			cell: helper => <span className="font-mono text-xs">{helper.member_number ?? '—'}</span>,
			sort: helper => helper.member_number ?? '',
			excel: helper => helper.member_number ?? '',
		},
		{
			key: 'email',
			header: 'Email',
			excelOnly: true,
			cell: () => null,
			excel: helper => helper.email,
		},
		{
			key: 'own',
			header: 'Own college',
			hideOnMobile: true,
			cell: helper => helper.member_college_code
				? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{helper.member_college_code}</span>
				: <span className="text-xs text-muted-foreground">—</span>,
			sort: helper => helper.member_college_code ?? '',
			excel: helper => helper.member_college_code ?? '',
		},
		{
			key: 'at',
			header: 'Scans at',
			cell: helper => (
				<span className="rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-semibold text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-300">
					{codeOf(helper.institution_id) || '—'}
				</span>
			),
			sort: helper => codeOf(helper.institution_id),
			excel: helper => codeOf(helper.institution_id),
		},
		{
			key: 'until',
			header: 'Until',
			cell: helper => helper.is_expired ? (
				<Badge variant="outline" className="whitespace-nowrap text-xs font-normal text-muted-foreground">
					Ended {readable(helper.expires_on)}
				</Badge>
			) : (
				<Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
					Until {readable(helper.expires_on)}
				</Badge>
			),
			sort: helper => helper.expires_on,
			excel: helper => readable(helper.expires_on),
		},
		{
			key: 'by',
			header: 'Added by',
			hideOnMobile: true,
			cell: helper => <span className="text-xs text-muted-foreground">{helper.created_by_name ?? '—'}</span>,
			sort: helper => helper.created_by_name ?? '',
			excel: helper => helper.created_by_name ?? '',
		},
		{
			key: 'actions',
			header: '',
			className: 'w-[84px] text-right',
			cell: helper => (
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:bg-brand-green-50 hover:text-brand-green"
						title="Change college or date"
						onClick={() => {
							setAdding(false)
							setEditing({
								id: helper.id,
								institutionId: helper.institution_id,
								// An ended grant is given a fresh week rather than a past date
								until: helper.is_expired ? dayAfter(7) : helper.expires_on,
								name: helper.display_name || helper.email,
								email: helper.email,
							})
						}}
					>
						<Pencil className="h-3.5 w-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:bg-red-50 hover:text-red-600"
						title="Remove this helper"
						onClick={() => setRemoving(helper)}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</div>
			),
		},
	// eslint-disable-next-line react-hooks/exhaustive-deps
	], [colleges])

	return (
		<Card className="flex-shrink-0">
			<CardContent className="p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2 min-w-0">
						<ShieldCheck className="h-4 w-4 shrink-0 text-brand-green dark:text-brand-green-400" />
						<div className="min-w-0">
							<p className="text-sm font-medium">Stock check helpers</p>
							<p className="text-xs text-muted-foreground">
								{loading && helpers.length === 0
									? 'Reading the list…'
									: live.length === 0
										? institutionId
											? 'Nobody outside the library can scan this college right now'
											: 'All Institutions — nobody is assigned to any college right now'
										: institutionId
											? `${live.length} ${live.length === 1 ? 'person' : 'people'} can scan this college until their date runs out`
											: `All Institutions — ${live.length} ${live.length === 1 ? 'assignment' : 'assignments'} across the colleges`}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<StockCheckHelpersBulk
							institutionId={institutionId}
							institutionCode={codeOf(institutionId)}
							colleges={colleges.map(college => college.institution_code)}
							onDone={load}
						/>
						<Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
							<Users className="mr-1.5 h-3.5 w-3.5" />
							Manage
						</Button>
					</div>
				</div>

			</CardContent>

			{/* The list itself, in a window of its own: a table to sort, search
			    and page through, with adding and changing above it */}
			<Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) { setEditing(null); setAdding(false) } }}>
				<DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 p-0">
					<DialogHeader className="border-b px-5 py-4">
						<DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
							<ShieldCheck className="h-4 w-4 text-brand-green" />
							Stock check helpers
							<Badge variant="outline" className="font-normal">
								{institutionId ? codeOf(institutionId) || 'This college' : 'All Institutions'}
							</Badge>
						</DialogTitle>
						<DialogDescription>
							They get the Stock Check page and nothing else, until their date. Change the college or the date with the pencil, take them off with the bin.
						</DialogDescription>
						{/* At a glance */}
						<div className="flex flex-wrap items-center gap-2 pt-2">
							<span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green px-3 py-1 text-xs font-medium text-white">
								<Users className="h-3.5 w-3.5" />
								{helpers.length} in all
							</span>
							<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
								<CheckCircle2 className="h-3.5 w-3.5" />
								{live.length} active
							</span>
							<span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
								<Clock className="h-3.5 w-3.5" />
								{helpers.length - live.length} ended
							</span>
							<div className="ml-auto flex items-center gap-2">
								{institutionId && (
									<Button
										size="sm"
										className="h-8 bg-brand-green text-white hover:bg-brand-green-600"
										onClick={() => { setAdding(v => !v); setEditing(null) }}
									>
										<UserPlus className="mr-1.5 h-3.5 w-3.5" />
										{adding ? 'Close' : 'Add a helper'}
									</Button>
								)}
								<StockCheckHelpersBulk
									institutionId={institutionId}
									institutionCode={codeOf(institutionId)}
									colleges={colleges.map(college => college.institution_code)}
									onDone={load}
								/>
							</div>
						</div>
					</DialogHeader>

					<div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
						{setupError ? (
							<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
								<span>{setupError}</span>
							</div>
						) : (
							<>
								{/* Changing one helper */}
								{editing && (
									<div className="space-y-2 rounded-lg border-2 border-brand-green/40 bg-brand-green-50/50 p-3 dark:bg-brand-green-900/10">
										<p className="flex items-center gap-2 text-sm font-medium">
											<Pencil className="h-3.5 w-3.5 text-brand-green" />
											Change {editing.name}
											<span className="text-xs font-normal text-muted-foreground">{editing.email}</span>
										</p>
										<div className="flex flex-wrap items-end gap-2">
											<div className="space-y-1">
												<label className="text-xs text-muted-foreground">Scans at</label>
												<Select
													value={editing.institutionId}
													onValueChange={value => setEditing({ ...editing, institutionId: value })}
												>
													<SelectTrigger className="h-9 w-32 bg-background text-sm">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{colleges.map(college => (
															<SelectItem key={college.id} value={college.id}>
																{college.institution_code}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="space-y-1">
												<label className="text-xs text-muted-foreground">Can scan until</label>
												<Input
													type="date"
													value={editing.until}
													min={dayAfter(0)}
													max={dayAfter(MAX_DAYS)}
													onChange={e => setEditing({ ...editing, until: e.target.value })}
													className="h-9 w-44 bg-background text-sm"
												/>
											</div>
											<Button size="sm" className="h-9" disabled={!editing.until || updating} onClick={change}>
												{updating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
												Save
											</Button>
											<Button variant="ghost" size="sm" className="h-9" disabled={updating} onClick={() => setEditing(null)}>
												Cancel
											</Button>
										</div>
									</div>
								)}

								{/* Adding one */}
								{adding && institutionId && (
									<div className="space-y-2 rounded-lg border-2 border-dashed border-brand-green/40 p-3">
										<p className="flex items-center gap-2 text-sm font-medium">
											<UserPlus className="h-3.5 w-3.5 text-brand-green" />
											Add a helper to {codeOf(institutionId) || 'this college'}
										</p>

										{picked ? (
											<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
												<div className="min-w-0">
													<p className="truncate text-sm font-medium">
														{picked.display_name}
														<span className="ml-2 font-mono text-xs text-muted-foreground">
															{picked.member_number}
														</span>
													</p>
													<p className="truncate text-xs text-muted-foreground">
														{codeOf(picked.institution_id) ? codeOf(picked.institution_id) + ' · ' : ''}
														{picked.email} · {picked.role_label}
													</p>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7"
													title="Pick somebody else"
													onClick={() => setPicked(null)}
												>
													<X className="h-3.5 w-3.5" />
												</Button>
											</div>
										) : (
											<>
												<div className="flex flex-wrap items-center gap-2">
													<Select value={searchCollege} onValueChange={setSearchCollege}>
														<SelectTrigger className="h-9 w-[170px] text-sm">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="all">All colleges</SelectItem>
															{colleges.map(college => (
																<SelectItem key={college.id} value={college.id}>
																	{college.institution_code}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<div className="relative min-w-0 flex-1 basis-56">
														<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
														<Input
															ref={searchRef}
															value={search}
															onChange={e => setSearch(e.target.value)}
															placeholder="Search MyJKKN by name or ID"
															className="h-9 pl-8 text-sm"
														/>
														{searching && (
															<Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
														)}
													</div>
												</div>

												{search.trim().length >= 2 && !searching && results.length === 0 && (
													<p className="text-xs text-muted-foreground">Nobody matches that</p>
												)}

												{results.length > 0 && (
													<div className="max-h-56 space-y-1 overflow-y-auto">
														{results.map(person => (
															<button
																key={person.myjkkn_id}
																type="button"
																// Somebody MyJKKN holds no address for could never be
																// signed in, so they cannot be offered as a helper.
																disabled={!person.email}
																onClick={() => setPicked(person)}
																className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-brand-green-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-brand-green-900/20"
															>
																<span className="min-w-0">
																	<span className="block truncate font-medium">
																		{person.display_name}
																		<span className="ml-2 font-mono text-xs text-muted-foreground">
																			{person.member_number}
																		</span>
																	</span>
																	<span className="block truncate text-xs text-muted-foreground">
																		{codeOf(person.institution_id) ? codeOf(person.institution_id) + ' · ' : ''}
																		{person.email || 'No email in MyJKKN — cannot sign in'}
																	</span>
																</span>
																<UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
															</button>
														))}
													</div>
												)}
											</>
										)}

										<div className="flex flex-wrap items-end gap-2">
											<div className="space-y-1">
												<label className="text-xs text-muted-foreground">Can scan until</label>
												<Input
													type="date"
													value={until}
													min={dayAfter(0)}
													max={dayAfter(MAX_DAYS)}
													onChange={e => setUntil(e.target.value)}
													className="h-9 w-44 text-sm"
												/>
											</div>
											<Button
												size="sm"
												className="h-9"
												disabled={!picked || !until || saving}
												onClick={add}
											>
												{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}
												Add helper
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											They sign in with Google through MyJKKN as everyone else does. Somebody who runs their own college&apos;s library keeps it — this is added to what they already have.
										</p>
									</div>
								)}

								{/* Who is in */}
								<StockCheckTable
									rows={helpers}
									rowKey={helper => helper.id}
									columns={helperColumns}
									searchText={helper => [
										helper.display_name, helper.email, helper.member_number,
										helper.member_college_code, codeOf(helper.institution_id), helper.created_by_name,
									].filter(Boolean).join(' ')}
									searchPlaceholder="Search name, email, staff ID or college"
									facet={HELPER_FACET}
									rowTone={helper => helper.is_expired ? 'border-l-muted-foreground/30 opacity-70' : 'border-l-emerald-500'}
									empty={loading ? 'Reading the list…' : 'No helpers yet — add one, or use Bulk assign'}
									loading={loading}
									canExport
									exportName={`stock-check-helpers-${(codeOf(institutionId) || 'all').toLowerCase()}`}
									sheetName="Helpers"
									defaultSort={{ key: 'until', dir: 'desc' }}
									pageSizes={['25', '50', '100', '250', 'all']}
								/>
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove this helper?</AlertDialogTitle>
						<AlertDialogDescription>
							{removing?.display_name || removing?.email} will not be able to open the Stock Check page from their next sign-in. Scans they have already made stay in the round.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep them</AlertDialogCancel>
						<AlertDialogAction onClick={() => removing && remove(removing)}>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	)
}
