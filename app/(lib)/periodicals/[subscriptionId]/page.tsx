'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	ArrowLeft, PlusCircle, RefreshCw, BookMarked, CheckCircle, Inbox, ChevronLeft, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import type { LibPeriodicalSubscription, LibPeriodicalIssue, LibIssueReceiptStatus } from '@/types/lib'

const receiptColors: Record<LibIssueReceiptStatus, string> = {
	expected: 'bg-amber-100 text-amber-800 border-amber-200',
	received: 'bg-green-100 text-green-800 border-green-200',
	missing: 'bg-red-100 text-red-800 border-red-200',
	claimed: 'bg-blue-100 text-blue-800 border-blue-200',
	duplicate: 'bg-gray-100 text-gray-800 border-gray-200',
}

const subscriptionStatusColors: Record<string, string> = {
	active: 'bg-green-100 text-green-800 border-green-200',
	expired: 'bg-red-100 text-red-800 border-red-200',
	cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
	gratis: 'bg-blue-100 text-blue-800 border-blue-200',
	suspended: 'bg-amber-100 text-amber-800 border-amber-200',
}

interface IssueFormData {
	volume_number: string
	issue_number: string
	issue_date: string
	received_date: string
	cover_date: string
	pages: string
	receipt_status: LibIssueReceiptStatus
}

const defaultIssueForm: IssueFormData = {
	volume_number: '',
	issue_number: '',
	issue_date: '',
	received_date: new Date().toISOString().split('T')[0],
	cover_date: '',
	pages: '',
	receipt_status: 'received',
}

