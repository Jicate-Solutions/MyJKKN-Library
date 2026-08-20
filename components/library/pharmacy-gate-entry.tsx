'use client'

/**
 * Gate Entry for the Pharmacy library.
 *
 * The gate is the busiest, dumbest screen in the building: a queue of students,
 * one scanner, and a librarian who cannot look away from the door. So the whole
 * screen is built around one box that always has focus, and one big answer
 * after every scan — IN or OUT, with the face, readable from a step back.
 *
 * The server decides whether a scan is an entry or an exit and stamps the time
 * in IST, so nothing here depends on the browser's clock or on a list that
 * might be a few seconds stale.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useScanFocus } from '@/hooks/library/use-scan-focus'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	RefreshCw, ScanLine, Lock, LogIn, LogOut, Users, Search,
	CalendarDays, Download, DoorClosed, UserCheck,
} from 'lucide-react'
import { istToday, formatClockTime, durationBetween } from '@/lib/library/ist-clock'

interface Visit {
	id: string
	member_id: string
	visit_date: string
	entry_time: string | null
	exit_time: string | null
	member?: {
		id: string
		member_number: string
		display_name: string | null
		member_category: string
	} | null
}

interface ScanResult {
	direction: 'in' | 'out'
	at: string | null
	member: {
		member_number: string
		display_name: string | null
		member_category: string
		is_active: boolean
		photo_url: string | null
	}
}

const CATEGORY_LABELS: Record<string, string> = {
	learner: 'Learner',
	facilitator: 'Facilitator',
	other: 'Other',
	team_member: 'Staff',
	guest: 'Guest',
	alumni: 'Alumni',
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/)
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function PharmacyGateEntry() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const today = istToday()

	const [visits, setVisits] = useState<Visit[]>([])
	const [loading, setLoading] = useState(true)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [barcode, setBarcode] = useState('')
	const [scanning, setScanning] = useState(false)
	const [last, setLast] = useState<ScanResult | null>(null)
	const [viewDate, setViewDate] = useState(today)
	const [search, setSearch] = useState('')
	const [closingDay, setClosingDay] = useState(false)
	const [confirmClose, setConfirmClose] = useState(false)

	// Scanning always writes to today. Looking at an older day is reading the
	// register, not standing at the door, so the scan box goes away with it.
	const isToday = viewDate === today

	// The cursor lives in the scan box whenever the box is there to scan into
	const { inputRef, focusScanBox } = useScanFocus(isToday && !forbidden && !confirmClose)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setForbidden(null)
			const url = appendToUrl(`/api/lib/visits?from_date=${viewDate}&to_date=${viewDate}`)
			const res = await fetch(url)
			if (!res.ok) {
				setForbidden((await res.json()).error || 'You do not have permission to view this page')
				setVisits([])
				return
			}
			setVisits(await res.json())
		} catch {
			toast({ title: 'Failed to load the gate register', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast, viewDate])

	useEffect(() => { fetchData() }, [fetchData])

	// The moment a scan is finished with, the box is ready for the next card
	useEffect(() => { if (!scanning) focusScanBox() }, [scanning, focusScanBox])

	const inside = useMemo(() => visits.filter(v => v.entry_time && !v.exit_time), [visits])

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		if (!term) return visits
		return visits.filter(v =>
			(v.member?.display_name ?? '').toLowerCase().includes(term) ||
			(v.member?.member_number ?? '').toLowerCase().includes(term)
		)
	}, [visits, search])

	const handleScan = async () => {
		const code = barcode.trim()
		if (!code || scanning) return
		if (!institutionId) {
			toast({ title: 'Select the college first', variant: 'destructive' })
			return
		}

		try {
			setScanning(true)
			const res = await fetch('/api/lib/visits/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, barcode: code }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Scan failed')

			setLast(data)
			if (!data.member.is_active) {
				toast({
					title: '⚠️ Membership is not active',
					description: `${data.member.display_name ?? data.member.member_number} was let in, but their membership needs renewing.`,
				})
			}
			fetchData()
		} catch (err) {
			setLast(null)
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Scan failed'), variant: 'destructive' })
		} finally {
			setBarcode('')
			setScanning(false)
			// Straight back to the box — the next student is already at the door
			focusScanBox()
		}
	}

	const markExit = async (visitId: string) => {
		try {
			const res = await fetch('/api/lib/visits/close-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, visit_id: visitId }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not mark the exit')
			fetchData()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		}
	}

	const closeDay = async () => {
		try {
			setClosingDay(true)
			const res = await fetch('/api/lib/visits/close-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, visit_date: viewDate }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Could not close the register')
			toast({
				title: `✅ ${data.closed} marked out at ${formatClockTime(data.exit_time)}`,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			fetchData()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Failed'), variant: 'destructive' })
		} finally {
			setClosingDay(false)
			setConfirmClose(false)
		}
	}

	const exportRegister = () => {
		const rows = filtered.map(v => ({
			Name: v.member?.display_name ?? '',
			'Member ID': v.member?.member_number ?? '',
			Category: CATEGORY_LABELS[v.member?.member_category ?? ''] ?? v.member?.member_category ?? '',
			Date: v.visit_date,
			In: formatClockTime(v.entry_time),
			Out: formatClockTime(v.exit_time),
			Duration: durationBetween(v.entry_time, v.exit_time),
			Status: v.exit_time ? 'Left' : 'Inside',
		}))

		if (rows.length === 0) {
			toast({ title: 'Nothing to export for this day', variant: 'destructive' })
			return
		}

		const sheet = XLSX.utils.json_to_sheet(rows)
		sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }]
		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, sheet, 'Gate Register')
		XLSX.writeFile(book, `gate-register-${viewDate}.xlsx`)
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
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-4 min-h-0">
				{/* Scan box and the two numbers that matter */}
				<div className="grid gap-3 lg:grid-cols-3 flex-shrink-0">
					<Card className="lg:col-span-2 border-l-4 border-l-brand-green dark:border-l-brand-green-400">
						<CardContent className="p-4">
							{isToday ? (
								<div className="flex items-center gap-3">
									<ScanLine className="h-5 w-5 text-brand-green dark:text-brand-green-400 flex-shrink-0" />
									<Input
										ref={inputRef}
										autoFocus
										placeholder="Scan the college ID card, or type the ID and press Enter"
										value={barcode}
										onChange={e => setBarcode(e.target.value)}
										onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
										// Held rather than disabled: a disabled box loses the
										// cursor, and the next card would scan into nothing
										readOnly={scanning}
										className="h-11 text-base min-w-0"
									/>
									<Button
										onClick={handleScan}
										disabled={scanning || !barcode.trim()}
										className="h-11 px-4 sm:px-6 shrink-0 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
									>
										{scanning ? 'Working...' : 'Record'}
									</Button>
								</div>
							) : (
								<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground py-2">
									<CalendarDays className="h-5 w-5 flex-shrink-0" />
									<span>
										You are looking at an older day&apos;s register. Go back to today to scan cards.
									</span>
									<Button variant="outline" size="sm" className="h-8 ml-auto" onClick={() => setViewDate(today)}>
										Back to today
									</Button>
								</div>
							)}

							{/* The answer to the scan, big enough to read from the door */}
							{isToday && last && (
								<div className={`flex items-center gap-4 mt-3 pt-3 border-t ${last.direction === 'in' ? '' : 'opacity-90'}`}>
									<Avatar className="h-14 w-14">
										{last.member.photo_url && <AvatarImage src={last.member.photo_url} alt={last.member.display_name ?? ''} />}
										<AvatarFallback className="text-sm bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
											{initials(last.member.display_name ?? last.member.member_number)}
										</AvatarFallback>
									</Avatar>
									<div className="min-w-0">
										<div className="text-base font-semibold font-heading truncate">
											{last.member.display_name ?? last.member.member_number}
										</div>
										<div className="text-xs text-muted-foreground font-mono">
											{last.member.member_number}
											<span className="ml-2 font-sans">
												{CATEGORY_LABELS[last.member.member_category] ?? last.member.member_category}
											</span>
										</div>
									</div>
									<div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${
										last.direction === 'in'
											? 'bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400'
											: 'bg-brand-yellow-100 text-brand-yellow-800 dark:bg-brand-yellow-900/30 dark:text-brand-yellow-500'
									}`}>
										{last.direction === 'in' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
										<span>{last.direction === 'in' ? 'IN' : 'OUT'}</span>
										<span className="font-normal tabular-nums">{formatClockTime(last.at)}</span>
									</div>
								</div>
							)}
						</CardContent>
					</Card>

					<div className="grid grid-cols-2 gap-3">
						<Card className="border-l-4 border-l-brand-green dark:border-l-brand-green-400">
							<CardContent className="p-4">
								<p className="text-2xl font-bold font-heading text-brand-green dark:text-brand-green-400 tabular-nums">{inside.length}</p>
								<p className="text-xs text-muted-foreground mt-0.5">{isToday ? 'Inside now' : 'Still open'}</p>
							</CardContent>
						</Card>
						<Card className="border-l-4 border-l-brand-yellow">
							<CardContent className="p-4">
								<p className="text-2xl font-bold font-heading text-brand-yellow-800 dark:text-brand-yellow-500 tabular-nums">{visits.length}</p>
								<p className="text-xs text-muted-foreground mt-0.5">{isToday ? "Today's footfall" : 'Footfall'}</p>
							</CardContent>
						</Card>
					</div>
				</div>

				{/* The register itself */}
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex items-center justify-between gap-2 flex-wrap">
							<div>
								<h2 className="text-base font-semibold font-heading">Gate Register</h2>
								<p className="text-xs text-muted-foreground">
									{new Date(`${viewDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
									{!isToday && <span className="ml-2 text-amber-600">· past day</span>}
								</p>
							</div>
							<div className="flex items-center gap-1.5 flex-wrap">
								<Input
									type="date"
									value={viewDate}
									max={today}
									onChange={e => setViewDate(e.target.value || today)}
									className="h-8 w-[150px] shrink-0 text-sm"
								/>
								<div className="relative w-full sm:w-[200px]">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										placeholder="Name or ID"
										value={search}
										onChange={e => setSearch(e.target.value)}
										className="pl-8 h-8 text-sm"
									/>
								</div>
								{inside.length > 0 && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="outline" className="h-8 text-sm px-3" onClick={() => setConfirmClose(true)}>
												<DoorClosed className="h-4 w-4 mr-1.5" />
												<span className="hidden sm:inline">Close day</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>Mark everyone still inside as gone home</TooltipContent>
									</Tooltip>
								)}
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={exportRegister}>
											<Download className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Export this day to Excel</TooltipContent>
								</Tooltip>
								<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
									<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
								</Button>
							</div>
						</div>
					</CardHeader>

					<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
						<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[300px]">
							<div className="h-full overflow-auto">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-muted/50">
										<TableRow>
											<TableHead className="text-xs font-semibold">Member</TableHead>
											<TableHead className="text-xs font-semibold w-[130px]">ID</TableHead>
											<TableHead className="text-xs font-semibold w-[110px] hidden sm:table-cell">Category</TableHead>
											<TableHead className="text-xs font-semibold w-[100px]">In</TableHead>
											<TableHead className="text-xs font-semibold w-[100px]">Out</TableHead>
											<TableHead className="text-xs font-semibold w-[110px] hidden md:table-cell">Stayed</TableHead>
											<TableHead className="text-xs font-semibold w-[130px]">Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
												</TableCell>
											</TableRow>
										) : filtered.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Users className="h-8 w-8 opacity-20" />
														<span className="text-sm">
															{search ? 'Nobody matches that' : isToday ? 'Nobody has come in yet today' : 'Nobody came in on this day'}
														</span>
													</div>
												</TableCell>
											</TableRow>
										) : filtered.map(v => (
											<TableRow key={v.id} className="hover:bg-muted/50">
												<TableCell className="text-sm font-medium">{v.member?.display_name ?? '—'}</TableCell>
												<TableCell className="text-sm text-muted-foreground font-mono">{v.member?.member_number ?? '—'}</TableCell>
												<TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
													{CATEGORY_LABELS[v.member?.member_category ?? ''] ?? v.member?.member_category ?? '—'}
												</TableCell>
												<TableCell className="text-sm tabular-nums">{formatClockTime(v.entry_time)}</TableCell>
												<TableCell className="text-sm tabular-nums">{formatClockTime(v.exit_time)}</TableCell>
												<TableCell className="text-sm text-muted-foreground hidden md:table-cell">
													{durationBetween(v.entry_time, v.exit_time)}
												</TableCell>
												<TableCell>
													{v.exit_time ? (
														<Badge variant="outline" className="text-xs">Left</Badge>
													) : (
														<div className="flex items-center gap-1.5">
															<Badge variant="outline" className="text-xs bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/30 dark:text-brand-green-400 dark:border-brand-green-700">
																Inside
															</Badge>
															{/* For the ones who walk out without scanning */}
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button
																		variant="ghost"
																		size="icon"
																		className="h-6 w-6 p-0"
																		onClick={() => markExit(v.id)}
																	>
																		<UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
																	</Button>
																</TooltipTrigger>
																<TooltipContent>Mark this person out now</TooltipContent>
															</Tooltip>
														</div>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>
					</CardContent>
				</Card>

				<AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Close the register for this day?</AlertDialogTitle>
							<AlertDialogDescription>
								<strong>{inside.length}</strong> {inside.length === 1 ? 'person is' : 'people are'} still showing as inside.
								They will be marked out at the library&apos;s closing time — the honest answer when nobody
								saw them leave. Do this at the end of the day, not in the middle of it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={closeDay} disabled={closingDay}>
								{closingDay ? 'Closing...' : `Mark ${inside.length} out`}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</TooltipProvider>
	)
}
