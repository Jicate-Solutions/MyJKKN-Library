'use client'

import { useState, useEffect, useCallback } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	BookMarked, BookOpen, TrendingUp, Newspaper,
	MonitorPlay, Database, Users, ArrowLeftRight,
	DollarSign, BarChart3, FileText, Calendar,
	RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import type { LibNaacCriterion4Report } from '@/types/lib'

// ── Academic years for the selector ──────────────────────────────────
function buildAcademicYears(): string[] {
	const current = new Date().getFullYear()
	return Array.from({ length: 6 }, (_, i) => {
		const y = current - i
		return `${y}-${y + 1}`
	})
}

const ACADEMIC_YEARS = buildAcademicYears()

// ── Scorecard component ───────────────────────────────────────────────
interface ScorecardProps {
	label: string
	value: number | string
	icon: React.ElementType
	borderColor: string
	iconColor: string
	loading?: boolean
	format?: 'number' | 'currency' | 'decimal'
}

function Scorecard({ label, value, icon: Icon, borderColor, iconColor, loading, format = 'number' }: ScorecardProps) {
	const displayValue = () => {
		if (loading) return '—'
		if (format === 'currency') return `₹${Number(value).toLocaleString('en-IN')}`
		if (format === 'decimal') return Number(value).toFixed(1)
		return Number(value).toLocaleString('en-IN')
	}

	return (
		<Card className={`border-l-4 ${borderColor} hover:shadow-md transition-shadow`}>
			<CardContent className="p-4">
				<div className="flex items-center justify-between">
					<div className="flex-1 min-w-0">
						{loading ? (
							<div className="h-7 w-16 bg-muted animate-pulse rounded mb-1" />
						) : (
							<p className="text-2xl font-bold tracking-tight truncate">{displayValue()}</p>
						)}
						<p className="text-xs font-medium text-muted-foreground mt-0.5 leading-tight">{label}</p>
					</div>
					<Icon className={`h-5 w-5 shrink-0 ${iconColor} opacity-40`} />
				</div>
			</CardContent>
		</Card>
	)
}