export default function SubscriptionDetailPage() {
	const { subscriptionId } = useParams<{ subscriptionId: string }>()
	const { toast } = useToast()

	const [subscription, setSubscription] = useState<LibPeriodicalSubscription | null>(null)
	const [issues, setIssues] = useState<LibPeriodicalIssue[]>([])
	const [loading, setLoading] = useState(true)
	const [sheetOpen, setSheetOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<IssueFormData>(defaultIssueForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const loadData = useCallback(async () => {
		try {
			setLoading(true)
			const [subRes, issuesRes] = await Promise.all([
				fetch(`/api/lib/periodicals/${subscriptionId}`),
				fetch(`/api/lib/periodicals/${subscriptionId}/issues`),
			])
			if (!subRes.ok) throw new Error('Failed to load subscription')
			const subData = await subRes.json()
			const issuesData = issuesRes.ok ? await issuesRes.json() : []
			setSubscription(subData)
			setIssues(issuesData)
		} catch {
			toast({ title: 'Failed to load subscription', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [subscriptionId, toast])

	useEffect(() => { loadData() }, [loadData])

	const scorecards = useMemo(() => ({
		total: issues.length,
		received: issues.filter(i => i.receipt_status === 'received').length,
		missing: issues.filter(i => i.receipt_status === 'missing').length,
		expected: issues.filter(i => i.receipt_status === 'expected').length,
	}), [issues])

	const pageSizeOptions = useMemo(() => {
		const opts = [10, 25, 50]
		if (issues.length > 50) opts.push(issues.length)
		return opts
	}, [issues.length])

	const effectivePerPage = itemsPerPage > issues.length ? issues.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(issues.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? issues.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: issues

	const resetForm = () => { setForm(defaultIssueForm); setErrors({}) }

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.received_date) e.received_date = 'Received date is required'
		setErrors(e)
		return Object.keys(e).length === 0
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			const payload = {
				...form,
				subscription_id: subscriptionId,
				institution_id: subscription?.institution_id ?? '',
				pages: form.pages ? Number(form.pages) : undefined,
				issue_date: form.issue_date || undefined,
				cover_date: form.cover_date || undefined,
			}
			const res = await fetch(`/api/lib/periodicals/${subscriptionId}/issues`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Save failed')
			}
			const created = await res.json()
			setIssues(prev => [created, ...prev])
			toast({ title: '✅ Issue recorded', className: 'bg-green-50 border-green-200 text-green-800' })
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	if (loading) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="flex items-center gap-2 py-4">
					<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
					<span className="text-sm text-muted-foreground">Loading subscription...</span>
				</div>
			</div>
		)
	}

	if (!subscription) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="py-12 text-center text-muted-foreground">
					<BookMarked className="h-10 w-10 mx-auto mb-2 opacity-20" />
					<p className="text-sm">Subscription not found.</p>
					<Button variant="outline" size="sm" className="mt-4" asChild>
						<Link href="/periodicals">Back to Periodicals</Link>
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Page Header */}
			<div className="flex items-start gap-3 pt-1">
				<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-0.5" asChild>
					<Link href="/periodicals"><ArrowLeft className="h-4 w-4" /></Link>
				</Button>
				<div className="flex-1 min-w-0">
					<h1 className="text-lg font-semibold leading-tight truncate">
						{subscription.catalogue_record?.title ?? 'Subscription Detail'}
					</h1>
					<p className="text-sm text-muted-foreground">
						Sub #{subscription.subscription_number ?? subscription.id.slice(0, 8)}
					</p>
					<div className="flex flex-wrap gap-1.5 mt-1.5">
						<Badge variant="outline" className={`text-xs ${subscriptionStatusColors[subscription.subscription_status] ?? ''}`}>
							{subscription.subscription_status}
						</Badge>
						{subscription.subscription_type && (
							<Badge variant="secondary" className="text-xs capitalize">{subscription.subscription_type}</Badge>
						)}
						{subscription.is_gratis && (
							<Badge variant="outline" className="text-xs text-blue-700 border-blue-300">Gratis</Badge>
						)}
					</div>
				</div>
			</div>

			{/* Subscription Info Card */}
			<Card className="flex-shrink-0">
				<CardHeader className="px-4 py-3 border-b">
					<h2 className="text-base font-semibold">Subscription Information</h2>
				</CardHeader>
				<CardContent className="px-4 py-4">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-sm">
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Fiscal Year</p>
							<p className="font-medium">{subscription.fiscal_year}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Frequency</p>
							<p className="font-medium">{subscription.frequency ?? '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Start Date</p>
							<p className="font-medium">
								{subscription.start_date ? new Date(subscription.start_date).toLocaleDateString('en-IN') : '—'}
							</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">End Date</p>
							<p className="font-medium">
								{subscription.end_date ? new Date(subscription.end_date).toLocaleDateString('en-IN') : '—'}
							</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Issues Received</p>
							<p className="font-semibold text-emerald-600">{subscription.received_issues}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Expected Issues</p>
							<p className="font-medium">{subscription.expected_issues ?? '—'}</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Cost</p>
							<p className="font-medium">
								{subscription.subscription_cost != null
									? `${subscription.currency_code} ${subscription.subscription_cost.toFixed(2)}`
									: '—'}
							</p>
						</div>
						<div>
							<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Supplier</p>
							<p className="font-medium">{subscription.supplier?.supplier_name ?? '—'}</p>
						</div>
						{subscription.access_url && (
							<div className="col-span-2 sm:col-span-4">
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Access URL</p>
								<a href={subscription.access_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm truncate block">
									{subscription.access_url}
								</a>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Issues Scorecards */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Issues</p>
							</div>
							<BookMarked className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.received}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Received</p>
							</div>
							<CheckCircle className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.expected}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Expected</p>
							</div>
							<Inbox className="h-5 w-5 text-amber-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecards.missing}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Missing</p>
							</div>
							<RefreshCw className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Issues Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold">Issues Received</h2>
								<p className="text-xs text-muted-foreground">{issues.length} issue{issues.length !== 1 ? 's' : ''} on record</p>
							</div>
							<div className="flex items-center gap-1.5">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={loadData}>
											<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Refresh</TooltipContent>
								</Tooltip>
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Record Issue</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						{/* Desktop Table */}
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[380px] max-h-[520px] hidden md:block">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Volume</TableHead>
											<TableHead className="text-xs font-semibold">Issue #</TableHead>
											<TableHead className="text-xs font-semibold">Issue Date</TableHead>
											<TableHead className="text-xs font-semibold">Received Date</TableHead>
											<TableHead className="text-xs font-semibold">Pages</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={6} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookMarked className="h-8 w-8 opacity-20" />
														<span className="text-sm">No issues recorded yet</span>
														<span className="text-xs">Click Record Issue to log a received issue</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map(issue => (
											<TableRow key={issue.id} className="hover:bg-muted/50">
												<TableCell className="text-sm">{issue.volume_number ?? '—'}</TableCell>
												<TableCell className="text-sm">{issue.issue_number ?? '—'}</TableCell>
												<TableCell className="text-sm">
													{issue.issue_date ? new Date(issue.issue_date).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell className="text-sm">
													{issue.received_date ? new Date(issue.received_date).toLocaleDateString('en-IN') : '—'}
												</TableCell>
												<TableCell className="text-sm">{issue.pages ?? '—'}</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs ${receiptColors[issue.receipt_status]}`}>
														{issue.receipt_status}
													</Badge>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>

						{/* Mobile Cards */}
						<div className="md:hidden mt-3 space-y-3 overflow-auto max-h-[520px]">
							{paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<BookMarked className="h-8 w-8 opacity-20" />
									<span className="text-sm">No issues recorded yet</span>
								</div>
							) : paginated.map(issue => (
								<div key={issue.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div>
											<p className="font-medium text-sm">
												{issue.volume_number ? `Vol. ${issue.volume_number}` : ''}
												{issue.volume_number && issue.issue_number ? ' / ' : ''}
												{issue.issue_number ? `No. ${issue.issue_number}` : ''}
												{!issue.volume_number && !issue.issue_number ? 'Issue' : ''}
											</p>
											<p className="text-xs text-muted-foreground">
												{issue.received_date ? new Date(issue.received_date).toLocaleDateString('en-IN') : '—'}
											</p>
										</div>
										<Badge variant="outline" className={`text-xs ${receiptColors[issue.receipt_status]}`}>
											{issue.receipt_status}
										</Badge>
									</div>
									{issue.pages && <p className="text-xs text-muted-foreground">{issue.pages} pages</p>}
								</div>
							))}
						</div>

						{/* Pagination */}
						<div className="flex items-center justify-between pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground hidden sm:inline">Rows per page</span>
								<Select value={String(itemsPerPage)} onValueChange={v => { setItemsPerPage(Number(v)); setCurrentPage(1) }}>
									<SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
									<SelectContent>
										{pageSizeOptions.map(n => (
											<SelectItem key={n} value={String(n)}>{n === issues.length ? 'All' : n}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{issues.length === 0 ? '0 of 0' : `${(currentPage - 1) * effectivePerPage + 1}–${Math.min(currentPage * effectivePerPage, issues.length)} of ${issues.length}`}
								</span>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</TooltipProvider>

			{/* Record Issue Sheet */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">Record Issue</SheetTitle>
						<p className="text-sm text-muted-foreground">Log a received issue for this periodical subscription</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Issue Identity */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Issue Identity</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Volume #</Label>
									<Input value={form.volume_number} onChange={e => setForm(f => ({ ...f, volume_number: e.target.value }))} placeholder="Vol. 12" />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Issue #</Label>
									<Input value={form.issue_number} onChange={e => setForm(f => ({ ...f, issue_number: e.target.value }))} placeholder="No. 3" />
								</div>
							</div>
						</div>

						{/* Section: Dates */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dates</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Issue Date</Label>
									<Input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Received Date <span className="text-red-500">*</span></Label>
									<Input
										type="date"
										value={form.received_date}
										onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))}
										className={errors.received_date ? 'border-red-500' : ''}
									/>
									{errors.received_date && <p className="text-xs text-red-500">{errors.received_date}</p>}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Cover Date</Label>
									<Input type="date" value={form.cover_date} onChange={e => setForm(f => ({ ...f, cover_date: e.target.value }))} />
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Pages</Label>
									<Input type="number" value={form.pages} onChange={e => setForm(f => ({ ...f, pages: e.target.value }))} placeholder="0" />
								</div>
							</div>
						</div>

						{/* Section: Status */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receipt Status</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Status</Label>
								<Select value={form.receipt_status} onValueChange={v => setForm(f => ({ ...f, receipt_status: v as LibIssueReceiptStatus }))}>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										{(Object.keys(receiptColors) as LibIssueReceiptStatus[]).map(s => (
											<SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : 'Record Issue'}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	)
}
