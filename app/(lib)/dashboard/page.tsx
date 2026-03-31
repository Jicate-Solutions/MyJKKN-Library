'use client'

import { useState, useEffect, useCallback } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
	BookOpen, BookMarked, ArrowLeftRight, AlertTriangle,
	Users, DollarSign, Plus, RotateCcw, Search, RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import type { LibNaacCriterion4Report } from '@/types/lib'

export default function LibDashboard() {
	const { isReady, appendToUrl, institutionId, mustSelectInstitution } = useInstitutionFilter()
	const { toast } = useToast()
	const [stats, setStats] = useState<LibNaacCriterion4Report | null>(null)
	const [loading, setLoading] = useState(true)

	const fetchStats = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/reports/naac')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to load stats')
			const data = await res.json()
			setStats(data)
		} catch {
			toast({ title: 'Failed to load dashboard stats', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, institutionId, appendToUrl, toast])

	useEffect(() => { fetchStats() }, [fetchStats])

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Page Header */}
			<div className="flex items-center justify-between pt-1">
				<div>
					<h1 className="text-lg font-semibold">Library Dashboard</h1>
					<p className="text-xs text-muted-foreground">JKKN Learning Commons — at a glance</p>
				</div>
				<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchStats} disabled={loading}>
					<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/* Institution selection prompt for super_admin */}
			{isReady && mustSelectInstitution && (
				<Card className="border-dashed border-2 bg-muted/30">
					<CardContent className="p-6 text-center">
						<Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
						<p className="text-sm font-medium">Select an institution to view dashboard statistics</p>
						<p className="text-xs text-muted-foreground mt-1">Use the institution switcher in the sidebar to choose one</p>
					</CardContent>
				</Card>
			)}

			{/* Scorecard Grid — 2 rows of 3 */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : (stats?.total_titles ?? 0)}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Titles</p>
							</div>
							<BookOpen className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : (stats?.total_volumes ?? 0)}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Volumes</p>
							</div>
							<BookMarked className="h-5 w-5 text-indigo-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : (stats?.total_lending_transactions ?? 0)}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">On Loan Today</p>
							</div>
							<ArrowLeftRight className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : '—'}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Overdue Items</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-purple-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : (stats?.active_members ?? 0)}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Active Members</p>
							</div>
							<Users className="h-5 w-5 text-purple-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">
									{loading ? '—' : '—'}
								</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Pending Charges</p>
							</div>
							<DollarSign className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Quick Actions */}
			<div className="flex-shrink-0">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<Link href="/circulation">
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

					<Link href="/circulation">
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