export default function ReportsDashboardPage() {
	const { isReady, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const [report, setReport] = useState<LibNaacCriterion4Report | null>(null)
	const [loading, setLoading] = useState(true)
	const [academicYear, setAcademicYear] = useState<string>(ACADEMIC_YEARS[0])
	const [dateFrom, setDateFrom] = useState(() => {
		const d = new Date()
		d.setFullYear(d.getFullYear() - 1)
		return d.toISOString().split('T')[0]
	})
	const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

	const fetchReport = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const params = new URLSearchParams()
			params.set('date_from', dateFrom)
			params.set('date_to', dateTo)
			params.set('academic_year', academicYear)
			const url = appendToUrl(`/api/lib/reports/naac?${params}`)
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to load report')
			const data = await res.json()
			setReport(data)
		} catch {
			toast({ title: 'Failed to load report data', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, dateFrom, dateTo, academicYear, toast])

	useEffect(() => { fetchReport() }, [fetchReport])

	const r = report

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">

				{/* Filter Bar */}
				<Card className="flex-shrink-0">
					<CardHeader className="px-4 py-3 border-b">
						<div className="flex items-center justify-between flex-wrap gap-2">
							<div>
								<h2 className="text-base font-semibold">Reports Dashboard</h2>
								<p className="text-xs text-muted-foreground">NAAC Criterion 4.2 — Library and Learning Resources</p>
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchReport}>
										<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
						</div>
						<div className="flex flex-wrap items-end gap-3 mt-3">
							<div className="space-y-1.5">
								<Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Academic Year</Label>
								<Select value={academicYear} onValueChange={setAcademicYear}>
									<SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue /></SelectTrigger>
									<SelectContent>
										{ACADEMIC_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="rpt_from" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</Label>
								<Input id="rpt_from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm w-[150px]" />
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="rpt_to" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</Label>
								<Input id="rpt_to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm w-[150px]" />
							</div>
							<Button className="h-8 text-sm px-5" onClick={fetchReport} disabled={loading}>
								Apply
							</Button>
						</div>
					</CardHeader>
				</Card>

				{/* NAAC 4.2 Collection Metrics — row 1 */}
				<div className="space-y-2">
					<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
						<BookMarked className="h-3.5 w-3.5" />Collection Metrics
					</p>
					<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
						<Scorecard label="Total Volumes" value={r?.total_volumes ?? 0} icon={BookMarked} borderColor="border-l-blue-500" iconColor="text-blue-500" loading={loading} />
						<Scorecard label="Total Titles" value={r?.total_titles ?? 0} icon={BookOpen} borderColor="border-l-indigo-500" iconColor="text-indigo-500" loading={loading} />
						<Scorecard label="Volumes Added" value={r?.volumes_added_this_year ?? 0} icon={TrendingUp} borderColor="border-l-emerald-500" iconColor="text-emerald-500" loading={loading} />
						<Scorecard label="Print Journals" value={r?.print_journals_subscribed ?? 0} icon={Newspaper} borderColor="border-l-purple-500" iconColor="text-purple-500" loading={loading} />
					</div>
				</div>

				{/* NAAC 4.2 Digital & Access Metrics — row 2 */}
				<div className="space-y-2">
					<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
						<MonitorPlay className="h-3.5 w-3.5" />Digital and Access
					</p>
					<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
						<Scorecard label="Digital Resources" value={r?.digital_resources_count ?? 0} icon={MonitorPlay} borderColor="border-l-teal-500" iconColor="text-teal-500" loading={loading} />
						<Scorecard label="INFLIBNET Databases" value={r?.inflibnet_databases ?? 0} icon={Database} borderColor="border-l-cyan-500" iconColor="text-cyan-500" loading={loading} />
						<Scorecard label="Active Members" value={r?.active_members ?? 0} icon={Users} borderColor="border-l-rose-500" iconColor="text-rose-500" loading={loading} />
						<Scorecard label="Lending Transactions" value={r?.total_lending_transactions ?? 0} icon={ArrowLeftRight} borderColor="border-l-amber-500" iconColor="text-amber-500" loading={loading} />
					</div>
				</div>

				{/* Annual Expenditure */}
				<div className="space-y-2">
					<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
						<DollarSign className="h-3.5 w-3.5" />Annual Expenditure
					</p>
					<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
						<Scorecard label="Books" value={r?.annual_books_expenditure ?? 0} icon={BookOpen} borderColor="border-l-blue-500" iconColor="text-blue-500" loading={loading} format="currency" />
						<Scorecard label="Journals" value={r?.annual_journals_expenditure ?? 0} icon={Newspaper} borderColor="border-l-purple-500" iconColor="text-purple-500" loading={loading} format="currency" />
						<Scorecard label="Digital" value={r?.annual_digital_expenditure ?? 0} icon={MonitorPlay} borderColor="border-l-teal-500" iconColor="text-teal-500" loading={loading} format="currency" />
						<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
							<CardContent className="p-4">
								<div className="flex items-center justify-between">
									<div className="flex-1 min-w-0">
										{loading ? (
											<div className="h-7 w-20 bg-muted animate-pulse rounded mb-1" />
										) : (
											<p className="text-2xl font-bold tracking-tight text-emerald-600 truncate">
												₹{(r?.total_annual_expenditure ?? 0).toLocaleString('en-IN')}
											</p>
										)}
										<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Annual</p>
									</div>
									<DollarSign className="h-5 w-5 text-emerald-500/40 shrink-0" />
								</div>
							</CardContent>
						</Card>
					</div>
				</div>

				{/* Footfall */}
				<div className="space-y-2">
					<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
						<Calendar className="h-3.5 w-3.5" />Library Footfall
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Scorecard label="Total Annual Visits" value={r?.total_annual_visits ?? 0} icon={Calendar} borderColor="border-l-orange-500" iconColor="text-orange-500" loading={loading} />
						<Scorecard label="Daily Average Footfall" value={r?.daily_avg_footfall ?? 0} icon={BarChart3} borderColor="border-l-amber-500" iconColor="text-amber-500" loading={loading} format="decimal" />
					</div>
				</div>

				{/* Detailed Report Links */}
				<div className="space-y-2">
					<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
						<FileText className="h-3.5 w-3.5" />Detailed Reports
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{[
							{ label: 'Accession Register', href: '/registry', icon: BookOpen, color: 'text-blue-600' },
							{ label: 'Circulation Summary', href: '/circulation', icon: ArrowLeftRight, color: 'text-indigo-600' },
							{ label: 'Overdue Analysis', href: '/circulation/overdue', icon: TrendingUp, color: 'text-rose-600' },
							{ label: 'Budget Utilisation', href: '/acquisition/budget', icon: DollarSign, color: 'text-emerald-600' },
							{ label: 'Member Statistics', href: '/members', icon: Users, color: 'text-purple-600' },
							{ label: 'Subscription Status', href: '/periodicals', icon: Newspaper, color: 'text-amber-600' },
						].map(link => (
							<Link key={link.href} href={link.href}>
								<Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-blue-200 group">
									<CardContent className="p-4 flex items-center gap-3">
										<div className={`p-2 rounded-md bg-muted group-hover:bg-blue-50 transition-colors`}>
											<link.icon className={`h-4 w-4 ${link.color}`} />
										</div>
										<span className="font-medium text-sm">{link.label}</span>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				</div>

			</div>
		</TooltipProvider>
	)
}
