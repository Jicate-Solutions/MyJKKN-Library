'use client'

/**
 * One department library: what is on its shelf, what can be sent to it, and
 * everything that has moved either way.
 *
 * The three tabs are the three questions a librarian actually has. What is out
 * there? Send this one out. Where did that book go?
 *
 * The switch in the books table is the small door the design turns on. A
 * department collection is for reference, so books arrive with issuing off and
 * the circulation desk refuses them. When one or two genuinely need to go out,
 * this turns that copy on and the desk issues it like any other book — because
 * the switch is on the copy, opening two books does not open the department.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	fetchDepartmentBooks,
	fetchTransferCandidates,
	transferBooks,
	setBookIssuable,
	fetchTransferHistory,
} from '@/services/library/lib-departments-service'
import { blockedReason } from '@/lib/library/department-transfer-rules'
import type { DepartmentBook, TransferCandidate, DepartmentTransfer } from '@/types/lib-departments'
import {
	ArrowLeft, RefreshCw, Search, BookOpen, Send, History, Undo2,
	UserCheck, AlertTriangle,
} from 'lucide-react'

const SUCCESS_TOAST =
	'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300'

/** A date as a librarian writes it, not as the database stores it. */
function readableDate(value: string | null): string {
	if (!value) return '—'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '—'
	return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DepartmentLibraryPage() {
	const params = useParams()
	const locationId = String(params?.id ?? '')
	const { toast } = useToast()

	const [books, setBooks] = useState<DepartmentBook[]>([])
	const [departmentName, setDepartmentName] = useState<string | null>(null)
	const [defaultLendable, setDefaultLendable] = useState(false)
	const [loading, setLoading] = useState(true)
	const [problem, setProblem] = useState<string | null>(null)

	const [shelfSearch, setShelfSearch] = useState('')
	const [picked, setPicked] = useState<Set<string>>(new Set())

	const [query, setQuery] = useState('')
	const [candidates, setCandidates] = useState<TransferCandidate[]>([])
	const [candidateTotal, setCandidateTotal] = useState(0)
	const [candidateHasMore, setCandidateHasMore] = useState(false)
	const [candidateTruncated, setCandidateTruncated] = useState(false)
	const [candidatePage, setCandidatePage] = useState(0)
	const [loadingCandidates, setLoadingCandidates] = useState(false)
	const [searching, setSearching] = useState(false)
	const [toSend, setToSend] = useState<Set<string>>(new Set())
	const [remarks, setRemarks] = useState('')
	const [sending, setSending] = useState(false)

	const [history, setHistory] = useState<DepartmentTransfer[]>([])
	const [historyLoaded, setHistoryLoaded] = useState(false)

	const [confirmReturn, setConfirmReturn] = useState(false)

	const load = useCallback(async () => {
		if (!locationId) return
		try {
			setLoading(true)
			setProblem(null)
			const result = await fetchDepartmentBooks(locationId)
			setBooks(result.books)
			setDepartmentName(result.departmentName)
			setDefaultLendable(result.defaultLendable)
			setPicked(new Set())
		} catch (err) {
			setProblem(err instanceof Error ? err.message : 'Failed to load this department library')
		} finally {
			setLoading(false)
		}
	}, [locationId])

	useEffect(() => { load() }, [load])

	/**
	 * The shelf this department can draw from.
	 *
	 * Loaded as soon as the page opens, with nothing typed — the screen shows
	 * what is available rather than making somebody guess a title to see
	 * anything at all. Typing narrows the same list.
	 */
	const loadCandidates = useCallback(async (term: string, page: number) => {
		if (!locationId) return
		try {
			setLoadingCandidates(true)
			const result = await fetchTransferCandidates(locationId, { search: term, page })

			// Page 0 replaces; later pages add to what is already listed
			setCandidates(prev => (page === 0 ? result.candidates : [...prev, ...result.candidates]))
			setCandidateTotal(result.total)
			setCandidateHasMore(result.hasMore)
			setCandidateTruncated(result.truncated)
			setCandidatePage(page)
		} catch (err) {
			if (page === 0) {
				setCandidates([])
				setCandidateTotal(0)
				setCandidateHasMore(false)
			}
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to load the shelf'),
				variant: 'destructive',
			})
		} finally {
			setLoadingCandidates(false)
			setSearching(false)
		}
	}, [locationId, toast])

	// One request after the typing stops, not one per keystroke. An empty box is
	// not a special case — it simply asks for the first page of everything.
	useEffect(() => {
		const term = query.trim()
		setSearching(true)
		const timer = setTimeout(() => { loadCandidates(term, 0) }, 300)
		return () => clearTimeout(timer)
	}, [query, loadCandidates])

	const loadMoreCandidates = () => { loadCandidates(query.trim(), candidatePage + 1) }

	const togglePicked = (candidate: TransferCandidate) => {
		// A copy the server would refuse is never put in the basket, so the count
		// on the button is the number that will actually move.
		if (blockedReason(candidate.status)) return
		setToSend(prev => {
			const next = new Set(prev)
			if (next.has(candidate.id)) next.delete(candidate.id)
			else next.add(candidate.id)
			return next
		})
	}

	/**
	 * Everything listed, ticked or cleared together.
	 *
	 * Only what is on screen. Selecting the pages nobody has scrolled to would
	 * mean sending thousands of books on one click, which is not what "select
	 * all" reads as to the person pressing it.
	 */
	const toggleAllShown = (checked: boolean) => {
		setToSend(prev => {
			const next = new Set(prev)
			for (const candidate of movableShown) {
				if (checked) next.add(candidate.id)
				else next.delete(candidate.id)
			}
			return next
		})
	}

	/** Listed copies that are actually free to go — what Select all works on. */
	const movableShown = candidates.filter(c => !blockedReason(c.status))
	const blockedShown = candidates.length - movableShown.length
	const allShownPicked = movableShown.length > 0 && movableShown.every(c => toSend.has(c.id))

	/** Nothing ticked — the send bar stays on screen but does nothing. */
	const nothingPicked = toSend.size === 0

	const loadHistory = useCallback(async () => {
		try {
			setHistory(await fetchTransferHistory(locationId))
		} catch {
			setHistory([])
		} finally {
			setHistoryLoaded(true)
		}
	}, [locationId])

	const shownBooks = useMemo(() => {
		if (!shelfSearch.trim()) return books
		const q = shelfSearch.trim().toLowerCase()
		return books.filter(b =>
			b.accession_number.toLowerCase().includes(q) ||
			b.title.toLowerCase().includes(q) ||
			(b.author?.toLowerCase().includes(q) ?? false)
		)
	}, [books, shelfSearch])

	const issuableCount = books.filter(b => b.is_lendable).length

	const toggleIssuable = async (book: DepartmentBook, next: boolean) => {
		// Moved on screen first so the switch answers the finger, then put back
		// if the server refuses. A switch that waits on a round trip feels broken.
		setBooks(prev => prev.map(b => (b.id === book.id ? { ...b, is_lendable: next } : b)))
		try {
			await setBookIssuable(book.id, next)
			toast({
				title: next ? '✅ This copy can now be issued' : '✅ Back to reference only',
				description: `${book.accession_number} — ${book.title}`,
				className: SUCCESS_TOAST,
			})
		} catch (err) {
			setBooks(prev => prev.map(b => (b.id === book.id ? { ...b, is_lendable: !next } : b)))
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to save'),
				variant: 'destructive',
			})
		}
	}

	const send = async () => {
		if (toSend.size === 0) return
		try {
			setSending(true)
			const result = await transferBooks({
				location_id: locationId,
				item_ids: [...toSend],
				direction: 'to_department',
				remarks: remarks.trim() || undefined,
			})

			toast({
				title: `✅ ${result.moved} book${result.moved === 1 ? '' : 's'} sent`,
				description: result.refused.length
					? `${result.refused.length} could not be moved: ${result.refused.map(r => `${r.accession_number} (${r.why})`).join(', ')}`
					: result.reference_only
						? 'They arrived as reference only, as this department is set up.'
						: 'They arrived and can be issued.',
				className: SUCCESS_TOAST,
			})

			// The copies just sent are no longer on the main shelf, so the list
			// they came from is rebuilt rather than left showing books that have
			// already gone.
			setToSend(new Set())
			setRemarks('')
			setHistoryLoaded(false)
			loadCandidates(query.trim(), 0)
			load()
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to send'),
				variant: 'destructive',
			})
		} finally {
			setSending(false)
		}
	}

	const sendBack = async () => {
		if (picked.size === 0) return
		try {
			setSending(true)
			const result = await transferBooks({
				location_id: locationId,
				item_ids: [...picked],
				direction: 'to_main',
			})

			toast({
				title: `✅ ${result.moved} book${result.moved === 1 ? '' : 's'} returned to the main library`,
				description: result.refused.length
					? `${result.refused.length} could not be moved: ${result.refused.map(r => `${r.accession_number} (${r.why})`).join(', ')}`
					: 'Each went back to the shelf it came from.',
				className: SUCCESS_TOAST,
			})

			setConfirmReturn(false)
			setHistoryLoaded(false)
			load()
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to return'),
				variant: 'destructive',
			})
		} finally {
			setSending(false)
		}
	}

	if (problem) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<Card className="w-full max-w-md border-l-4 border-l-destructive">
					<CardContent className="p-8 text-center">
						<AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive/50" />
						<h2 className="mb-1 text-base font-semibold font-heading">Could not open this department</h2>
						<p className="mb-4 text-sm text-muted-foreground">{problem}</p>
						<Button asChild variant="outline" size="sm">
							<Link href="/departments">
								<ArrowLeft className="mr-1.5 h-4 w-4" /> Back to departments
							</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0 p-0">
						<Link href="/departments"><ArrowLeft className="h-4 w-4" /></Link>
					</Button>
					<div className="min-w-0">
						<h1 className="truncate text-lg font-semibold font-heading">
							{departmentName ?? 'Department library'}
						</h1>
						<p className="text-xs text-muted-foreground">
							{books.length} book{books.length === 1 ? '' : 's'} on this shelf
							{issuableCount > 0 && ` · ${issuableCount} can be issued`}
							{!defaultLendable && ' · new arrivals are reference only'}
						</p>
					</div>
				</div>
				<Button variant="outline" size="icon" className="h-8 w-8 shrink-0 p-0" onClick={load}>
					<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/*
			 * `data-[state=active]:flex` rather than a plain `flex`, and this is not
			 * cosmetic.
			 *
			 * Radix does not unmount a tab panel once it has been opened — it keeps
			 * the div and sets the `hidden` attribute, with no children inside. A
			 * `flex` class is an author style and beats the browser's own
			 * `[hidden] { display: none }`, so every panel already visited stayed
			 * laid out as an EMPTY flex-1 box and took a share of the height. Open
			 * the second tab and its card was pushed down by one empty box; open the
			 * third and it was pushed down by two.
			 *
			 * Giving the display only to the active panel lets `hidden` do its job
			 * on the rest.
			 */}
			<Tabs defaultValue="shelf" className="flex min-h-0 flex-1 flex-col">
				{/* On a phone three tabs are wider than the screen, so the strip
				    scrolls sideways instead of the labels being squeezed */}
				<TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
					<TabsTrigger value="shelf" className="shrink-0 text-xs">
						<BookOpen className="mr-1.5 h-3.5 w-3.5" /> On this shelf
					</TabsTrigger>
					<TabsTrigger value="send" className="shrink-0 text-xs">
						<Send className="mr-1.5 h-3.5 w-3.5" /> Send books here
					</TabsTrigger>
					<TabsTrigger
						value="history"
						className="shrink-0 text-xs"
						onClick={() => { if (!historyLoaded) loadHistory() }}
					>
						<History className="mr-1.5 h-3.5 w-3.5" /> History
					</TabsTrigger>
				</TabsList>

				{/* ── What is on the department shelf ─────────────────────────── */}
				<TabsContent value="shelf" className="mt-3 min-h-0 flex-1 flex-col data-[state=active]:flex">
					<Card className="flex min-h-0 flex-1 flex-col">
						<CardHeader className="flex-shrink-0 border-b px-4 py-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="relative max-w-sm flex-1">
									<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Search accession number or title..."
										value={shelfSearch}
										onChange={e => setShelfSearch(e.target.value)}
										className="h-8 pl-8 text-sm"
									/>
								</div>
								{picked.size > 0 && (
									<Button
										variant="outline" size="sm" className="h-8 text-xs"
										onClick={() => setConfirmReturn(true)}
									>
										<Undo2 className="mr-1.5 h-3.5 w-3.5" />
										Send {picked.size} back to the main library
									</Button>
								)}
							</div>
						</CardHeader>

						<CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-0">
							<div className="mt-3 min-h-[340px] flex-1 overflow-hidden rounded-md border">
								<div className="h-full overflow-auto">
									<Table className="min-w-[720px]">
										<TableHeader className="sticky top-0 z-10 bg-muted/50">
											<TableRow>
												<TableHead className="w-[40px]"></TableHead>
												<TableHead className="w-[130px] text-xs font-semibold">Accession</TableHead>
												<TableHead className="text-xs font-semibold">Title</TableHead>
												<TableHead className="w-[110px] text-xs font-semibold">Status</TableHead>
												<TableHead className="w-[180px] text-xs font-semibold">Can be issued</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{loading ? (
												<TableRow>
													<TableCell colSpan={5} className="h-32 text-center">
														<RefreshCw className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
													</TableCell>
												</TableRow>
											) : shownBooks.length === 0 ? (
												<TableRow>
													<TableCell colSpan={5} className="h-32 text-center">
														<div className="flex flex-col items-center gap-1 text-muted-foreground">
															<BookOpen className="h-8 w-8 opacity-20" />
															<span className="text-sm">
																{shelfSearch
																	? 'No book here matches that'
																	: 'Nothing has been sent to this department yet'}
															</span>
														</div>
													</TableCell>
												</TableRow>
											) : shownBooks.map(book => (
												<TableRow key={book.id} className="hover:bg-muted/50">
													<TableCell>
														<Checkbox
															checked={picked.has(book.id)}
															onCheckedChange={checked => {
																setPicked(prev => {
																	const next = new Set(prev)
																	if (checked) next.add(book.id)
																	else next.delete(book.id)
																	return next
																})
															}}
														/>
													</TableCell>
													<TableCell>
														<Badge variant="outline" className="font-mono text-xs">
															{book.accession_number}
														</Badge>
													</TableCell>
													<TableCell>
														<p className="text-sm font-medium">{book.title}</p>
														<p className="text-xs text-muted-foreground">
															{book.author || 'Author not recorded'}
															{book.call_number ? ` · ${book.call_number}` : ''}
														</p>
													</TableCell>
													<TableCell>
														{book.status === 'on_loan' ? (
															<div>
																<Badge variant="secondary" className="text-[10px]">Out</Badge>
																{book.on_loan_to && (
																	<p className="mt-0.5 truncate text-[10px] text-muted-foreground">
																		{book.on_loan_to}
																	</p>
																)}
															</div>
														) : (
															<Badge variant="outline" className="text-[10px]">{book.status}</Badge>
														)}
													</TableCell>
													<TableCell>
														<div className="flex items-center gap-2">
															<Switch
																checked={book.is_lendable}
																onCheckedChange={next => toggleIssuable(book, next)}
															/>
															<span className="text-xs text-muted-foreground">
																{book.is_lendable ? 'Yes' : 'Reference only'}
															</span>
														</div>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Sending books out from the main library ─────────────────── */}
				<TabsContent value="send" className="mt-3 min-h-0 flex-1 flex-col data-[state=active]:flex">
					<Card className="flex min-h-0 flex-1 flex-col">
						<CardHeader className="flex-shrink-0 border-b px-4 py-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="relative w-full max-w-md">
									<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Search accession, barcode, title, author, ISBN, call number..."
										value={query}
										onChange={e => setQuery(e.target.value)}
										className="h-8 pl-8 text-sm"
									/>
									{searching && (
										<RefreshCw className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
									)}
								</div>
								<div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
									<span>
										{loadingCandidates && candidates.length === 0
											? 'Loading the shelf...'
											: `${candidates.length} of ${candidateTotal} shown`}
										{blockedShown > 0 && ` · ${blockedShown} out`}
									</span>
									{toSend.size > 0 && (
										<Badge variant="outline" className="text-[10px]">{toSend.size} picked</Badge>
									)}
								</div>
							</div>
							<p className="mt-2 text-xs text-muted-foreground">
								Every copy this college holds is listed. One that is out with a member still
								shows, so you can see it exists — it just cannot be ticked until it is back.
								{candidateTruncated && ' Too many matches to show them all; type a little more to narrow it.'}
							</p>
						</CardHeader>

						<CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-0">
							<div className="mt-3 min-h-[260px] flex-1 overflow-hidden rounded-md border">
								<div className="h-full overflow-auto">
									<Table className="min-w-[620px]">
										<TableHeader className="sticky top-0 z-10 bg-muted/50">
											<TableRow>
												<TableHead className="w-[40px]">
													{/* Ticks everything currently listed — never the part of the
													    shelf that has not been loaded, which would be selecting
													    thousands of books nobody has looked at */}
													<Checkbox
														checked={allShownPicked}
														onCheckedChange={checked => toggleAllShown(checked === true)}
														disabled={movableShown.length === 0}
														aria-label="Select everything listed that can be moved"
													/>
												</TableHead>
												<TableHead className="w-[130px] text-xs font-semibold">Accession</TableHead>
												<TableHead className="text-xs font-semibold">Title</TableHead>
												<TableHead className="w-[160px] text-xs font-semibold">Now on</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{candidates.length === 0 ? (
												<TableRow>
													<TableCell colSpan={4} className="h-32 text-center">
														<div className="flex flex-col items-center gap-1 text-muted-foreground">
															{loadingCandidates ? (
																<RefreshCw className="h-5 w-5 animate-spin" />
															) : (
																<>
																	<Send className="h-8 w-8 opacity-20" />
																	<span className="text-sm">
																		{query.trim()
																			? 'Nothing on the shelf matches that'
																			: 'This college has no copies to send'}
																	</span>
																</>
															)}
														</div>
													</TableCell>
												</TableRow>
											) : candidates.map(candidate => {
												const picked = toSend.has(candidate.id)
												// Listed whatever its status — somebody looking for accession 101
												// must see that it exists and that it is out, not an empty result
												// that reads as "no such book". Only the tick is withheld.
												const blocked = blockedReason(candidate.status)
												return (
													<TableRow
														key={candidate.id}
														data-state={picked ? 'selected' : undefined}
														// The whole row is a target, not just the 16px box —
														// picking forty books should not be forty precise clicks
														onClick={() => togglePicked(candidate)}
														className={
															blocked
																? 'cursor-not-allowed opacity-60'
																: 'cursor-pointer hover:bg-muted/50'
														}
													>
														<TableCell onClick={e => e.stopPropagation()}>
															<Checkbox
																checked={picked}
																disabled={!!blocked}
																onCheckedChange={() => togglePicked(candidate)}
																aria-label={
																	blocked
																		? `${candidate.accession_number} cannot be moved — ${blocked}`
																		: `Select ${candidate.accession_number}`
																}
															/>
														</TableCell>
														<TableCell>
															<Badge variant="outline" className="font-mono text-xs">
																{candidate.accession_number}
															</Badge>
														</TableCell>
														<TableCell>
															<p className="text-sm font-medium">{candidate.title}</p>
															<p className="text-xs text-muted-foreground">
																{candidate.author || 'Author not recorded'}
																{` · copy ${candidate.copy_number}`}
																{candidate.call_number ? ` · ${candidate.call_number}` : ''}
															</p>
														</TableCell>
														<TableCell className="text-xs text-muted-foreground">
															{blocked ? (
																<Badge variant="secondary" className="text-[10px]">{blocked}</Badge>
															) : candidate.location_code ? (
																`${candidate.location_code}${candidate.location_name ? ` — ${candidate.location_name}` : ''}`
															) : (
																'On the shelf'
															)}
														</TableCell>
													</TableRow>
												)
											})}

											{candidateHasMore && (
												<TableRow>
													<TableCell colSpan={4} className="py-3 text-center">
														<Button
															variant="outline" size="sm" className="h-7 text-xs"
															disabled={loadingCandidates}
															onClick={loadMoreCandidates}
														>
															{loadingCandidates
																? 'Loading...'
																: `Show 10 more — ${candidateTotal - candidates.length} still to come`}
														</Button>
													</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
								</div>
							</div>

							{/*
							 * Always on screen, empty or not.
							 *
							 * It used to appear only once something was ticked, which meant
							 * the table jumped down the moment you picked your first book
							 * and jumped back when you cleared — and until you had ticked
							 * one, there was nothing on screen saying what ticking was for.
							 * Standing still and showing 0 answers both.
							 */}
							<div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<UserCheck
										className={`h-4 w-4 ${
											nothingPicked ? 'text-muted-foreground' : 'text-brand-green dark:text-brand-green-400'
										}`}
									/>
									<span className={nothingPicked ? 'text-muted-foreground' : 'font-medium'}>
										{toSend.size} book{toSend.size === 1 ? '' : 's'} ready to send
									</span>
									<Badge variant={defaultLendable ? 'outline' : 'secondary'} className="text-[10px]">
										{defaultLendable ? 'Will arrive issuable' : 'Will arrive reference only'}
									</Badge>
									{nothingPicked && (
										<span className="text-xs text-muted-foreground">
											— tick a book above to start
										</span>
									)}
								</div>
								<Textarea
									placeholder="A note for the record — who collected them, why they went (optional)"
									value={remarks}
									onChange={e => setRemarks(e.target.value)}
									disabled={nothingPicked || sending}
									className="min-h-[60px] text-sm"
								/>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										onClick={send}
										disabled={nothingPicked || sending}
										size="sm"
										className="bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
									>
										<Send className="mr-1.5 h-3.5 w-3.5" />
										{sending
											? 'Sending...'
											: `Send ${toSend.size} to ${departmentName ?? 'this department'}`}
									</Button>
									<Button
										variant="ghost" size="sm"
										onClick={() => setToSend(new Set())}
										disabled={nothingPicked || sending}
									>
										Clear
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Everything that has moved ───────────────────────────────── */}
				<TabsContent value="history" className="mt-3 min-h-0 flex-1 flex-col data-[state=active]:flex">
					<Card className="flex min-h-0 flex-1 flex-col">
						<CardHeader className="flex-shrink-0 border-b px-4 py-3">
							<h2 className="text-sm font-semibold font-heading">Movements</h2>
							<p className="text-xs text-muted-foreground">
								Names are recorded as they were on the day — a line from two years ago still
								reads correctly after a department is renamed or an in-charge leaves.
							</p>
						</CardHeader>
						<CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-0">
							<div className="mt-3 min-h-[300px] flex-1 overflow-hidden rounded-md border">
								<div className="h-full overflow-auto">
									<Table className="min-w-[760px]">
										<TableHeader className="sticky top-0 z-10 bg-muted/50">
											<TableRow>
												<TableHead className="w-[120px] text-xs font-semibold">When</TableHead>
												<TableHead className="w-[110px] text-xs font-semibold">Direction</TableHead>
												<TableHead className="w-[130px] text-xs font-semibold">Accession</TableHead>
												<TableHead className="text-xs font-semibold">Title</TableHead>
												<TableHead className="w-[160px] text-xs font-semibold">By</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{!historyLoaded ? (
												<TableRow>
													<TableCell colSpan={5} className="h-32 text-center">
														<RefreshCw className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
													</TableCell>
												</TableRow>
											) : history.length === 0 ? (
												<TableRow>
													<TableCell colSpan={5} className="h-32 text-center">
														<div className="flex flex-col items-center gap-1 text-muted-foreground">
															<History className="h-8 w-8 opacity-20" />
															<span className="text-sm">Nothing has moved yet</span>
														</div>
													</TableCell>
												</TableRow>
											) : history.map(line => (
												<TableRow key={line.id} className="hover:bg-muted/50">
													<TableCell className="text-xs">{readableDate(line.moved_at)}</TableCell>
													<TableCell>
														{line.direction === 'to_department' ? (
															<Badge variant="outline" className="text-[10px]">Sent out</Badge>
														) : (
															<Badge variant="secondary" className="text-[10px]">Came back</Badge>
														)}
													</TableCell>
													<TableCell>
														<span className="font-mono text-xs">{line.accession_number ?? '—'}</span>
													</TableCell>
													<TableCell className="text-sm">
														{line.title ?? '—'}
														{line.remarks && (
															<p className="text-xs text-muted-foreground">{line.remarks}</p>
														)}
													</TableCell>
													<TableCell className="truncate text-xs text-muted-foreground">
														{line.moved_by_name ?? '—'}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			<AlertDialog open={confirmReturn} onOpenChange={setConfirmReturn}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">Send back to the main library</AlertDialogTitle>
						<AlertDialogDescription>
							{picked.size} book{picked.size === 1 ? '' : 's'} will go back to the shelf each one
							came from, and become issuable again. A copy that is currently out with a member
							will be left where it is.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={e => { e.preventDefault(); sendBack() }} disabled={sending}>
							{sending ? 'Moving...' : 'Send them back'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
