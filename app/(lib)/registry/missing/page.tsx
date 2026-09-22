'use client'

/**
 * Missing Books — Knowledge Registry → Missing Books.
 *
 * Type or paste accession numbers, tick the copies, write why, and they are
 * marked missing: the catalogue shows them as Missing, and the OPAC and the
 * Circulation Desk show them as not available. A copy out on loan can be
 * marked too; its loan closes. The list below holds every copy this college
 * has marked missing, and a copy that turns up is marked Found from there.
 *
 * Open to the assistant librarian as well as the librarian.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import { OverflowText } from '@/components/library/overflow-text'
import { BookX, Search, RefreshCw, PackageCheck, AlertTriangle } from 'lucide-react'
import type { LibItemStatus } from '@/types/lib'

interface MissingItem {
	id: string
	accession_number: string | null
	barcode: string | null
	status: LibItemStatus
	missing_reason: string | null
	missing_marked_at: string | null
	missing_marked_by: string | null
	catalogue: { id: string; title: string | null; author: string | null } | null
	loan: { member_name: string | null; member_number: string | null; due_date: string } | null
}

interface UpdateResult {
	updated?: number
	closed_loans?: number
	skipped?: { accession_number: string | null; reason: string }[]
	error?: string
}

/** What a copy can be marked missing from; the API holds the same list. */
const MARKABLE: LibItemStatus[] = ['available', 'on_loan', 'on_hold']

