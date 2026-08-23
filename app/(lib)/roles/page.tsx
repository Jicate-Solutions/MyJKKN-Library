'use client'

/**
 * Role Management — which pages each role may open.
 *
 * MyJKKN says what somebody is. This screen says what that role gets to see
 * inside the library: a super admin ticks the pages, and the menu, the mobile
 * navbar and the page guard all follow.
 *
 * Super admin only. The API enforces the same rule on every verb, so typing
 * this URL gains nothing.
 *
 * Two things this screen deliberately does not do:
 *
 *   * It never touches which college's records anybody sees. A librarian given
 *     every page still sees only their own campus — that is decided elsewhere
 *     and a tick here cannot widen it.
 *   * It does not offer ticks it could not honour. A page fixed in code shows
 *     its reason instead of a checkbox, because a tick that changes nothing is
 *     worse than no tick at all.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@/hooks/common/use-toast'
import { refreshLibraryRole } from '@/hooks/use-library-role'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	UserCog, Lock, RefreshCw, Save, RotateCcw, ShieldCheck, LayoutGrid, Info,
} from 'lucide-react'

interface CataloguePage {
	title: string
	url: string
}

interface CatalogueGroup {
	label: string
	pages: CataloguePage[]
}

interface PageLock {
	state: 'on' | 'off'
	reason: string
}

interface RoleConfig {
	role: string
	label: string
	pages: string[]
	is_default: boolean
	locks: Record<string, PageLock>
}

export default function RoleManagementPage() {
	const { toast } = useToast()

	const [catalogue, setCatalogue] = useState<CatalogueGroup[]>([])
	const [roles, setRoles] = useState<RoleConfig[]>([])
	const [activeRole, setActiveRole] = useState<string | null>(null)
	const [draft, setDraft] = useState<Record<string, string[]>>({})
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [confirmReset, setConfirmReset] = useState(false)

	const fetchData = useCallback(async () => {
		try {
			setLoading(true)
			setForbidden(null)
			const res = await fetch('/api/lib/access/role-pages')
			const json = await res.json()

			if (!res.ok) {
				// 403 is a normal outcome here, not a crash — show it plainly
				setForbidden(json.error || 'You do not have permission to view this page')
				return
			}

			setCatalogue(json.catalogue || [])
			setRoles(json.roles || [])
			setDraft(Object.fromEntries((json.roles || []).map((r: RoleConfig) => [r.role, r.pages])))
			setActiveRole(prev => prev ?? (json.roles?.[0]?.role ?? null))
		} catch {
			toast({ title: '❌ Failed to load role settings', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [toast])

	useEffect(() => { fetchData() }, [fetchData])

	const current = useMemo(
		() => roles.find(r => r.role === activeRole) ?? null,
		[roles, activeRole]
	)

	const chosen = useMemo(
		() => new Set(activeRole ? draft[activeRole] ?? [] : []),
		[draft, activeRole]
	)

	/** Unsaved work, so the Save button can say so and the tabs can warn. */
	const dirtyRoles = useMemo(() => {
		const out = new Set<string>()
		for (const role of roles) {
			const a = [...(draft[role.role] ?? [])].sort().join('|')
			const b = [...role.pages].sort().join('|')
			if (a !== b) out.add(role.role)
		}
		return out
	}, [roles, draft])

	const isDirty = activeRole ? dirtyRoles.has(activeRole) : false

	const togglePage = (url: string, on: boolean) => {
		if (!activeRole) return
		setDraft(prev => {
			const next = new Set(prev[activeRole] ?? [])
			if (on) next.add(url)
			else next.delete(url)
			return { ...prev, [activeRole]: [...next] }
		})
	}

	/** The pages in a group this role is actually allowed to be asked about. */
	const togglableIn = useCallback(
		(group: CatalogueGroup) => group.pages.filter(p => !current?.locks[p.url]),
		[current]
	)

	const toggleGroup = (group: CatalogueGroup, on: boolean) => {
		if (!activeRole) return
		const urls = togglableIn(group).map(p => p.url)
		setDraft(prev => {
			const next = new Set(prev[activeRole] ?? [])
			urls.forEach(u => (on ? next.add(u) : next.delete(u)))
			return { ...prev, [activeRole]: [...next] }
		})
	}

	const save = async () => {
		if (!activeRole) return
		try {
			setSaving(true)
			const res = await fetch('/api/lib/access/role-pages', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: activeRole, pages: draft[activeRole] ?? [] }),
			})
			const json = await res.json()
			if (!res.ok) throw new Error(json.error || 'Could not save')

			setRoles(prev => prev.map(r =>
				r.role === activeRole ? { ...r, pages: json.pages, is_default: false } : r
			))
			setDraft(prev => ({ ...prev, [activeRole]: json.pages }))

			// Whoever is looking at this screen may hold the role they just
			// changed on another tab; drop the cached answer so the next page
			// load asks again rather than drawing yesterday's menu.
			refreshLibraryRole()

			toast({
				title: '✅ Saved',
				description: `${current?.label} now sees ${json.pages.length} page${json.pages.length === 1 ? '' : 's'}.`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Could not save'),
				variant: 'destructive',
			})
		} finally {
			setSaving(false)
		}
	}

	const resetToDefault = async () => {
		if (!activeRole) return
		try {
			setSaving(true)
			const res = await fetch(`/api/lib/access/role-pages?role=${activeRole}`, { method: 'DELETE' })
			const json = await res.json()
			if (!res.ok) throw new Error(json.error || 'Could not reset')

			setRoles(prev => prev.map(r =>
				r.role === activeRole ? { ...r, pages: json.pages, is_default: true } : r
			))
			setDraft(prev => ({ ...prev, [activeRole]: json.pages }))
			refreshLibraryRole()

			toast({
				title: '✅ Back to the default',
				description: `${current?.label} sees everything the library gives that role.`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Could not reset'),
				variant: 'destructive',
			})
		} finally {
			setSaving(false)
			setConfirmReset(false)
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

	if (loading) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<div className="flex flex-col items-center gap-2 text-muted-foreground">
					<RefreshCw className="h-5 w-5 animate-spin" />
					<span className="text-sm">Loading role settings…</span>
				</div>
			</div>
		)
	}

	const totalPages = catalogue.reduce((n, g) => n + g.pages.length, 0)

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
				{/* Which role is being edited */}
				<Card className="flex-shrink-0">
					<CardHeader className="px-4 py-3 border-b">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold font-heading flex items-center gap-2">
									<UserCog className="h-4 w-4 text-brand-green dark:text-brand-green-400" />
									Role Management
								</h2>
								<p className="text-xs text-muted-foreground">
									Pick a role, then tick the pages it may open · a super admin is never restricted
								</p>
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
										<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
						</div>
					</CardHeader>

					<CardContent className="p-3">
						<div className="grid gap-2 sm:grid-cols-3">
							{roles.map(role => {
								const isActive = role.role === activeRole
								const count = (draft[role.role] ?? []).length
								return (
									<button
										key={role.role}
										type="button"
										onClick={() => setActiveRole(role.role)}
										className={
											'rounded-lg border p-3 text-left transition-colors ' +
											(isActive
												? 'border-brand-green bg-brand-green-50 dark:border-brand-green-400 dark:bg-brand-green-900/20'
												: 'hover:bg-muted/50')
										}
									>
										<div className="flex items-center justify-between gap-2">
											<span className={
												'text-sm font-semibold font-heading ' +
												(isActive ? 'text-brand-green-800 dark:text-brand-green-300' : '')
											}>
												{role.label}
											</span>
											{dirtyRoles.has(role.role) && (
												<Badge variant="outline" className="text-[10px] border-brand-yellow-400 text-brand-yellow-800 dark:text-brand-yellow-500">
													Unsaved
												</Badge>
											)}
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{count} of {totalPages} pages
											{role.is_default && !dirtyRoles.has(role.role) && ' · default'}
										</p>
									</button>
								)
							})}
						</div>
					</CardContent>
				</Card>

				{/* The pages themselves */}
				{current && (
					<Card className="flex-1 flex flex-col min-h-0">
						<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="min-w-0">
									<h3 className="text-sm font-semibold font-heading flex items-center gap-2">
										<LayoutGrid className="h-4 w-4 text-brand-green dark:text-brand-green-400" />
										What {current.label} sees
									</h3>
									<p className="text-xs text-muted-foreground">
										{chosen.size} page{chosen.size === 1 ? '' : 's'} ticked
										{current.is_default && !isDirty && ' · nothing has been changed from the default'}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										className="h-8 text-xs"
										onClick={() => setConfirmReset(true)}
										disabled={saving || (current.is_default && !isDirty)}
									>
										<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
										Reset to default
									</Button>
									<Button
										size="sm"
										className="h-8 text-xs bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
										onClick={save}
										disabled={saving || !isDirty}
									>
										<Save className="mr-1.5 h-3.5 w-3.5" />
										{saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
									</Button>
								</div>
							</div>
						</CardHeader>

						<CardContent className="p-4 flex-1 overflow-y-auto">
							<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
								{catalogue.map(group => {
									const togglable = togglableIn(group)
									const allOn = togglable.length > 0 && togglable.every(p => chosen.has(p.url))
									const someOn = togglable.some(p => chosen.has(p.url))

									return (
										<div key={group.label} className="rounded-lg border overflow-hidden">
											<div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2">
												<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
													{group.label}
												</span>
												{togglable.length > 0 && (
													<button
														type="button"
														onClick={() => toggleGroup(group, !allOn)}
														className="text-[11px] font-medium text-brand-green hover:underline dark:text-brand-green-400"
													>
														{allOn ? 'Clear all' : someOn ? 'Select all' : 'Select all'}
													</button>
												)}
											</div>
											<Separator />
											<div className="divide-y">
												{group.pages.map(page => {
													const lock = current.locks[page.url]
													const on = lock ? lock.state === 'on' : chosen.has(page.url)

													return (
														<label
															key={page.url}
															className={
																'flex items-start gap-3 px-3 py-2.5 ' +
																(lock ? 'cursor-default bg-muted/20' : 'cursor-pointer hover:bg-muted/40')
															}
														>
															<Checkbox
																checked={on}
																disabled={!!lock}
																onCheckedChange={value => togglePage(page.url, value === true)}
																className="mt-0.5"
															/>
															<span className="min-w-0 flex-1">
																<span className="block text-sm font-medium leading-tight">
																	{page.title}
																</span>
																<span className="block text-[11px] text-muted-foreground">
																	{page.url}
																</span>
																{lock && (
																	<span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
																		<Lock className="h-3 w-3" />
																		{lock.reason}
																	</span>
																)}
															</span>
														</label>
													)
												})}
											</div>
										</div>
									)
								})}
							</div>

							<div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
								<Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
								<span>
									This decides which <strong>pages</strong> a role opens, nothing else. Which
									college&apos;s records they see is separate and unchanged — a librarian given
									every page here still sees only their own campus. Roles themselves are still
									set in MyJKKN.
								</span>
							</div>
						</CardContent>
					</Card>
				)}

				<AlertDialog open={confirmReset} onOpenChange={o => { if (!o && !saving) setConfirmReset(false) }}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle className="font-heading">Reset to the default</AlertDialogTitle>
							<AlertDialogDescription>
								{current && (
									<>
										<strong>{current.label}</strong> goes back to every page the library gives
										that role — the way it behaved before anybody changed it. Whatever is
										ticked now is forgotten.
									</>
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={e => { e.preventDefault(); resetToDefault() }}
								disabled={saving}
								className="bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
							>
								{saving ? 'Resetting…' : 'Reset'}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* Nothing to configure should never happen, but a blank page is worse */}
				{!current && !loading && (
					<Card className="flex-1">
						<CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
							<ShieldCheck className="h-8 w-8 opacity-20" />
							<span className="text-sm">No configurable roles</span>
						</CardContent>
					</Card>
				)}
			</div>
		</TooltipProvider>
	)
}
