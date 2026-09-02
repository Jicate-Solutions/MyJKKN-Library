'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import {
	Newspaper, CheckCircle2, AlertCircle, Gift,
	MoreHorizontal, Edit, Trash2, Search, RefreshCw,
	PlusCircle, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import type { LibCatalogueRecord, LibPeriodicalSubscription, LibSubscriptionStatus } from '@/types/lib'

const STATUS_COLORS: Record<LibSubscriptionStatus, string> = {
	active: 'bg-green-50 text-green-700 border-green-200',
	expired: 'bg-red-50 text-red-700 border-red-200',
	cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
	gratis: 'bg-blue-50 text-blue-700 border-blue-200',
	suspended: 'bg-amber-50 text-amber-700 border-amber-200',
}

const STATUSES: LibSubscriptionStatus[] = ['active', 'expired', 'cancelled', 'gratis', 'suspended']
/**
 * How often an issue arrives, in the exact words the database stores.
 *
 * The column carries a CHECK constraint naming its values, so what the form
 * sends has to be one of them. It was not: the form offered "semi-annual" and
 * "bi-monthly", the database knows those two as `half_yearly` and `bimonthly`,
 * and every subscription on either was refused outright — the page could only
 * say "Failed to create subscription", which named neither the field nor the
 * reason. The stored word is the key; the word the librarian reads is the
 * label beside it.
 */
const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'half_yearly', 'annual'] as const

/**
 * The same words, as a librarian says them.
 *
 * Daily and irregular are named here but not offered above: the database
 * accepts both and an older subscription may hold one, so the list has to be
 * able to print it — but neither has a fixed number of issues in a year, and
 * Expected Issues is worked out from this choice.
 */
const FREQUENCY_LABELS: Record<string, string> = {
	daily: 'Daily',
	weekly: 'Weekly',
	fortnightly: 'Fortnightly',
	monthly: 'Monthly',
	bimonthly: 'Bi-monthly',
	quarterly: 'Quarterly',
	half_yearly: 'Semi-annual',
	annual: 'Annual',
	irregular: 'Irregular',
}

/** Falls back to the stored word, so an unknown value is shown rather than hidden. */
const frequencyLabel = (frequency: string | null | undefined): string =>
	frequency ? (FREQUENCY_LABELS[frequency] ?? frequency) : '—'

/**
 * How many issues a year's subscription brings, by how often it arrives.
 *
 * This was typed by hand into every subscription, which is arithmetic a form
 * should not ask a librarian to do — and it went wrong quietly: a monthly
 * journal entered as 10 reads later as two issues never delivered, and the
 * chase goes out to a supplier who sent everything they owed.
 *
 * Fortnightly is 26 and weekly 52 by the calendar, not by the month.
 */
const ISSUES_PER_YEAR: Record<string, number> = {
	weekly: 52,
	fortnightly: 26,
	monthly: 12,
	bimonthly: 6,
	quarterly: 4,
	half_yearly: 2,
	annual: 1,
}

/** What the read-only Expected Issues box shows for the chosen frequency. */
const expectedIssuesFor = (frequency: string): number | null =>
	ISSUES_PER_YEAR[frequency] ?? null

/**
 * The years a subscription can be filed under — one plain year, chosen, never typed.
 *
 * Fiscal Year used to be a text box, and it was filled three ways for the same
 * year: "2026", "2026-2027", "2026-27". Harmless to read, but the rule that
 * greys out a periodical already subscribed this year compares this value, and
 * "2026" is not "2026-2027" — so the second subscription for the same journal
 * went through, which is exactly what the rule exists to stop. A list of single
 * years means there is only one way to say a year.
 *
 * Newest first, one year ahead (a subscription is often placed before the year
 * it covers), back to 2020 — older than any subscription this system holds.
 */
const FIRST_FISCAL_YEAR = 2020
const CURRENT_YEAR = new Date().getFullYear()
const FISCAL_YEARS: string[] = Array.from(
	{ length: CURRENT_YEAR + 1 - FIRST_FISCAL_YEAR + 1 },
	(_, i) => String(CURRENT_YEAR + 1 - i)
)