const stamp = new Intl.DateTimeFormat('en-IN', {
	timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function whenMarked(value: string | null): string {
	return value ? stamp.format(new Date(value)) : '—'
}

/** The title, linked to its catalogue record — the two pages meet here. */
function TitleCell({ item }: { item: MissingItem }) {
	const title = item.catalogue?.title ?? 'Unknown title'
	return item.catalogue?.id ? (
		<Link href={`/registry/${item.catalogue.id}`} className="block min-w-0 hover:underline">
			<OverflowText as="div" text={title} className="text-sm font-medium" />
		</Link>
	) : (
		<OverflowText as="div" text={title} className="text-sm font-medium" />
	)
}

function skippedText(skipped: UpdateResult['skipped']): string | undefined {
	if (!skipped || skipped.length === 0) return undefined
	const shown = skipped.slice(0, 3).map(s => `${s.accession_number ?? 'A book'}: ${s.reason}`).join(' · ')
	return skipped.length > 3 ? `${shown} · and ${skipped.length - 3} more` : shown
}

export default function MissingBooksPage() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	// Finding books to mark
	const [numbers, setNumbers] = useState('')
	const [searching, setSearching] = useState(false)
	const [results, setResults] = useState<MissingItem[]>([])
	const [notFound, setNotFound] = useState<string[]>([])
	const [picked, setPicked] = useState<Set<string>>(new Set())
	const [reason, setReason] = useState('')
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [marking, setMarking] = useState(false)

	// The missing list
	const [missing, setMissing] = useState<MissingItem[]>([])
	const [listLoading, setListLoading] = useState(true)
	const [listError, setListError] = useState<string | null>(null)
	const [listFilter, setListFilter] = useState('')
	const [foundPicked, setFoundPicked] = useState<Set<string>>(new Set())
	const [foundOpen, setFoundOpen] = useState(false)
	const [finding, setFinding] = useState(false)

	const loadMissing = useCallback(async () => {
		if (!isReady || !institutionId) return
		try {
			setListLoading(true)
			const res = await fetch(appendToUrl('/api/lib/missing?list=missing'))
			const body = await res.json()
			if (!res.ok) {
				setListError(body.error ?? 'Could not load missing books')
				setMissing([])
				return
			}
			setListError(null)
			setMissing(body.data ?? [])
			setFoundPicked(new Set())
		} catch {
			setListError('Could not load missing books')
		} finally {
			setListLoading(false)
		}
	}, [isReady, institutionId, appendToUrl])

	useEffect(() => { void loadMissing() }, [loadMissing])

	// Another college's search results must not linger after switching
	useEffect(() => {
		setResults([])
		setNotFound([])
		setPicked(new Set())
	}, [institutionId])

	const search = useCallback(async () => {
		if (!institutionId || !numbers.trim()) return
		try {
			setSearching(true)
			const res = await fetch(appendToUrl(`/api/lib/missing?q=${encodeURIComponent(numbers)}`))
			const body = await res.json()
			if (!res.ok) throw new Error(body.error ?? 'Search failed')
			const items: MissingItem[] = body.data ?? []
			setResults(items)
			setNotFound(body.not_found ?? [])
			// Everything that can be marked starts ticked — the usual case is all of them
			setPicked(new Set(items.filter(i => MARKABLE.includes(i.status)).map(i => i.id)))
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Search failed', variant: 'destructive' })
		} finally {
			setSearching(false)
		}
	}, [institutionId, numbers, appendToUrl, toast])

	const post = async (payload: Record<string, unknown>): Promise<UpdateResult> => {
		const res = await fetch('/api/lib/missing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ institution_id: institutionId, ...payload }),
		})
		const body: UpdateResult = await res.json()
		if (!res.ok) throw new Error(body.error ?? 'Could not update the books')
		return body
	}

	const markMissing = async () => {
		try {
			setMarking(true)
			const result = await post({ action: 'missing', item_ids: [...picked], reason: reason.trim() })
			const n = result.updated ?? 0
			toast({
				title: `${n} book${n === 1 ? '' : 's'} marked missing`,
				description: [
					result.closed_loans ? `${result.closed_loans} loan${result.closed_loans === 1 ? '' : 's'} closed` : '',
					skippedText(result.skipped) ?? '',
				].filter(Boolean).join(' · ') || undefined,
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
			setConfirmOpen(false)
			setResults([])
			setNotFound([])
			setPicked(new Set())
			setNumbers('')
			setReason('')
			await loadMissing()
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Could not update the books', variant: 'destructive' })
		} finally {
			setMarking(false)
		}
	}

	const markFound = async () => {
		try {
			setFinding(true)
			const result = await post({ action: 'found', item_ids: [...foundPicked] })
			const n = result.updated ?? 0
			toast({
				title: `${n} book${n === 1 ? '' : 's'} back on the shelf`,
				description: skippedText(result.skipped),
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
			setFoundOpen(false)
			await loadMissing()
		} catch (err) {
			toast({ title: err instanceof Error ? err.message : 'Could not update the books', variant: 'destructive' })
		} finally {
			setFinding(false)
		}
	}

	const markable = results.filter(i => MARKABLE.includes(i.status))
	const allPicked = markable.length > 0 && markable.every(i => picked.has(i.id))
	const pickedOnLoan = results.filter(i => picked.has(i.id) && i.status === 'on_loan').length

	const shownMissing = useMemo(() => {
		const q = listFilter.trim().toLowerCase()
		if (!q) return missing
		return missing.filter(i =>
			(i.accession_number ?? '').toLowerCase().includes(q)
			|| (i.catalogue?.title ?? '').toLowerCase().includes(q)
			|| (i.missing_reason ?? '').toLowerCase().includes(q))
	}, [missing, listFilter])
	const allFoundPicked = shownMissing.length > 0 && shownMissing.every(i => foundPicked.has(i.id))

	const toggle = (set: Set<string>, id: string, on: boolean) => {
		const next = new Set(set)
		if (on) next.add(id)
		else next.delete(id)
		return next
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
				{/* Header */}
				<div className="flex-shrink-0">
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-50 dark:bg-brand-green-900/30">
							<BookX className="h-5 w-5 text-brand-green dark:text-brand-green-400" />
						</div>
						<div className="min-w-0">
							<h1 className="text-base font-semibold">Missing Books</h1>
							<p className="text-xs text-muted-foreground">
								Mark copies missing with the reason — the catalogue shows them as Missing, the OPAC and the desk as not available
							</p>
						</div>
					</div>
				</div>

				{isReady && !institutionId ? (
					<Card>
						<CardContent className="py-12 text-center text-sm text-muted-foreground">
							Select an institution to manage its missing books
						</CardContent>
					</Card>
				) : (
					<>
						{/* 1. Find the books */}
						<Card className="flex-shrink-0">
							<CardHeader className="px-4 py-3 border-b">
								<h2 className="text-base font-semibold">Mark books missing</h2>
								<p className="text-xs text-muted-foreground">
									Type or paste accession numbers — separated by commas, spaces or one per line
								</p>
							</CardHeader>
							<CardContent className="p-4 space-y-3">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-start">
									<Textarea
										value={numbers}
										onChange={e => setNumbers(e.target.value)}
										onKeyDown={e => {
											if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void search() }
										}}
										placeholder="e.g. 9464, 464, 12407"
										className="min-h-[72px] font-mono text-sm sm:flex-1"
										aria-label="Accession numbers"
									/>
									<Button
										className="h-11 w-full shrink-0 sm:w-auto bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
										onClick={() => { void search() }}
										disabled={searching || !numbers.trim()}
									>
										{searching ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
										Find books
									</Button>
								</div>

								{notFound.length > 0 && (
									<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
										<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
										<span className="min-w-0 break-words">
											Not in this library: <span className="font-mono">{notFound.join(', ')}</span>
										</span>
									</div>
								)}

								{results.length > 0 && (
									<>
										<div className="rounded-md border overflow-x-auto">
											<Table>
												<TableHeader className="bg-muted/50">
													<TableRow>
														<TableHead className="w-10">
															<Checkbox
																checked={allPicked}
																onCheckedChange={on => setPicked(on ? new Set(markable.map(i => i.id)) : new Set())}
																disabled={markable.length === 0}
																aria-label="Select all"
															/>
														</TableHead>
														<TableHead className="text-xs font-semibold">Accession No</TableHead>
														<TableHead className="text-xs font-semibold">Title</TableHead>
														<TableHead className="text-xs font-semibold">Status</TableHead>
														<TableHead className="text-xs font-semibold">With</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{results.map(item => {
														const can = MARKABLE.includes(item.status)
														return (
															<TableRow key={item.id} className={can ? 'hover:bg-muted/50' : 'opacity-60'}>
																<TableCell>
																	<Checkbox
																		checked={picked.has(item.id)}
																		onCheckedChange={on => setPicked(prev => toggle(prev, item.id, !!on))}
																		disabled={!can}
																		aria-label={`Select ${item.accession_number ?? ''}`}
																	/>
																</TableCell>
																<TableCell className="font-mono text-sm whitespace-nowrap">{item.accession_number}</TableCell>
																<TableCell className="max-w-[260px]">
																	<TitleCell item={item} />
																	{item.catalogue?.author && (
																		<OverflowText as="div" text={item.catalogue.author} className="text-xs text-muted-foreground" />
																	)}
																</TableCell>
																<TableCell><ResourceStatusBadge status={item.status} /></TableCell>
																<TableCell className="text-sm whitespace-nowrap">
																	{item.loan
																		? <>{item.loan.member_name ?? '—'} <span className="text-xs text-muted-foreground">{item.loan.member_number}</span></>
																		: <span className="text-muted-foreground">—</span>}
																</TableCell>
															</TableRow>
														)
													})}
												</TableBody>
											</Table>
										</div>

										<div className="space-y-2">
											<label htmlFor="missing-reason" className="text-sm font-medium">Why are they missing?</label>
											<Textarea
												id="missing-reason"
												value={reason}
												onChange={e => setReason(e.target.value)}
												placeholder="e.g. Not found in the stock verification on 22 Sep 2026"
												className="min-h-[72px] text-sm"
											/>
										</div>

										<div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
											<p className="text-xs text-muted-foreground">
												{picked.size} of {results.length} selected
												{pickedOnLoan > 0 && ` · ${pickedOnLoan} on loan — their loans will close`}
											</p>
											<Button
												className="h-11 w-full sm:w-auto bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
												onClick={() => setConfirmOpen(true)}
												disabled={picked.size === 0 || !reason.trim() || marking}
											>
												<BookX className="h-4 w-4 mr-2" />
												Mark {picked.size || ''} as Missing
											</Button>
										</div>
									</>
								)}
							</CardContent>
						</Card>

						{/* 2. What is missing now */}
						<Card className="flex-1 flex flex-col min-h-0">
							<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="min-w-0">
										<h2 className="text-base font-semibold">Missing books</h2>
										<p className="text-xs text-muted-foreground">
											{missing.length} cop{missing.length === 1 ? 'y' : 'ies'} marked missing
										</p>
									</div>
									<div className="flex items-center gap-1.5 shrink-0">
										<Button
											variant="outline"
											className="h-11 sm:h-8 text-sm"
											onClick={() => setFoundOpen(true)}
											disabled={foundPicked.size === 0 || finding}
										>
											<PackageCheck className="h-4 w-4 mr-1.5" />
											Found {foundPicked.size || ''}
										</Button>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button variant="outline" size="icon" className="h-11 w-11 sm:h-8 sm:w-8 p-0" onClick={() => { void loadMissing() }}>
													<RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Refresh</TooltipContent>
										</Tooltip>
									</div>
								</div>
								<div className="relative mt-3 max-w-sm">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										placeholder="Search accession, title or reason..."
										value={listFilter}
										onChange={e => setListFilter(e.target.value)}
										className="pl-8 h-11 sm:h-8 text-sm"
									/>
								</div>
							</CardHeader>
							<CardContent className="px-4 pb-4 pt-0">
								{listError ? (
									<div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
										<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
										<span>{listError}</span>
									</div>
								) : (
									<div className="rounded-md border mt-3 overflow-x-auto max-h-[520px] overflow-y-auto">
										<Table>
											<TableHeader className="sticky top-0 z-10 bg-muted/50">
												<TableRow>
													<TableHead className="w-10">
														<Checkbox
															checked={allFoundPicked}
															onCheckedChange={on => setFoundPicked(on ? new Set(shownMissing.map(i => i.id)) : new Set())}
															disabled={shownMissing.length === 0}
															aria-label="Select all"
														/>
													</TableHead>
													<TableHead className="text-xs font-semibold">Accession No</TableHead>
													<TableHead className="text-xs font-semibold">Title</TableHead>
													<TableHead className="text-xs font-semibold">Reason</TableHead>
													<TableHead className="text-xs font-semibold">Marked</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{listLoading ? (
													<TableRow>
														<TableCell colSpan={5} className="h-32 text-center">
															<div className="flex flex-col items-center gap-2 text-muted-foreground">
																<RefreshCw className="h-5 w-5 animate-spin" />
																<span className="text-sm">Loading missing books...</span>
															</div>
														</TableCell>
													</TableRow>
												) : shownMissing.length === 0 ? (
													<TableRow>
														<TableCell colSpan={5} className="h-32 text-center">
															<div className="flex flex-col items-center gap-1 text-muted-foreground">
																<BookX className="h-8 w-8 opacity-20" />
																<span className="text-sm">No missing books</span>
															</div>
														</TableCell>
													</TableRow>
												) : shownMissing.map(item => (
													<TableRow key={item.id} className="hover:bg-muted/50">
														<TableCell>
															<Checkbox
																checked={foundPicked.has(item.id)}
																onCheckedChange={on => setFoundPicked(prev => toggle(prev, item.id, !!on))}
																aria-label={`Select ${item.accession_number ?? ''}`}
															/>
														</TableCell>
														<TableCell className="font-mono text-sm whitespace-nowrap">{item.accession_number}</TableCell>
														<TableCell className="max-w-[240px]"><TitleCell item={item} /></TableCell>
														<TableCell className="max-w-[280px] text-sm">
															<OverflowText as="div" text={item.missing_reason ?? '—'} />
														</TableCell>
														<TableCell className="text-xs text-muted-foreground whitespace-nowrap">
															<div>{whenMarked(item.missing_marked_at)}</div>
															{item.missing_marked_by && <div>{item.missing_marked_by}</div>}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								)}
							</CardContent>
						</Card>
					</>
				)}

				{/* Confirm: mark missing */}
				<AlertDialog open={confirmOpen} onOpenChange={o => { if (!marking) setConfirmOpen(o) }}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle className="font-heading">Mark {picked.size} book{picked.size === 1 ? '' : 's'} as missing?</AlertDialogTitle>
							<AlertDialogDescription>
								They stay in the catalogue as Missing and cannot be issued.
								{pickedOnLoan > 0 && ` ${pickedOnLoan} ${pickedOnLoan === 1 ? 'is' : 'are'} on loan — ${pickedOnLoan === 1 ? 'that loan' : 'those loans'} will close and leave the member's list.`}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={marking}>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={e => { e.preventDefault(); void markMissing() }}
								disabled={marking}
								className="bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
							>
								{marking ? 'Marking...' : 'Mark as Missing'}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* Confirm: found */}
				<AlertDialog open={foundOpen} onOpenChange={o => { if (!finding) setFoundOpen(o) }}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle className="font-heading">Mark {foundPicked.size} book{foundPicked.size === 1 ? '' : 's'} as found?</AlertDialogTitle>
							<AlertDialogDescription>
								They go back to Available and can be issued again. The reason is cleared; the activity log keeps it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={finding}>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={e => { e.preventDefault(); void markFound() }}
								disabled={finding}
								className="bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
							>
								{finding ? 'Saving...' : 'Mark as Found'}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</TooltipProvider>
	)
}
