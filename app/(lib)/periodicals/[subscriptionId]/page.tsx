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
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import {
	ArrowLeft, PlusCircle, RefreshCw, BookMarked, CheckCircle, Inbox, ChevronLeft, ChevronRight,
	MoreHorizontal, Eye, Edit, Trash2,
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
	remarks: string
}

const defaultIssueForm: IssueFormData = {
	volume_number: '',
	issue_number: '',
	issue_date: '',
	// Empty, not today: the form now opens on 'expected', and an issue that has
	// not arrived has no received date. Filled in the moment the status is
	// changed to received — see the Status field.
	received_date: '',
	cover_date: '',
	pages: '',
	receipt_status: 'expected',
	remarks: '',
}

const today = () => new Date().toISOString().split('T')[0]

/**
 * The next issue number in the run.
 *
 * A subscription lays its year out in advance, so the numbers are already
 * there — this finds the highest and offers the one after it, which is what a
 * librarian adding a thirteenth issue to a twelve-issue year would write
 * anyway. Numbers that are not numbers ("Special", "Suppl") are skipped rather
 * than guessed at.
 */
function nextIssueNumber(issues: LibPeriodicalIssue[]): string {
	let highest = 0
	for (const issue of issues) {
		const value = Number((issue.issue_number ?? '').trim())
		if (Number.isInteger(value) && value > highest) highest = value
	}
	return String(highest + 1)
}

/** A plain date, as the rest of the register writes them. */
function dateLabel(value?: string | null): string {
	if (!value) return '—'
	const date = new Date(value)
	return isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN')
}

/**
 * A cover date, read the way it is printed on the cover.
 *
 * The librarian enters the first of the month, because that is what a date box
 * can take; the cover itself says "March 2026" and never a day. So the day is
 * dropped on the way out — what is stored is untouched, only how it reads
 * changes. Anything that is not a date is shown exactly as it was typed, since
 * a weekly's cover may carry a full date and older rows hold free text.
 */
