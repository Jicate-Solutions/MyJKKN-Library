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

import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { UserPlus, Search, X, Loader2, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react'

interface Helper {
	id: string
	email: string
	display_name: string | null
	member_number: string | null
	myjkkn_id: string | null
	expires_on: string
	created_by_name: string | null
	is_expired: boolean
}

interface Candidate {
	myjkkn_id: string
	member_number: string
	display_name: string
	email: string | null
	role_label: string
}

/** A helper is let in for the counting, not for the year. */
const MAX_DAYS = 120

const dayAfter = (days: number) =>
	new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const readable = (day: string) =>
	day ? new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export function StockCheckHelpers({ institutionId }: { institutionId: string }) {
	const { toast } = useToast()

	const [open, setOpen] = useState(false)
	const [helpers, setHelpers] = useState<Helper[]>([])
	const [loading, setLoading] = useState(false)
	const [setupError, setSetupError] = useState<string | null>(null)

	const [search, setSearch] = useState('')
	const [results, setResults] = useState<Candidate[]>([])
	const [searching, setSearching] = useState(false)
	const [picked, setPicked] = useState<Candidate | null>(null)
	// A week of counting is the usual answer, so it is already filled in.
	const [until, setUntil] = useState(dayAfter(7))
	const [saving, setSaving] = useState(false)
	const [removing, setRemoving] = useState<Helper | null>(null)

	const searchRef = useRef<HTMLInputElement>(null)

	const load = useCallback(async () => {
		if (!institutionId) return
		try {
			setLoading(true)
			const res = await fetch(`/api/lib/stock/helpers?institution_id=${institutionId}`)
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
				const res = await fetch(
					`/api/lib/members?institution_id=${institutionId}&search=${encodeURIComponent(term)}`
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
	}, [search, institutionId])

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

	const live = helpers.filter(h => !h.is_expired)

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
										? 'Nobody outside the library can scan this college right now'
										: `${live.length} ${live.length === 1 ? 'person' : 'people'} can scan this college until their date runs out`}
							</p>
						</div>
					</div>
					<Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(v => !v)}>
						{open ? 'Done' : 'Manage'}
					</Button>
				</div>

				{open && (
					<div className="mt-4 space-y-4 border-t pt-4">
						{setupError ? (
							<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
								<span>{setupError}</span>
							</div>
						) : (
							<>
								{/* Who is already in */}
								{helpers.length === 0 ? (
									<p className="text-xs text-muted-foreground">
										No helpers yet. Anybody added here gets the Stock Check page and nothing else, until the date you choose.
									</p>
								) : (
									<div className="space-y-2">
										{helpers.map(helper => (
											<div
												key={helper.id}
												className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
											>
												<div className="min-w-0">
													<p className="truncate text-sm font-medium">
														{helper.display_name || helper.email}
														{helper.member_number && (
															<span className="ml-2 font-mono text-xs text-muted-foreground">
																{helper.member_number}
															</span>
														)}
													</p>
													<p className="truncate text-xs text-muted-foreground">{helper.email}</p>
												</div>
												<div className="flex items-center gap-2">
													{helper.is_expired ? (
														<Badge variant="outline" className="text-xs font-normal text-muted-foreground">
															Ended {readable(helper.expires_on)}
														</Badge>
													) : (
														<Badge
															variant="outline"
															className="border-brand-green/40 text-xs font-normal text-brand-green"
														>
															Until {readable(helper.expires_on)}
														</Badge>
													)}
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7 text-muted-foreground hover:text-red-600"
														title="Remove this helper"
														onClick={() => setRemoving(helper)}
													>
														<Trash2 className="h-3.5 w-3.5" />
													</Button>
												</div>
											</div>
										))}
									</div>
								)}

								{/* Add one more */}
								<div className="space-y-2 rounded-md border border-dashed p-3">
									<p className="text-xs font-medium">Add a helper</p>

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
											<div className="relative">
												<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
												<Input
													ref={searchRef}
													value={search}
													onChange={e => setSearch(e.target.value)}
													placeholder="Search this college by name or ID"
													className="h-9 pl-8 text-sm"
												/>
												{searching && (
													<Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
												)}
											</div>

											{search.trim().length >= 2 && !searching && results.length === 0 && (
												<p className="text-xs text-muted-foreground">
													Nobody in this college matches that
												</p>
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
															className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
														>
															<span className="min-w-0">
																<span className="block truncate font-medium">
																	{person.display_name}
																	<span className="ml-2 font-mono text-xs text-muted-foreground">
																		{person.member_number}
																	</span>
																</span>
																<span className="block truncate text-xs text-muted-foreground">
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
										They sign in with Google through MyJKKN exactly as everyone else does. This opens the Stock Check page for them and nothing else — they can scan into a round somebody else started, and that is all.
									</p>
								</div>
							</>
						)}
					</div>
				)}
			</CardContent>

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
