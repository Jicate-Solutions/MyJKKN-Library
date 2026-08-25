'use client'

/**
 * Staff Access — who may sign in to the library system.
 *
 * A report, not a control panel. Roles belong to MyJKKN now: this project keeps
 * none of its own, so nothing can be granted or taken away here. The screen
 * lists the MyJKKN staff who hold one of the four library roles, so a super
 * admin can see at a glance who has access and to which college, and go and fix
 * it in MyJKKN if that is wrong.
 *
 * Super admin only. The API enforces the same rule, so typing this URL gains
 * nothing — anyone else lands on the "access restricted" card below.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ShieldCheck, Search, RefreshCw, Lock, Users, Eye } from 'lucide-react'

type LibraryRole = 'super_admin' | 'library_admin' | 'librarian' | 'assistant_librarian' | 'member'

interface StaffUser {
	id: string
	email: string
	full_name: string | null
	role: string | null
	is_super_admin: boolean
	is_active: boolean
	institution_id: string | null
	last_login: string | null
	assigned_roles: string[]
	effective_role: string
	/** 'grant' means a temporary grant in the environment, not a MyJKKN role. */
	access_source?: 'myjkkn' | 'grant'
	/** The last day that grant works, 'YYYY-MM-DD'. */
	grant_expires_on?: string | null
}

/** '2026-09-25' reads better as '25 Sep 2026' on a screen meant to be scanned. */
function readableDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const ROLE_LABEL: Record<string, string> = {
	super_admin: 'Super Admin',
	library_admin: 'Library Admin',
	librarian: 'Librarian',
	assistant_librarian: 'Assistant Librarian',
	member: 'Member',
}

const ROLE_STYLE: Record<string, string> = {
	super_admin: 'bg-brand-green-100 text-brand-green-800 border-brand-green-300 dark:bg-brand-green-900/30 dark:text-brand-green-300 dark:border-brand-green-700',
	library_admin: 'bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/20 dark:text-brand-green-400 dark:border-brand-green-800',
	librarian: 'bg-brand-yellow-100 text-brand-yellow-900 border-brand-yellow-300 dark:bg-brand-yellow-900/20 dark:text-brand-yellow-500 dark:border-brand-yellow-800',
	assistant_librarian: 'bg-muted text-muted-foreground border-border',
	member: 'bg-muted text-muted-foreground border-border',
}

