'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
	BookOpen, BookMarked, ArrowLeftRight, AlertTriangle,
	Users, IndianRupee, Plus, RotateCcw, Search, RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import type { LibNaacCriterion4Report } from '@/types/lib'

/** What `/api/lib/dashboard` answers: the figures that are about right now. */
interface DashboardLive {
	on_loan_now: number
	overdue: number
	pending_charges_amount: number
	pending_charges_count: number
}

const rupees = (amount: number) =>
	`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/**
 * One scorecard, and the page it stands for.
 *
 * Every card opens the list behind its number — the count of overdue books
 * opens the overdue books — so the dashboard is a way in, not only a glance.
 */
function StatCard({
	href,
	value,
	label,
	detail,
	icon,
	accent,
}: {
	href: string
	value: ReactNode
	label: string
	detail?: string
	icon: ReactNode
	accent: string
}) {
	return (
		<Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<Card className={`h-full border-l-4 ${accent} cursor-pointer hover:shadow-md transition-shadow`}>
				<CardContent className="p-4">
					<div className="flex items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="text-2xl font-bold tracking-tight">{value}</p>
							<p className="text-xs font-medium text-muted-foreground mt-0.5">{label}</p>
							{detail && <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{detail}</p>}
						</div>
						{icon}
					</div>
				</CardContent>
			</Card>
		</Link>
	)
}

export default function LibDashboard() {
	const { isReady, appendToUrl, mustSelectInstitution } = useInstitutionFilter()
	const { toast } = useToast()
	const [stats, setStats] = useState<LibNaacCriterion4Report | null>(null)
	const [live, setLive] = useState<DashboardLive | null>(null)
	const [loading, setLoading] = useState(true)

	// No institution means "All Institutions", which both reads answer with
	// every college's figures added together — so this does not wait for one
	// to be chosen. The NAAC report and the live figures do not depend on each
	// other, so they are asked for together; either one failing leaves the
	// other's cards filled in.
	const fetchStats = useCallback(async () => {
		if (!isReady) return
		setLoading(true)
		const [naac, current] = await Promise.allSettled([
			fetch(appendToUrl('/api/lib/reports/naac')).then(res => {
				if (!res.ok) throw new Error('naac')
				return res.json() as Promise<LibNaacCriterion4Report>
			}),
			fetch(appendToUrl('/api/lib/dashboard')).then(res => {
				if (!res.ok) throw new Error('live')
				return res.json() as Promise<DashboardLive>
			}),
		])
		if (naac.status === 'fulfilled') setStats(naac.value)
		if (current.status === 'fulfilled') setLive(current.value)
		if (naac.status === 'rejected' || current.status === 'rejected') {
			toast({ title: 'Some dashboard figures could not be loaded', variant: 'destructive' })
		}
		setLoading(false)
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchStats() }, [fetchStats])

	/** A number while it is being read, and a dash only for one that could not be. */
	const show = (value: number | undefined, format: (n: number) => ReactNode = n => n.toLocaleString('en-IN')) =>
		loading ? '—' : value === undefined ? '—' : format(value)

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Page Header */}
			<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold">Library Dashboard</h1>
					<p className="text-xs text-muted-foreground">JKKN Learning Commons — at a glance</p>
				</div>
				<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchStats} disabled={loading}>
					<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/* Says what the figures below cover, rather than refusing to show them */}
			{isReady && mustSelectInstitution && (
				<Card className="border-dashed border-2 bg-muted/30">
					<CardContent className="p-4 text-center">
						<p className="text-sm font-medium">Showing every college together</p>
						<p className="text-xs text-muted-foreground mt-1">
							Pick one in the institution switcher to see it on its own
						</p>
					</CardContent>
				</Card>
			)}

			{/* Scorecard Grid — 2 rows of 3, each one opening the list behind it */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 flex-shrink-0">
				<StatCard
					href="/registry"
					value={show(stats?.total_titles)}
					label="Total Titles"
					icon={<BookOpen className="h-5 w-5 shrink-0 text-blue-500/40" />}
					accent="border-l-blue-500"
				/>
				<StatCard
					href="/registry"
					value={show(stats?.total_volumes)}
					label="Total Volumes"
					icon={<BookMarked className="h-5 w-5 shrink-0 text-indigo-500/40" />}
					accent="border-l-indigo-500"
				/>
				<StatCard
					href="/reports?tab=circulation&report=circ-open"
					value={show(live?.on_loan_now)}
					label="On Loan Now"
					detail="Books out with members right now"
					icon={<ArrowLeftRight className="h-5 w-5 shrink-0 text-emerald-500/40" />}
					accent="border-l-emerald-500"
				/>
				<StatCard
					href="/circulation/overdue"
					value={show(live?.overdue)}
					label="Overdue Items"
					detail="Past their due date"
					icon={<AlertTriangle className="h-5 w-5 shrink-0 text-rose-500/40" />}
					accent="border-l-rose-500"
				/>
				<StatCard
					href="/members"
					value={show(stats?.active_members)}
					label="Active Members"
					icon={<Users className="h-5 w-5 shrink-0 text-purple-500/40" />}
					accent="border-l-purple-500"
				/>
				<StatCard
					href="/circulation/charges"
					value={show(live?.pending_charges_amount, rupees)}
					label="Pending Charges"
					detail={live && !loading
						? `${live.pending_charges_count} charge${live.pending_charges_count === 1 ? '' : 's'} unpaid`
						: undefined}
					icon={<IndianRupee className="h-5 w-5 shrink-0 text-amber-500/40" />}
					accent="border-l-amber-500"
				/>
			</div>

			{/* Quick Actions */}
			<div className="flex-shrink-0">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<Link href="/circulation?tab=issue">
						<Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500 hover:border-l-blue-600">
							<CardContent className="p-4 flex items-center gap-3">
								<div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
									<Plus className="h-5 w-5 text-blue-600" />
								</div>
								<div>
									<p className="font-semibold text-sm">Issue Resource</p>
									<p className="text-xs text-muted-foreground">Issue an item to a member</p>
								</div>
							</CardContent>
						</Card>
					</Link>

					<Link href="/circulation?tab=return">
						<Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-emerald-500 hover:border-l-emerald-600">
							<CardContent className="p-4 flex items-center gap-3">
								<div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
									<RotateCcw className="h-5 w-5 text-emerald-600" />
								</div>
								<div>
									<p className="font-semibold text-sm">Return Resource</p>
									<p className="text-xs text-muted-foreground">Process a resource return</p>
								</div>
							</CardContent>
						</Card>
					</Link>

					<Link href="/opac">
						<Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-purple-500 hover:border-l-purple-600">
							<CardContent className="p-4 flex items-center gap-3">
								<div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
									<Search className="h-5 w-5 text-purple-600" />
								</div>
								<div>
									<p className="font-semibold text-sm">Search Catalogue</p>
									<p className="text-xs text-muted-foreground">Browse the OPAC</p>
								</div>
							</CardContent>
						</Card>
					</Link>
				</div>
			</div>

			{/* NAAC Summary — only show when data is loaded */}
			{stats && (
				<Card className="flex-shrink-0">
					<CardHeader className="px-4 py-3 border-b">
						<h2 className="text-base font-semibold">NAAC Criterion 4.2 — This Year</h2>
					</CardHeader>
					<CardContent className="px-4 py-4">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-sm">
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Volumes Added</p>
								<p className="font-semibold text-lg">{stats.volumes_added_this_year}</p>
							</div>
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Print Journals</p>
								<p className="font-semibold text-lg">{stats.print_journals_subscribed}</p>
							</div>
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Digital Resources</p>
								<p className="font-semibold text-lg">{stats.digital_resources_count}</p>
							</div>
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Annual Visits</p>
								<p className="font-semibold text-lg">{stats.total_annual_visits}</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
