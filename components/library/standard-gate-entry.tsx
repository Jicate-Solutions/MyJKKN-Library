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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
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

function timeOnly(value: string | null): string {
	if (!value) return '—'
	const d = new Date(value.includes('T') ? value : `1970-01-01T${value}`)
	if (Number.isNaN(d.getTime())) return value
	return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function StandardGateEntry() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()
	const inputRef = useRef<HTMLInputElement>(null)

	const [visits, setVisits] = useState<Visit[]>([])
	const [loading, setLoading] = useState(true)
	const [forbidden, setForbidden] = useState<string | null>(null)
	const [barcode, setBarcode] = useState('')
	const [scanning, setScanning] = useState(false)
	const [lastPerson, setLastPerson] = useState<{ name: string; photo: string | null; direction: 'in' | 'out' } | null>(null)

	const today = new Date().toISOString().split('T')[0]

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

	const inside = useMemo(() => visits.filter(v => v.entry_time && !v.exit_time), [visits])

	const handleScan = async () => {
		const code = barcode.trim()
		if (!code) return
		if (!institutionId) {
			toast({ title: 'Select an institution first', variant: 'destructive' })
			return
		}

		try {
			setScanning(true)

			// Who is this?
			const lookupRes = await fetch(
				`/api/lib/members/lookup?barcode=${encodeURIComponent(code)}&institution_id=${institutionId}`
			)
			const person = await lookupRes.json()
			if (!lookupRes.ok) throw new Error(person.error || 'Member not found')

			// Already inside? Then this scan is them leaving.
			const openVisit = visits.find(v => v.member_id === person.id && v.entry_time && !v.exit_time)

			if (openVisit) {
				const res = await fetch('/api/lib/visits', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: openVisit.id, exit_time: new Date().toISOString() }),
				})
				if (!res.ok) throw new Error((await res.json()).error || 'Failed to record exit')
				setLastPerson({ name: person.display_name ?? person.member_number, photo: person.photo_url, direction: 'out' })
			} else {
				const res = await fetch('/api/lib/visits', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						institution_id: institutionId,
						member_id: person.id,
						visit_date: today,
						entry_time: new Date().toISOString(),
					}),
				})
				if (!res.ok) throw new Error((await res.json()).error || 'Failed to record entry')
				setLastPerson({ name: person.display_name ?? person.member_number, photo: person.photo_url, direction: 'in' })
			}

			setBarcode('')
			inputRef.current?.focus()
			fetchData()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Scan failed'), variant: 'destructive' })
			setBarcode('')
			inputRef.current?.focus()
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
								disabled={scanning}
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