function coverDateLabel(value?: string | null): string {
	if (!value) return '—'
	const date = new Date(value)
	if (isNaN(date.getTime())) return value
	return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
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
	/** The issue the sheet is editing, or null when a new one is being recorded. */
	const [editingIssue, setEditingIssue] = useState<LibPeriodicalIssue | null>(null)
	/** Shown read-only, for a librarian who only wants to look. */
	const [viewIssue, setViewIssue] = useState<LibPeriodicalIssue | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibPeriodicalIssue | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)

	const loadData = useCallback(async () => {
		try {
			setLoading(true)
			const [subRes, issuesRes] = await Promise.all([
				fetch(`/api/lib/periodicals/subscriptions/${subscriptionId}`),
				fetch(`/api/lib/periodicals/subscriptions/${subscriptionId}/issues`),
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

	/**
	 * A blank Record Issue sheet, already carrying what this subscription says.
	 *
	 * The volume and the issue number are not questions a librarian standing at
	 * the counter should have to answer — the subscription was registered with
	 * its volume, and the issues before this one give the number. Everything
	 * else stays empty, because everything else is read off the issue in hand.
	 */
	const blankIssueForm = useCallback((): IssueFormData => ({
		...defaultIssueForm,
		volume_number: subscription?.start_volume ?? '',
		issue_number: nextIssueNumber(issues),
	}), [subscription?.start_volume, issues])

	const resetForm = () => { setForm(blankIssueForm()); setErrors({}); setEditingIssue(null) }

	const startEdit = (issue: LibPeriodicalIssue) => {
		setEditingIssue(issue)
		setErrors({})
		setForm({
			volume_number: issue.volume_number ?? '',
			issue_number: issue.issue_number ?? '',
			// A date box only takes YYYY-MM-DD, and these come back as timestamps
			issue_date: issue.issue_date?.split('T')[0] ?? '',
			received_date: issue.received_date?.split('T')[0] ?? '',
			cover_date: issue.cover_date?.split('T')[0] ?? '',
			pages: issue.pages?.toString() ?? '',
			receipt_status: issue.receipt_status,
			remarks: issue.remarks ?? '',
		})
		setSheetOpen(true)
	}

	const validate = (): boolean => {
		const e: Record<string, string> = {}
		// An issue still expected has not arrived, so there is no date to give.
		// Every other status says it is here, or was, and that day matters.
		if (form.receipt_status !== 'expected' && !form.received_date) {
			e.received_date = 'Received date is required'
		}
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
				// Sent as null rather than left out, so an issue put back to
				// expected loses the date it had instead of keeping it.
				received_date: form.received_date || null,
				cover_date: form.cover_date || undefined,
				remarks: form.remarks.trim() || undefined,
			}
			const base = `/api/lib/periodicals/subscriptions/${subscriptionId}/issues`
			const res = await fetch(editingIssue ? `${base}/${editingIssue.id}` : base, {
				method: editingIssue ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Save failed')
			}
			const saved = await res.json()
			if (editingIssue) {
				setIssues(prev => prev.map(i => i.id === saved.id ? saved : i))
				// The Received count moves with the status, so the scorecards above
				// are read again rather than guessed at here.
				if (editingIssue.receipt_status !== saved.receipt_status) loadData()
				toast({ title: '✅ Issue updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setIssues(prev => [saved, ...prev])
				toast({ title: '✅ Issue recorded', className: 'bg-green-50 border-green-200 text-green-800' })
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			setDeleting(true)
			const res = await fetch(
				`/api/lib/periodicals/subscriptions/${subscriptionId}/issues/${deleteTarget.id}`,
				{ method: 'DELETE' }
			)
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Delete failed')
			}
			setIssues(prev => prev.filter(i => i.id !== deleteTarget.id))
			// A deleted issue that had been counted gives its place back
			if (deleteTarget.receipt_status === 'received') loadData()
			toast({ title: '✅ Issue deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleting(false)
			setDeleteTarget(null)
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
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold">Issues Received</h2>
								<p className="text-xs text-muted-foreground">{issues.length} issue{issues.length !== 1 ? 's' : ''} on record</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
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
											<TableHead className="text-xs font-semibold w-14">S.No</TableHead>
											<TableHead className="text-xs font-semibold">Volume</TableHead>
											<TableHead className="text-xs font-semibold">Issue #</TableHead>
											<TableHead className="text-xs font-semibold">Cover Date</TableHead>
											<TableHead className="text-xs font-semibold">Issue Date</TableHead>
											<TableHead className="text-xs font-semibold">Received Date</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={8} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<BookMarked className="h-8 w-8 opacity-20" />
														<span className="text-sm">No issues recorded yet</span>
														<span className="text-xs">Click Record Issue to log a received issue</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map((issue, index) => (
											<TableRow key={issue.id} className="hover:bg-muted/50">
												{/* Counted across pages, so page 2 starts at 11 and not at 1 */}
												<TableCell className="text-sm text-muted-foreground tabular-nums">
													{(currentPage - 1) * effectivePerPage + index + 1}
												</TableCell>
												<TableCell className="text-sm">{issue.volume_number || '—'}</TableCell>
												<TableCell className="text-sm">{issue.issue_number || '—'}</TableCell>
												<TableCell className="text-sm">{coverDateLabel(issue.cover_date)}</TableCell>
												<TableCell className="text-sm">{dateLabel(issue.issue_date)}</TableCell>
												<TableCell className="text-sm">{dateLabel(issue.received_date)}</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs ${receiptColors[issue.receipt_status]}`}>
														{issue.receipt_status}
													</Badge>
												</TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => setViewIssue(issue)}>
																<Eye className="h-4 w-4 mr-2" />View
															</DropdownMenuItem>
															<DropdownMenuItem onClick={() => startEdit(issue)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(issue)}>
																<Trash2 className="h-4 w-4 mr-2" />Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
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
							) : paginated.map((issue, index) => (
								<div key={issue.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="font-medium text-sm">
												<span className="text-muted-foreground tabular-nums mr-1.5">
													{(currentPage - 1) * effectivePerPage + index + 1}.
												</span>
												{issue.volume_number ? `Vol. ${issue.volume_number}` : ''}
												{issue.volume_number && issue.issue_number ? ' / ' : ''}
												{issue.issue_number ? `No. ${issue.issue_number}` : ''}
												{!issue.volume_number && !issue.issue_number ? 'Issue' : ''}
											</p>
											<p className="text-xs text-muted-foreground">
												{coverDateLabel(issue.cover_date)} · received {dateLabel(issue.received_date)}
											</p>
										</div>
										<div className="flex items-center gap-1 shrink-0">
											<Badge variant="outline" className={`text-xs ${receiptColors[issue.receipt_status]}`}>
												{issue.receipt_status}
											</Badge>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-7 w-7 p-0">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => setViewIssue(issue)}>
														<Eye className="h-4 w-4 mr-2" />View
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => startEdit(issue)}>
														<Edit className="h-4 w-4 mr-2" />Edit
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(issue)}>
														<Trash2 className="h-4 w-4 mr-2" />Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</div>
									{issue.remarks && <p className="text-xs text-muted-foreground italic">{issue.remarks}</p>}
								</div>
							))}
						</div>

						{/* Pagination */}
						<div className="flex flex-wrap items-center justify-between gap-2 pt-3 px-0 sm:px-4 pb-1 border-t mt-auto">
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
						<SheetTitle className="text-lg font-semibold">{editingIssue ? 'Edit Issue' : 'Record Issue'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingIssue
								? 'Correct this issue — including its status, once a missing issue turns up'
								: 'Log a received issue for this periodical subscription'}
						</p>
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
									<Label className="text-sm font-semibold">
										Received Date {form.receipt_status !== 'expected' && <span className="text-red-500">*</span>}
									</Label>
									{/* An issue still expected has not been received, so there is
									    nothing to date. Demanded again the moment the status says
									    it has arrived. */}
									<Input
										type="date"
										value={form.received_date}
										onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))}
										className={errors.received_date ? 'border-red-500' : ''}
									/>
									{errors.received_date
										? <p className="text-xs text-red-500">{errors.received_date}</p>
										: form.receipt_status === 'expected' && (
											<p className="text-xs text-muted-foreground">
												Not needed while the issue is still expected.
											</p>
										)}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Cover Date</Label>
									<Input type="date" value={form.cover_date} onChange={e => setForm(f => ({ ...f, cover_date: e.target.value }))} />
									<p className="text-xs text-muted-foreground">
										Enter the 1st of the month. It is shown as{' '}
										<span className="font-medium">{form.cover_date ? coverDateLabel(form.cover_date) : 'March 2026'}</span>.
									</p>
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
								{/* Saying an issue has arrived fills in the day it arrived, if
								    nothing else has been put there. That is the one thing the
								    librarian would otherwise have to type straight after
								    choosing 'received', every single time. */}
								<Select
									value={form.receipt_status}
									onValueChange={v => setForm(f => ({
										...f,
										receipt_status: v as LibIssueReceiptStatus,
										received_date: v === 'expected'
											? f.received_date
											: (f.received_date || today()),
									}))}
								>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										{(Object.keys(receiptColors) as LibIssueReceiptStatus[]).map(s => (
											<SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									An issue marked expected or missing can be set to received here the day it arrives.
								</p>
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Remark</Label>
								<Textarea
									value={form.remarks}
									onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
									placeholder="Why it is missing, what the supplier said, how it arrived..."
									rows={3}
								/>
								<p className="text-xs text-muted-foreground">Optional — a note against this issue alone.</p>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingIssue ? 'Update Issue' : 'Record Issue')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* What is on record for one issue, read-only */}
			<Dialog open={!!viewIssue} onOpenChange={o => { if (!o) setViewIssue(null) }}>
				<DialogContent className="sm:max-w-[560px]">
					<DialogHeader>
						<DialogTitle className="text-lg font-semibold">Issue Detail</DialogTitle>
						<DialogDescription>
							{subscription.catalogue_record?.title ?? 'This subscription'}
						</DialogDescription>
					</DialogHeader>

					{viewIssue && (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								{([
									['Volume', viewIssue.volume_number || '—'],
									['Issue #', viewIssue.issue_number || '—'],
									['Cover Date', coverDateLabel(viewIssue.cover_date)],
									['Issue Date', dateLabel(viewIssue.issue_date)],
									['Received Date', dateLabel(viewIssue.received_date)],
									['Pages', viewIssue.pages?.toString() || '—'],
								] as Array<[string, string]>).map(([label, value]) => (
									<div key={label}>
										<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
										<p className="text-sm font-medium">{value}</p>
									</div>
								))}
							</div>

							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
								<Badge variant="outline" className={`text-xs capitalize ${receiptColors[viewIssue.receipt_status]}`}>
									{viewIssue.receipt_status}
								</Badge>
							</div>

							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Remark</p>
								<p className="text-sm whitespace-pre-wrap">
									{viewIssue.remarks || <span className="text-muted-foreground">No remark on this issue.</span>}
								</p>
							</div>
						</div>
					)}

					<DialogFooter className="gap-2 sm:gap-2">
						<Button variant="outline" onClick={() => setViewIssue(null)}>Close</Button>
						<Button onClick={() => { const issue = viewIssue; setViewIssue(null); if (issue) startEdit(issue) }}>
							<Edit className="h-4 w-4 mr-1.5" />Edit
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete confirmation */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Issue</AlertDialogTitle>
						<AlertDialogDescription>
							Delete the issue recorded on <strong>{dateLabel(deleteTarget?.received_date)}</strong>
							{deleteTarget?.issue_number ? <> (No. {deleteTarget.issue_number})</> : null}? This cannot be undone.
							{deleteTarget?.receipt_status === 'received' && ' The Received count will go down by one.'}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
							{deleting ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