function initials(name: string | null, email: string): string {
	const source = name?.trim() || email
	return source.split(/[\s@.]+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

export default function StaffAccessPage() {
	const { isReady, institutionId } = useInstitutionFilter()
	const { toast } = useToast()

	const [users, setUsers] = useState<StaffUser[]>([])
	const [callerRole, setCallerRole] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [viewingAs, setViewingAs] = useState<StaffUser | null>(null)
	const [switching, setSwitching] = useState(false)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setForbidden(null)
			const url = institutionId
				? `/api/lib/access/users?institution_id=${institutionId}`
				: '/api/lib/access/users'
			const res = await fetch(url)
			const json = await res.json()

			if (!res.ok) {
				// 401/403 is a normal outcome here, not a crash — show it plainly
				setForbidden(json.error || 'You do not have permission to view this page')
				setUsers([])
				return
			}

			setUsers(json.data || [])
			setCallerRole(json.caller?.role ?? null)
		} catch {
			toast({ title: 'Failed to load staff accounts', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, toast])

	useEffect(() => { fetchData() }, [fetchData])

	const filtered = useMemo(() => {
		if (!search) return users
		const q = search.toLowerCase()
		return users.filter(u =>
			(u.full_name?.toLowerCase().includes(q) ?? false) ||
			u.email.toLowerCase().includes(q) ||
			u.effective_role.toLowerCase().includes(q)
		)
	}, [users, search])

	const counts = useMemo(() => ({
		total: users.length,
		staff: users.filter(u => ['super_admin', 'library_admin', 'librarian', 'assistant_librarian'].includes(u.effective_role)).length,
	}), [users])


	const startViewingAs = async () => {
		if (!viewingAs) return
		try {
			setSwitching(true)
			const res = await fetch('/api/lib/access/impersonate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: viewingAs.id }),
			})
			const json = await res.json()
			if (!res.ok) throw new Error(json.error || 'Could not start')

			// Everything already on screen was rendered as you, so reload rather
			// than patch — the sidebar and every page must come back as them.
			window.location.href = '/'
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Could not start'),
				variant: 'destructive',
			})
			setSwitching(false)
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
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-brand-green dark:border-l-brand-green-400 hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-brand-green dark:text-brand-green-400">{counts.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Accounts</p>
							</div>
							<Users className="h-5 w-5 text-brand-green/40 dark:text-brand-green-400/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-brand-yellow hover-lift">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight font-heading text-brand-yellow-800 dark:text-brand-yellow-500">{counts.staff}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">With staff access</p>
							</div>
							<ShieldCheck className="h-5 w-5 text-brand-yellow-700/50 dark:text-brand-yellow-500/50" />
						</div>
					</CardContent>
				</Card>
			</div>

			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold font-heading">Staff Access</h2>
								<p className="text-xs text-muted-foreground">
									{filtered.length} account{filtered.length !== 1 ? 's' : ''}
									{callerRole && ` · you are ${ROLE_LABEL[callerRole] ?? callerRole}`}
									{' · '}roles are set in MyJKKN
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
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search name, email or role..."
									value={search}
									onChange={e => setSearch(e.target.value)}
									className="pl-8 h-8 text-sm"
								/>
							</div>
						</div>
					</CardHeader>

					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px]">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Name</TableHead>
											<TableHead className="text-xs font-semibold">Email</TableHead>
											<TableHead className="text-xs font-semibold">Library role</TableHead>
											<TableHead className="text-xs font-semibold w-[260px]">Their MyJKKN roles</TableHead>
											{callerRole === 'super_admin' && (
												<TableHead className="text-xs font-semibold w-[110px]">View as</TableHead>
											)}
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={5} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading accounts...</span>
													</div>
												</TableCell>
											</TableRow>
										) : filtered.length === 0 ? (
											<TableRow>
												<TableCell colSpan={5} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<ShieldCheck className="h-8 w-8 opacity-20" />
														<span className="text-sm">No accounts found</span>
													</div>
												</TableCell>
											</TableRow>
										) : filtered.map(u => {
											// The API refuses these too — this only keeps the UI honest
											const locked = u.is_super_admin && callerRole !== 'super_admin'
											return (
												<TableRow key={u.id} className="hover:bg-muted/50">
													<TableCell>
														<div className="flex items-center gap-2">
															<Avatar className="h-7 w-7">
																<AvatarFallback className="text-[10px] bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
																	{initials(u.full_name, u.email)}
																</AvatarFallback>
															</Avatar>
															<div>
																<div className="text-sm font-medium">{u.full_name ?? '—'}</div>
																{!u.is_active && (
																	<div className="text-[10px] text-destructive">
																		{u.access_source === 'grant' ? 'Grant expired' : 'Inactive'}
																	</div>
																)}
															</div>
														</div>
													</TableCell>
													<TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
													<TableCell>
														<Badge variant="outline" className={ROLE_STYLE[u.effective_role] ?? ROLE_STYLE.member}>
															{ROLE_LABEL[u.effective_role] ?? u.effective_role}
														</Badge>
													</TableCell>
													{/* Read-only. Roles are MyJKKN's — this screen reports
													    who holds one, and the change is made there. */}
													<TableCell>
														<div className="flex flex-wrap gap-1">
															{u.grant_expires_on && (
																// Temporary access from the environment, not a MyJKKN
																// role. Named plainly: a grant nobody can see is a
																// grant nobody remembers to take away.
																<Badge
																	variant="outline"
																	className="text-[10px] font-normal border-brand-yellow-400 text-brand-yellow-800 dark:text-brand-yellow-500"
																>
																	{u.is_active ? 'Temporary until ' : 'Expired '}
																	{readableDate(u.grant_expires_on)}
																</Badge>
															)}
															{(u.assigned_roles ?? []).length === 0 ? (
																!u.grant_expires_on && <span className="text-xs text-muted-foreground">—</span>
															) : (
																u.assigned_roles.map(r => (
																	<Badge
																		key={r}
																		variant="outline"
																		className="text-[10px] font-normal text-muted-foreground"
																	>
																		{ROLE_LABEL[r] ?? r}
																	</Badge>
																))
															)}
														</div>
													</TableCell>
													{callerRole === 'super_admin' && (
														<TableCell>
															{/* Viewing as somebody works off their MyJKKN staff
															    record, which a granted person does not have */}
															{u.access_source === 'grant' ? (
																<span className="text-xs text-muted-foreground">—</span>
															) : u.is_active ? (
																<Button
																	variant="outline"
																	size="sm"
																	className="h-8 text-xs"
																	onClick={() => setViewingAs(u)}
																>
																	<Eye className="h-3 w-3 mr-1" /> View as
																</Button>
															) : (
																<span className="text-xs text-muted-foreground">Inactive</span>
															)}
														</TableCell>
													)}
												</TableRow>
											)
										})}
									</TableBody>
								</Table>
							</div>
						</div>
					</CardContent>
				</Card>
			</TooltipProvider>

			<AlertDialog open={!!viewingAs} onOpenChange={o => { if (!o && !switching) setViewingAs(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">View as this user</AlertDialogTitle>
						<AlertDialogDescription>
							{viewingAs && (
								<>
									You will use the library exactly as{' '}
									<strong>{viewingAs.full_name ?? viewingAs.email}</strong> —
									their role, their institution, their limits — and anything you do
									will be a real action taken in their name.
									{' '}Every change is recorded against your own account.
								</>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={switching}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={e => { e.preventDefault(); startViewingAs() }}
							disabled={switching}
							className="bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
						>
							{switching ? 'Starting...' : 'Continue as them'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

		</div>
	)
}
