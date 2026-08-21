'use client'

/**
 * Gate Entry as the other six campuses have always had it. Moved here untouched
 * when Pharmacy got its own version — every line below is exactly what was on
 * the page before, so nothing changes for them.
 *
 * Gate Entry — who is in the library right now, and who came today.
 *
 * The desk scans a college ID card, or the librarian types the ID. The same
 * scan is an entry the first time and an exit the second time, so there is one
 * box to think about, not two. Footfall is what inspection asks for.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useScanFocus } from '@/hooks/library/use-scan-focus'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { RefreshCw, ScanLine, Lock, LogIn, LogOut, Users } from 'lucide-react'

interface Visit {
	id: string
	member_id: string
	visit_date: string
	entry_time: string | null
	exit_time: string | null
	visit_purpose: string | null
	member?: {
		id: string
		member_number: string
		display_name: string | null
		member_category: string
	} | null
}

/** What POST /api/lib/visits/scan answers with. */
interface ScanResult {
	direction: 'in' | 'out'
	visit: {
		id: string | null
		visit_date: string
		entry_time: string | null
		exit_time: string | null
	}
	member: {
		id: string
		member_number: string
		display_name: string | null
		member_category: string
		is_active: boolean
		photo_url: string | null
	}
}

function timeOnly(value: string | null): string {
	if (!value) return '—'
	const d = new Date(value.includes('T') ? value : `1970-01-01T${value}`)
	if (Number.isNaN(d.getTime())) return value
	return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function StandardGateEntry() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const [visits, setVisits] = useState<Visit[]>([])
	const [loading, setLoading] = useState(true)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [barcode, setBarcode] = useState('')
	const [scanning, setScanning] = useState(false)
	const [lastPerson, setLastPerson] = useState<{ name: string; photo: string | null; direction: 'in' | 'out' } | null>(null)

	const today = new Date().toISOString().split('T')[0]

	// The cursor lives in the scan box, so card after card can be scanned
	// without anybody reaching for the mouse
	const { inputRef, focusScanBox } = useScanFocus(!forbidden)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setForbidden(null)
			const url = appendToUrl(`/api/lib/visits?from_date=${today}&to_date=${today}`)
			const res = await fetch(url)
			if (!res.ok) {
				setForbidden((await res.json()).error || 'You do not have permission to view this page')
				setVisits([])
				return
			}
			setVisits(await res.json())
		} catch {
			toast({ title: 'Failed to load gate entries', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast, today])

	useEffect(() => { fetchData() }, [fetchData])

	// The moment a scan is finished with, the box is ready for the next card
	useEffect(() => { if (!scanning) focusScanBox() }, [scanning, focusScanBox])

	const inside = useMemo(() => visits.filter(v => v.entry_time && !v.exit_time), [visits])

	/**
	 * Puts one scan's result into the register on screen.
	 *
	 * An exit closes the line that is already there; an entry starts a new one at
	 * the top, which is where the day's newest visit belongs.
	 */
	const mergeScan = useCallback((result: ScanResult) => {
		const { visit, member, direction } = result
		const visitId = visit?.id
		if (!visitId) return

		setVisits(prev => {
			if (direction === 'out') {
				return prev.map(v => (v.id === visitId ? { ...v, exit_time: visit.exit_time } : v))
			}

			const line: Visit = {
				id: visitId,
				member_id: member.id,
				visit_date: visit.visit_date,
				entry_time: visit.entry_time,
				exit_time: null,
				visit_purpose: null,
				member: {
					id: member.id,
					member_number: member.member_number,
					display_name: member.display_name,
					member_category: member.member_category,
				},
			}
			return [line, ...prev.filter(v => v.id !== line.id)]
		})
	}, [])

	const handleScan = async () => {
		const code = barcode.trim()
		if (!code || scanning) return
		if (!institutionId) {
			toast({ title: 'Select an institution first', variant: 'destructive' })
			return
		}

		try {
			setScanning(true)

			// One call for the whole scan.
			//
			// This used to look the person up through the circulation desk's own
			// route — which also worked out their loans, their fines, their
			// category's rules and their open books, none of which the gate shows
			// — and then made a second call to write the visit. Two round trips a
			// scan, most of the first one wasted.
			//
			// The server decides entry or exit, as it must: two quick scans of one
			// card would both read the same loaded list, both conclude "not inside
			// yet", and open two visits for one person.
			const res = await fetch('/api/lib/visits/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, barcode: code }),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Scan failed')

			const person = data.member
			setLastPerson({
				name: person.display_name ?? person.member_number,
				photo: person.photo_url,
				direction: data.direction,
			})

			// The register on screen is corrected from the answer just received,
			// rather than the whole day being read again after every scan
			mergeScan(data)

			setBarcode('')
			focusScanBox()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Scan failed'), variant: 'destructive' })
			setBarcode('')
			focusScanBox()
		} finally {
			setScanning(false)
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
		<div className="flex flex-1 flex-col gap-4 min-h-0">
			{/* Scan box + counts */}
			<div className="grid gap-3 lg:grid-cols-3 flex-shrink-0">
				<Card className="lg:col-span-2 border-l-4 border-l-brand-green dark:border-l-brand-green-400">
					<CardContent className="p-4">
						<div className="flex items-center gap-3">
							<ScanLine className="h-5 w-5 text-brand-green dark:text-brand-green-400 flex-shrink-0" />
							<Input
								ref={inputRef}
								autoFocus
								placeholder="Scan the college ID card, or type the ID and press Enter"
								value={barcode}
								onChange={e => setBarcode(e.target.value)}
								onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
								// Held rather than disabled: a disabled box loses the cursor,
								// and the next card would scan into nothing
								readOnly={scanning}
								className="h-10 text-sm min-w-0"
							/>
							<Button
								onClick={handleScan}
								disabled={scanning || !barcode.trim()}
								className="h-10 shrink-0 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
							>
								{scanning ? 'Working...' : 'Record'}
							</Button>
						</div>

						{lastPerson && (
							<div className="flex items-center gap-3 mt-3 pt-3 border-t">
								<Avatar className="h-10 w-10">
									{lastPerson.photo && <AvatarImage src={lastPerson.photo} alt={lastPerson.name} />}
									<AvatarFallback className="text-xs bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-green-400">
										{lastPerson.name.slice(0, 2).toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<div>
									<div className="text-sm font-medium">{lastPerson.name}</div>
									<div className={`text-xs flex items-center gap-1 ${lastPerson.direction === 'in' ? 'text-brand-green dark:text-brand-green-400' : 'text-muted-foreground'}`}>
										{lastPerson.direction === 'in'
											? <><LogIn className="h-3 w-3" /> Entry recorded</>
											: <><LogOut className="h-3 w-3" /> Exit recorded</>}
									</div>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<div className="grid grid-cols-2 gap-3">
					<Card className="border-l-4 border-l-brand-green dark:border-l-brand-green-400">
						<CardContent className="p-4">
							<p className="text-2xl font-bold font-heading text-brand-green dark:text-brand-green-400">{inside.length}</p>
							<p className="text-xs text-muted-foreground mt-0.5">Inside now</p>
						</CardContent>
					</Card>
					<Card className="border-l-4 border-l-brand-yellow">
						<CardContent className="p-4">
							<p className="text-2xl font-bold font-heading text-brand-yellow-800 dark:text-brand-yellow-500">{visits.length}</p>
							<p className="text-xs text-muted-foreground mt-0.5">Today's footfall</p>
						</CardContent>
					</Card>
				</div>
			</div>

			<Card className="flex-1 flex flex-col min-h-0">
				<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<h2 className="text-base font-semibold font-heading">Today's Gate Register</h2>
							<p className="text-xs text-muted-foreground">
								{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
							</p>
						</div>
						<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
							<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
						</Button>
					</div>
				</CardHeader>

				<CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col min-h-0">
					<div className="rounded-md border flex-1 overflow-hidden mt-3 min-h-[300px]">
						<div className="h-full overflow-auto">
							<Table>
								<TableHeader className="sticky top-0 z-10 bg-muted/50">
									<TableRow>
										<TableHead className="text-xs font-semibold">Member</TableHead>
										<TableHead className="text-xs font-semibold w-[140px]">ID</TableHead>
										<TableHead className="text-xs font-semibold w-[110px]">In</TableHead>
										<TableHead className="text-xs font-semibold w-[110px]">Out</TableHead>
										<TableHead className="text-xs font-semibold w-[100px]">Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading ? (
										<TableRow>
											<TableCell colSpan={5} className="h-32 text-center">
												<RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
											</TableCell>
										</TableRow>
									) : visits.length === 0 ? (
										<TableRow>
											<TableCell colSpan={5} className="h-32 text-center">
												<div className="flex flex-col items-center gap-1 text-muted-foreground">
													<Users className="h-8 w-8 opacity-20" />
													<span className="text-sm">Nobody has come in yet today</span>
												</div>
											</TableCell>
										</TableRow>
									) : visits.map(v => (
										<TableRow key={v.id} className="hover:bg-muted/50">
											<TableCell className="text-sm font-medium">{v.member?.display_name ?? '—'}</TableCell>
											<TableCell className="text-sm text-muted-foreground font-mono">{v.member?.member_number ?? '—'}</TableCell>
											<TableCell className="text-sm">{timeOnly(v.entry_time)}</TableCell>
											<TableCell className="text-sm">{timeOnly(v.exit_time)}</TableCell>
											<TableCell>
												{v.exit_time ? (
													<Badge variant="outline" className="text-xs">Left</Badge>
												) : (
													<Badge variant="outline" className="text-xs bg-brand-green-50 text-brand-green-700 border-brand-green-200 dark:bg-brand-green-900/30 dark:text-brand-green-400 dark:border-brand-green-700">
														Inside
													</Badge>
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
		</div>
	)
}