interface FormData {
	catalogue_record_id: string
	supplier_id: string
	subscription_type: string
	frequency: string
	fiscal_year: string
	/**
	 * The volume this subscription starts at, as the librarian writes it — "12"
	 * and "Vol 12" both mean something to the person reading the shelf, so the
	 * column is text and neither is corrected.
	 */
	start_volume: string
	start_date: string
	end_date: string
	subscription_cost: string
	is_gratis: boolean
}

const defaultForm: FormData = {
	catalogue_record_id: '',
	supplier_id: '',
	subscription_type: 'print',
	frequency: 'monthly',
	fiscal_year: String(CURRENT_YEAR),
	start_volume: '',
	start_date: '',
	end_date: '',
	subscription_cost: '',
	is_gratis: false,
}

export default function PeriodicalSubscriptionsPage() {
	const { isReady, appendToUrl, institutionId, getInstitutionIdForCreate, mustSelectInstitution, shouldFilter } = useInstitutionFilter()
	const { toast } = useToast()

	const [subscriptions, setSubscriptions] = useState<LibPeriodicalSubscription[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [sheetOpen, setSheetOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<LibPeriodicalSubscription | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<LibPeriodicalSubscription | null>(null)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<FormData>(defaultForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(10)
	const [titles, setTitles] = useState<LibCatalogueRecord[]>([])
	const [titlesLoaded, setTitlesLoaded] = useState(false)
	const [titlesLoading, setTitlesLoading] = useState(false)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			const url = appendToUrl('/api/lib/periodicals/subscriptions')
			const res = await fetch(url)
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setSubscriptions(data)
		} catch {
			toast({ title: 'Failed to load subscriptions', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	// The periodical titles a subscription can point at. Loaded when the form is
	// first opened rather than with the page, because the list is only ever
	// needed inside the sheet.
	//
	// `with_copies` is what keeps this list honest. Without it the form offered
	// every periodical row anybody had ever typed, including titles with nothing
	// on the shelf — the register could not show those, because the register
	// lists copies, so the two screens disagreed about what the library holds.
	// It also brings the supplier along, entered once on the title and read from
	// there by every screen that needs it.
	const loadTitles = useCallback(async () => {
		if (!isReady || titlesLoaded || titlesLoading) return
		try {
			setTitlesLoading(true)
			const res = await fetch(appendToUrl('/api/lib/catalogue?resource_format=periodical&with_copies=true'))
			if (!res.ok) throw new Error('Failed to fetch')
			const data = await res.json()
			setTitles(Array.isArray(data) ? data : [])
			setTitlesLoaded(true)
		} catch {
			toast({ title: 'Failed to load periodical titles', variant: 'destructive' })
		} finally {
			setTitlesLoading(false)
		}
	}, [isReady, titlesLoaded, titlesLoading, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])
	useEffect(() => { setCurrentPage(1) }, [shouldFilter])
	// Switching institution makes the loaded titles the wrong college's.
	useEffect(() => { setTitles([]); setTitlesLoaded(false) }, [appendToUrl])

	const scorecardData = useMemo(() => ({
		total: subscriptions.length,
		active: subscriptions.filter(s => s.subscription_status === 'active').length,
		expired: subscriptions.filter(s => s.subscription_status === 'expired').length,
		gratis: subscriptions.filter(s => s.is_gratis).length,
	}), [subscriptions])

	const filtered = useMemo(() => {
		return subscriptions.filter(s => {
			const matchSearch = !search ||
				(s.catalogue_record?.title?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				(s.subscription_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
				s.fiscal_year.includes(search)
			const matchStatus = statusFilter === 'all' || s.subscription_status === statusFilter
			return matchSearch && matchStatus
		})
	}, [subscriptions, search, statusFilter])

	const pageSizeOptions = useMemo(() => {
		const opts = [10, 25, 50]
		if (filtered.length > 50) opts.push(filtered.length)
		return opts
	}, [filtered.length])

	/**
	 * A periodical is subscribed once a year, so the second attempt is a mistake.
	 *
	 * With forty journals to register the librarian cannot be asked to remember
	 * which ones are already done — so the ones already taken for the year on the
	 * form are greyed out in the list, and say why. It is the fiscal year that
	 * decides, not the title alone: next year's subscription for the same journal
	 * is a new subscription, and must stay possible.
	 *
	 * The subscription being edited never counts against itself.
	 *
	 * Colleges cannot collide here even when every institution is shown at once:
	 * a catalogue record belongs to one college, so an id taken from another
	 * college's subscription can never match a title in this college's list.
	 */
	const takenTitleIds = useMemo(() => {
		const year = form.fiscal_year.trim().toLowerCase()
		const taken = new Set<string>()
		if (!year) return taken
		for (const s of subscriptions) {
			if (editingItem && s.id === editingItem.id) continue
			if ((s.fiscal_year ?? '').trim().toLowerCase() !== year) continue
			taken.add(s.catalogue_record_id)
		}
		return taken
	}, [subscriptions, editingItem, form.fiscal_year])

	const titleOptions = useMemo<SearchableSelectOption[]>(() => {
		const opts = titles.map(t => ({
			value: t.id,
			label: t.title,
			disabled: takenTitleIds.has(t.id),
			description: [
				takenTitleIds.has(t.id) ? `Already subscribed for ${form.fiscal_year.trim()}` : null,
				t.issn ? `ISSN: ${t.issn}` : null,
				t.publisher_name || null,
				// Shown in the list too, so the librarian sees which vendor they are
				// about to inherit before choosing rather than after
				(t as { supplier_name?: string | null }).supplier_name
					? `Supplier: ${(t as { supplier_name?: string | null }).supplier_name}`
					: null,
				t.call_number ? `Call no: ${t.call_number}` : null,
			].filter(Boolean).join(' · ') || undefined,
		}))
		// A subscription being edited may point at a record the catalogue filter
		// does not return; keep it selectable so editing never silently drops it.
		const current = editingItem?.catalogue_record
		if (current && !opts.some(o => o.value === current.id)) {
			opts.unshift({ value: current.id, label: current.title, disabled: false, description: current.issn ? `ISSN: ${current.issn}` : undefined })
		}
		return opts
	}, [titles, editingItem, takenTitleIds, form.fiscal_year])

	/**
	 * The supplier behind a periodical title, as the catalogue holds it.
	 *
	 * Entered once when the title was accessioned and read from there ever
	 * afterwards — a subscription never asks for it again. When a subscription
	 * being edited points at a title this list does not carry, its own stored
	 * supplier stands in, so opening an old record never blanks what it had.
	 */
	const supplierOfTitle = useCallback((catalogueRecordId: string) => {
		const title = titles.find(t => t.id === catalogueRecordId) as
			(LibCatalogueRecord & { supplier_id?: string | null; supplier_name?: string | null }) | undefined
		if (title?.supplier_id) return { id: title.supplier_id, name: title.supplier_name ?? null }
		if (editingItem?.catalogue_record_id === catalogueRecordId && editingItem.supplier_id) {
			return { id: editingItem.supplier_id, name: editingItem.supplier?.supplier_name ?? null }
		}
		return null
	}, [titles, editingItem])

	const effectivePerPage = itemsPerPage > filtered.length ? filtered.length : itemsPerPage
	const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePerPage))
	const paginated = effectivePerPage > 0
		? filtered.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)
		: filtered
	// S.No, Title, Supplier, Frequency, Fiscal Year, Issues, Status, Detail, menu
	// — plus Institution when every college is being shown at once
	const colCount = mustSelectInstitution ? 10 : 9

	const resetForm = () => {
		setForm(defaultForm)
		setErrors({})
		setEditingItem(null)
	}

	/**
	 * Every field on the form is required except the Gratis switch.
	 *
	 * Two of them are not typed — Supplier comes off the chosen title and
	 * Expected Issues off the chosen frequency — but they are checked all the
	 * same, because "filled in automatically" and "filled in" are not the same
	 * thing. A title with no supplier recorded against it leaves that box empty,
	 * and a subscription saved that way is one nobody can chase an issue for.
	 * The message points at where the missing thing actually lives.
	 *
	 * A switch is never empty: it is on or it is off, and off is an answer. So
	 * Gratis is the one field with nothing to check.
	 */
	const validate = (): boolean => {
		const e: Record<string, string> = {}
		if (!form.catalogue_record_id) e.catalogue_record_id = 'Periodical title is required'
		// The list greys these out, but the year can be changed after a title was
		// chosen — and then a title that was free is not free any more.
		else if (takenTitleIds.has(form.catalogue_record_id)) {
			e.catalogue_record_id = `This periodical already has a subscription for ${form.fiscal_year.trim()}`
		}
		if (!form.supplier_id) {
			e.supplier_id = form.catalogue_record_id
				? 'This title has no supplier — add one on the title under Knowledge Registry'
				: 'Choose the periodical above to bring in its supplier'
		}
		if (!form.start_volume.trim()) e.start_volume = 'Volume is required'
		if (!form.fiscal_year.trim()) e.fiscal_year = 'Fiscal year is required'
		if (!form.subscription_type) e.subscription_type = 'Type is required'
		if (!form.frequency) e.frequency = 'Frequency is required'
		if (!form.start_date) e.start_date = 'Start date is required'
		if (!form.end_date) e.end_date = 'End date is required'
		// A gratis subscription still has a cost, and it is 0. Written rather than
		// assumed, so the year's spend adds up from what was entered.
		if (!form.subscription_cost.trim()) e.subscription_cost = 'Subscription cost is required — enter 0 if there is no charge'
		if (expectedIssuesFor(form.frequency) === null) {
			e.expected_issues = 'Expected issues is required — choose a frequency it can be worked out from'
		}
		setErrors(e)
		return Object.keys(e).length === 0
	}

	/**
	 * Asked again at the moment of saving: is this title still free this year?
	 *
	 * The greyed-out list was read when the sheet was opened. If someone at
	 * another desk subscribed the same journal in between, this screen would
	 * still be offering it — so the rows are read once more before the save goes
	 * through, and it is those rows that decide. When a clash turns up, the list
	 * behind the sheet is refreshed with what came back, so the librarian can see
	 * the subscription that beat them to it.
	 *
	 * If the check itself cannot be made — the network, a slow moment — the save
	 * is allowed to continue. It refuses duplicates; it does not refuse work.
	 */
	const stillFreeThisYear = async (): Promise<boolean> => {
		try {
			const res = await fetch(appendToUrl('/api/lib/periodicals/subscriptions'))
			if (!res.ok) return true
			const rows = await res.json()
			if (!Array.isArray(rows)) return true
			const year = form.fiscal_year.trim().toLowerCase()
			const clash = (rows as LibPeriodicalSubscription[]).some(s =>
				s.catalogue_record_id === form.catalogue_record_id &&
				(s.fiscal_year ?? '').trim().toLowerCase() === year &&
				s.id !== editingItem?.id
			)
			if (clash) setSubscriptions(rows)
			return !clash
		} catch {
			return true
		}
	}

	const handleSave = async () => {
		if (!validate()) return
		try {
			setSaving(true)
			if (!(await stillFreeThisYear())) {
				setErrors(prev => ({
					...prev,
					catalogue_record_id: `This periodical was subscribed for ${form.fiscal_year.trim()} while this form was open`,
				}))
				toast({
					title: '❌ Already subscribed',
					description: 'Someone registered this periodical for the same year just now — nothing was saved.',
					variant: 'destructive',
				})
				return
			}
			const instId = getInstitutionIdForCreate() ?? institutionId
			const payload = {
				...form,
				institution_id: instId ?? '',
				currency_code: 'INR',
				subscription_cost: form.subscription_cost ? Number(form.subscription_cost) : undefined,
				// Worked out from the frequency, never typed — so it is sent from the
				// same place the form showed it and the two cannot disagree.
				expected_issues: expectedIssuesFor(form.frequency) ?? undefined,
				start_volume: form.start_volume.trim() || undefined,
				start_date: form.start_date || undefined,
				end_date: form.end_date || undefined,
				// An empty string is not a UUID — send nothing so the column stays null.
				supplier_id: form.supplier_id || undefined,
			}
			const url = editingItem ? `/api/lib/periodicals/subscriptions/${editingItem.id}` : '/api/lib/periodicals/subscriptions'
			const res = await fetch(url, {
				method: editingItem ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error(err.error || 'Save failed')
			}
			const saved = await res.json()
			if (editingItem) {
				setSubscriptions(prev => prev.map(s => s.id === saved.id ? saved : s))
				toast({ title: '✅ Subscription updated', className: 'bg-green-50 border-green-200 text-green-800' })
			} else {
				setSubscriptions(prev => [saved, ...prev])
				// The year's issues are laid out with the subscription, so the
				// librarian is told they are there rather than finding an empty
				// register and wondering. A warning means they were not.
				toast(saved.issues_warning
					? {
						title: '⚠️ Subscription created, but its issues were not laid out',
						description: saved.issues_warning,
						className: 'bg-amber-50 border-amber-200 text-amber-900',
					}
					: {
						title: '✅ Subscription created',
						description: saved.expected_issues_created
							? `${saved.expected_issues_created} issues are now waiting, marked expected. Mark each one received as it arrives.`
							: undefined,
						className: 'bg-green-50 border-green-200 text-green-800',
					})
			}
			setSheetOpen(false)
			resetForm()
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Save failed'), variant: 'destructive' })
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (s: LibPeriodicalSubscription) => {
		loadTitles()
		setEditingItem(s)
		setForm({
			catalogue_record_id: s.catalogue_record_id,
			supplier_id: s.supplier_id ?? '',
			subscription_type: s.subscription_type ?? 'print',
			frequency: s.frequency ?? 'monthly',
			fiscal_year: s.fiscal_year,
			start_volume: s.start_volume ?? '',
			start_date: s.start_date?.split('T')[0] ?? '',
			end_date: s.end_date?.split('T')[0] ?? '',
			subscription_cost: s.subscription_cost?.toString() ?? '',
			is_gratis: s.is_gratis,
		})
		setSheetOpen(true)
	}

	const handleDelete = async () => {
		if (!deleteTarget) return
		try {
			const res = await fetch(`/api/lib/periodicals/subscriptions/${deleteTarget.id}`, { method: 'DELETE' })
			// The route says why it refused — issues are recorded against it, say —
			// and that reason is what the librarian needs, not "Delete failed".
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed')
			setSubscriptions(prev => prev.filter(x => x.id !== deleteTarget.id))
			toast({ title: '✅ Subscription deleted', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Delete failed'), variant: 'destructive' })
		} finally {
			setDeleteTarget(null)
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Scorecards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
				<Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.total}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Total Subscriptions</p>
							</div>
							<Newspaper className="h-5 w-5 text-blue-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-emerald-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.active}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Active</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-emerald-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-rose-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.expired}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Expired</p>
							</div>
							<AlertCircle className="h-5 w-5 text-rose-500/40" />
						</div>
					</CardContent>
				</Card>
				<Card className="border-l-4 border-l-sky-500 hover:shadow-md transition-shadow">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold tracking-tight">{scorecardData.gratis}</p>
								<p className="text-xs font-medium text-muted-foreground mt-0.5">Gratis</p>
							</div>
							<Gift className="h-5 w-5 text-sky-500/40" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table Card */}
			<TooltipProvider delayDuration={300}>
				<Card className="flex-1 flex flex-col min-h-0">
					<CardHeader className="flex-shrink-0 px-4 py-3 border-b">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-base font-semibold">Periodical Subscriptions</h2>
								<p className="text-xs text-muted-foreground">{filtered.length} subscription{filtered.length !== 1 ? 's' : ''}</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								<Button className="h-8 text-sm px-4" onClick={() => { resetForm(); loadTitles(); setSheetOpen(true) }}>
									<PlusCircle className="h-4 w-4 mr-1.5" />
									<span className="hidden sm:inline">Add Subscription</span>
									<span className="sm:hidden">Add</span>
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-2 flex-wrap mt-3">
							<Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1) }}>
								<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									{STATUSES.map(s => (
										<SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="relative flex-1 max-w-sm">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search title or subscription #..."
									value={search}
									onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
									className="pl-8 h-8 text-sm"
								/>
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
										<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
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
											<TableHead className="text-xs font-semibold">Title</TableHead>
											<TableHead className="text-xs font-semibold">Supplier</TableHead>
											<TableHead className="text-xs font-semibold">Frequency</TableHead>
											<TableHead className="text-xs font-semibold">Fiscal Year</TableHead>
											<TableHead className="text-xs font-semibold">Issues (Rcvd/Exp)</TableHead>
											<TableHead className="text-xs font-semibold">Status</TableHead>
											{mustSelectInstitution && <TableHead className="text-xs font-semibold">Institution</TableHead>}
											<TableHead className="text-xs font-semibold w-10">Detail</TableHead>
											<TableHead className="text-xs font-semibold w-10"></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{loading ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-2 text-muted-foreground">
														<RefreshCw className="h-5 w-5 animate-spin" />
														<span className="text-sm">Loading subscriptions...</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.length === 0 ? (
											<TableRow>
												<TableCell colSpan={colCount} className="h-32 text-center">
													<div className="flex flex-col items-center gap-1 text-muted-foreground">
														<Newspaper className="h-8 w-8 opacity-20" />
														<span className="text-sm">No subscriptions found</span>
														<span className="text-xs">Try adjusting your filters</span>
													</div>
												</TableCell>
											</TableRow>
										) : paginated.map((s, index) => (
											<TableRow key={s.id} className="hover:bg-muted/50">
												{/* Counted across pages, so page 2 starts at 11 and not at 1 */}
												<TableCell className="text-sm text-muted-foreground tabular-nums">
													{(currentPage - 1) * effectivePerPage + index + 1}
												</TableCell>
												<TableCell className="max-w-[200px]">
													{/* The title is the obvious thing to click, so it opens the
													    same page the Detail button does. A real link, not a row
													    click handler: it can be opened in a new tab, and the
													    browser shows where it goes before it is clicked. */}
													<Link
														href={`/periodicals/${s.id}`}
														className="block truncate text-sm font-medium hover:text-brand-green hover:underline dark:hover:text-brand-green-400"
													>
														{s.catalogue_record?.title ?? s.catalogue_record_id}
													</Link>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">{s.supplier?.supplier_name ?? '—'}</TableCell>
												<TableCell className="text-sm">{frequencyLabel(s.frequency)}</TableCell>
												<TableCell className="text-sm">{s.fiscal_year}</TableCell>
												<TableCell>
													<span className="text-emerald-600 font-medium">{s.received_issues}</span>
													<span className="text-muted-foreground">/{s.expected_issues ?? '?'}</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[s.subscription_status]}`}>
														{s.subscription_status}
													</Badge>
												</TableCell>
												{mustSelectInstitution && (
													<TableCell className="text-xs text-muted-foreground">{s.institution_id?.slice(0, 8) ?? '—'}</TableCell>
												)}
												<TableCell>
													<Button variant="ghost" size="icon" className="h-7 w-7 p-0" asChild>
														<Link href={`/periodicals/${s.id}`}>
															<ExternalLink className="h-3.5 w-3.5 text-blue-500" />
														</Link>
													</Button>
												</TableCell>
												<TableCell>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-7 w-7 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(s)}>
																<Edit className="h-4 w-4 mr-2" />Edit
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(s)}>
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
							{loading ? (
								<div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
									<RefreshCw className="h-5 w-5 animate-spin" />
									<span className="text-sm">Loading...</span>
								</div>
							) : paginated.length === 0 ? (
								<div className="flex flex-col items-center gap-1 py-12 text-muted-foreground">
									<Newspaper className="h-8 w-8 opacity-20" />
									<span className="text-sm">No subscriptions found</span>
								</div>
							) : paginated.map(s => (
								<div key={s.id} className="rounded-lg border p-4 space-y-2">
									<div className="flex items-start justify-between">
										<div className="flex-1 min-w-0">
											{/* Clickable here too, so the phone behaves like the table */}
											<Link
												href={`/periodicals/${s.id}`}
												className="block font-medium text-sm truncate hover:text-brand-green hover:underline dark:hover:text-brand-green-400"
											>
												{s.catalogue_record?.title ?? s.catalogue_record_id}
											</Link>
											<p className="text-xs text-muted-foreground">{s.supplier?.supplier_name ?? '—'} · {s.fiscal_year}</p>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-7 w-7 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem asChild>
													<Link href={`/periodicals/${s.id}`}><ExternalLink className="h-4 w-4 mr-2" />View Detail</Link>
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => handleEdit(s)}>
													<Edit className="h-4 w-4 mr-2" />Edit
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeleteTarget(s)}>
													<Trash2 className="h-4 w-4 mr-2" />Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[s.subscription_status]}`}>{s.subscription_status}</Badge>
										<span className="text-xs text-muted-foreground">{frequencyLabel(s.frequency)}</span>
									</div>
									<p className="text-xs text-muted-foreground">
										Issues: <span className="text-emerald-600 font-medium">{s.received_issues}</span>/{s.expected_issues ?? '?'}
									</p>
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
											<SelectItem key={n} value={String(n)}>{n === filtered.length ? 'All' : n}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground px-2 tabular-nums">
									{filtered.length === 0 ? '0 of 0' : `${(currentPage - 1) * effectivePerPage + 1}–${Math.min(currentPage * effectivePerPage, filtered.length)} of ${filtered.length}`}
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

			{/* Sheet Form */}
			<Sheet open={sheetOpen} onOpenChange={o => { if (!o) resetForm(); setSheetOpen(o) }}>
				<SheetContent className="sm:max-w-[720px] overflow-y-auto">
					<SheetHeader className="pb-4 border-b">
						<SheetTitle className="text-lg font-semibold">{editingItem ? 'Edit Subscription' : 'Add Subscription'}</SheetTitle>
						<p className="text-sm text-muted-foreground">
							{editingItem ? 'Update subscription details below' : 'Register a new periodical subscription'}
						</p>
					</SheetHeader>
					<div className="mt-6 space-y-8">
						{/* Section: Subscription Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription Info</h3>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Periodical Title <span className="text-red-500">*</span></Label>
								<SearchableSelect
									value={form.catalogue_record_id}
									// Choosing the title settles the supplier: it was entered
									// once on the title in the catalogue, and this reads it from
									// there rather than asking for it a second time.
									onValueChange={v => setForm(f => ({
										...f,
										catalogue_record_id: v,
										supplier_id: supplierOfTitle(v)?.id ?? '',
									}))}
									options={titleOptions}
									loading={titlesLoading}
									loadingText="Loading titles..."
									placeholder="Select the periodical..."
									searchPlaceholder="Search by title, ISSN or publisher..."
									emptyText="No periodical titles yet — add one under Knowledge Registry with format 'Periodical'."
									error={!!errors.catalogue_record_id}
								/>
								{errors.catalogue_record_id && <p className="text-xs text-red-500">{errors.catalogue_record_id}</p>}
							</div>
							<div className="space-y-2">
								<Label className="text-sm font-semibold">Supplier <span className="text-red-500">*</span></Label>
								{/* Required, but not asked for here. The vendor was entered once
								    against the title in the catalogue, and this reads it from
								    there — one entry, and every screen showing the same name. */}
								<div className={`flex h-10 items-center rounded-md border border-dashed bg-muted/40 px-3 text-sm text-muted-foreground ${errors.supplier_id ? 'border-red-500' : ''}`}>
									{supplierOfTitle(form.catalogue_record_id)?.name
										?? (form.catalogue_record_id ? 'No supplier recorded on this title' : 'Choose the periodical above')}
								</div>
								{errors.supplier_id
									? <p className="text-xs text-red-500">{errors.supplier_id}</p>
									: <p className="text-xs text-muted-foreground">
										Taken from the catalogue. Change it on the title, under Knowledge Registry.
									</p>}
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Volume <span className="text-red-500">*</span></Label>
									{/* Written as the librarian reads it off the issue. "12" and
									    "Vol 12" both say the same thing to the person standing at
									    the shelf, so the column is text and neither is corrected. */}
									<Input
										value={form.start_volume}
										onChange={e => setForm(f => ({ ...f, start_volume: e.target.value }))}
										className={errors.start_volume ? 'border-red-500' : ''}
										placeholder="e.g. 12 or Vol 12"
									/>
									{errors.start_volume && <p className="text-xs text-red-500">{errors.start_volume}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Fiscal Year <span className="text-red-500">*</span></Label>
									{/* Chosen from a list of single years, never typed — see FISCAL_YEARS. */}
									<Select value={form.fiscal_year} onValueChange={v => setForm(f => ({ ...f, fiscal_year: v }))}>
										<SelectTrigger className={errors.fiscal_year ? 'border-red-500' : ''}><SelectValue placeholder="Select the year" /></SelectTrigger>
										<SelectContent>
											{FISCAL_YEARS.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
										</SelectContent>
									</Select>
									{errors.fiscal_year && <p className="text-xs text-red-500">{errors.fiscal_year}</p>}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Type <span className="text-red-500">*</span></Label>
									<Select value={form.subscription_type} onValueChange={v => setForm(f => ({ ...f, subscription_type: v }))}>
										<SelectTrigger className={errors.subscription_type ? 'border-red-500' : ''}><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="print">Print</SelectItem>
											<SelectItem value="online">Online</SelectItem>
											<SelectItem value="both">Both</SelectItem>
										</SelectContent>
									</Select>
									{errors.subscription_type && <p className="text-xs text-red-500">{errors.subscription_type}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Frequency <span className="text-red-500">*</span></Label>
									<Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
										<SelectTrigger className={errors.frequency ? 'border-red-500' : ''}><SelectValue /></SelectTrigger>
										<SelectContent>
											{FREQUENCIES.map(freq => <SelectItem key={freq} value={freq}>{frequencyLabel(freq)}</SelectItem>)}
										</SelectContent>
									</Select>
									{errors.frequency && <p className="text-xs text-red-500">{errors.frequency}</p>}
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Start Date <span className="text-red-500">*</span></Label>
									<Input
										type="date"
										value={form.start_date}
										onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
										className={errors.start_date ? 'border-red-500' : ''}
									/>
									{errors.start_date && <p className="text-xs text-red-500">{errors.start_date}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">End Date <span className="text-red-500">*</span></Label>
									<Input
										type="date"
										value={form.end_date}
										onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
										className={errors.end_date ? 'border-red-500' : ''}
									/>
									{errors.end_date && <p className="text-xs text-red-500">{errors.end_date}</p>}
								</div>
							</div>
						</div>

						{/* Section: Cost & Issues */}
						<div className="space-y-4 pt-2 border-t">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cost and Issues</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Subscription Cost (₹) <span className="text-red-500">*</span></Label>
									<Input
										type="number"
										min="0"
										value={form.subscription_cost}
										onChange={e => setForm(f => ({ ...f, subscription_cost: e.target.value }))}
										className={errors.subscription_cost ? 'border-red-500' : ''}
										placeholder="0.00"
									/>
									{errors.subscription_cost && <p className="text-xs text-red-500">{errors.subscription_cost}</p>}
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-semibold">Expected Issues <span className="text-red-500">*</span></Label>
									{/* Worked out from the frequency rather than typed. A monthly
									    journal keyed in as 10 reads later as two issues never
									    delivered, and the chase goes out to a supplier who sent
									    everything they owed — so the arithmetic is not asked for. */}
									<Input
										type="number"
										value={expectedIssuesFor(form.frequency) ?? ''}
										readOnly
										tabIndex={-1}
										className={`bg-muted/40 text-muted-foreground cursor-not-allowed ${errors.expected_issues ? 'border-red-500' : ''}`}
									/>
									{errors.expected_issues
										? <p className="text-xs text-red-500">{errors.expected_issues}</p>
										: <p className="text-xs text-muted-foreground">
											Set by the frequency above — {frequencyLabel(form.frequency).toLowerCase()} means{' '}
											{expectedIssuesFor(form.frequency) ?? '—'} issues a year.
										</p>}
								</div>
							</div>
							<div className="flex items-center gap-3">
								<Switch
									id="is_gratis"
									checked={form.is_gratis}
									onCheckedChange={v => setForm(f => ({ ...f, is_gratis: v }))}
								/>
								<Label htmlFor="is_gratis" className="text-sm">Gratis (complimentary / no charge)</Label>
							</div>
						</div>

						{/* Actions */}
						<div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={() => setSheetOpen(false)}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : (editingItem ? 'Update Subscription' : 'Create Subscription')}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Dialog */}
			<AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Subscription</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the subscription for <strong>{deleteTarget?.catalogue_record?.title ?? deleteTarget?.catalogue_record_id}</strong>? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
