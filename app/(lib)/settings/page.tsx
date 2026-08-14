'use client'

/**
 * Library Rules — this campus's borrowing policy.
 *
 * Everything here is stored per institution, so changing Pharmacy's numbers
 * cannot move another college's. Until this page existed the rules could only
 * be changed by hand in SQL.
 */

import { useState, useEffect, useCallback } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RefreshCw, Save, Lock, SlidersHorizontal, BookMarked } from 'lucide-react'

interface CategoryRule {
	id?: string
	category_code: string
	category_name: string
	max_items_allowed: number
	loan_period_days: number
	renewal_limit: number
	renewal_period_days: number
	late_charge_per_day: number
	reservation_limit: number
	can_access_digital: boolean
}

interface Policy {
	fine_grace_days: number
	fine_max_per_item: number | null
	fine_working_days_only: boolean
	block_borrowing_when_fine_due: boolean
	lost_item_processing_percent: number
	member_number_source: 'auto' | 'college_id'
	member_number_prefix: string
	opening_time: string
	closing_time: string
	requires_no_dues: boolean
}

const CATEGORY_ORDER = ['learner', 'facilitator', 'team_member', 'guest', 'alumni']

const CATEGORY_LABEL: Record<string, string> = {
	learner: 'Learner',
	facilitator: 'Facilitator',
	team_member: 'Team Member',
	guest: 'Guest',
	alumni: 'Alumni',
}

export default function LibrarySettingsPage() {
	const { isReady, institutionId, appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const [rules, setRules] = useState<CategoryRule[]>([])
	const [policy, setPolicy] = useState<Policy | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [forbidden, setForbidden] = useState<string | null>(null)

	const fetchData = useCallback(async () => {
		if (!isReady) return
		try {
			setLoading(true)
			setForbidden(null)

			const [rulesRes, policyRes] = await Promise.all([
				fetch(appendToUrl('/api/lib/settings/categories')),
				fetch(appendToUrl('/api/lib/settings')),
			])

			if (!rulesRes.ok) {
				const json = await rulesRes.json()
				setForbidden(json.error || 'You do not have permission to view this page')
				return
			}

			const rulesJson: CategoryRule[] = await rulesRes.json()
			const byCode = new Map(rulesJson.map(r => [r.category_code, r]))

			// Show every category, even ones this campus has not configured yet
			setRules(CATEGORY_ORDER.map(code => byCode.get(code) ?? {
				category_code: code,
				category_name: CATEGORY_LABEL[code],
				max_items_allowed: 0,
				loan_period_days: 0,
				renewal_limit: 0,
				renewal_period_days: 0,
				late_charge_per_day: 0,
				reservation_limit: 0,
				can_access_digital: true,
			}))

			if (policyRes.ok) setPolicy(await policyRes.json())
		} catch {
			toast({ title: 'Failed to load library rules', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [isReady, appendToUrl, toast])

	useEffect(() => { fetchData() }, [fetchData])

	const editRule = (code: string, field: keyof CategoryRule, value: number | boolean) => {
		setRules(prev => prev.map(r => (r.category_code === code ? { ...r, [field]: value } : r)))
	}

	const saveAll = async () => {
		if (!institutionId) {
			toast({ title: 'Select an institution first', variant: 'destructive' })
			return
		}
		try {
			setSaving(true)

			for (const rule of rules) {
				const res = await fetch('/api/lib/settings/categories', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...rule, institution_id: institutionId }),
				})
				if (!res.ok) throw new Error((await res.json()).error || 'Failed to save borrowing rules')
			}

			if (policy) {
				const res = await fetch('/api/lib/settings', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...policy, institution_id: institutionId }),
				})
				if (!res.ok) throw new Error((await res.json()).error || 'Failed to save policy')
			}

			toast({
				title: '✅ Rules saved',
				description: 'The circulation desk will use these from the next issue.',
				className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
			})
			fetchData()
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to save'),
				variant: 'destructive',
			})
		} finally {
			setSaving(false)
		}
	}

	const setPolicyField = <K extends keyof Policy>(field: K, value: Policy[K]) => {
		setPolicy(p => (p ? { ...p, [field]: value } : p))
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
		<div className="flex flex-1 flex-col gap-4 overflow-y-auto">
			<div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
				<div className="min-w-0">
					<h2 className="text-base font-semibold font-heading">Library Rules</h2>
					<p className="text-xs text-muted-foreground">
						These apply to this campus only — no other college is affected.
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button variant="outline" size="icon" className="h-8 w-8 p-0" onClick={fetchData}>
						<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
					</Button>
					<Button
						onClick={saveAll}
						disabled={saving || loading}
						className="h-8 bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
					>
						<Save className="h-4 w-4 mr-1.5" />
						{saving ? 'Saving...' : 'Save changes'}
					</Button>
				</div>
			</div>

			{/* Borrowing rules per category */}
			<Card>
				<CardHeader className="px-4 py-3 border-b">
					<div className="flex items-center gap-2">
						<BookMarked className="h-4 w-4 text-brand-green dark:text-brand-green-400" />
						<h3 className="text-sm font-semibold font-heading">Borrowing limits</h3>
					</div>
					<p className="text-xs text-muted-foreground">
						What the desk allows on every issue, renew and return.
					</p>
				</CardHeader>
				<CardContent className="p-0">
					<div className="overflow-x-auto">
						<Table>
							<TableHeader className="bg-muted/50">
								<TableRow>
									<TableHead className="text-xs font-semibold">Category</TableHead>
									<TableHead className="text-xs font-semibold w-[100px]">Max books</TableHead>
									<TableHead className="text-xs font-semibold w-[100px]">Loan days</TableHead>
									<TableHead className="text-xs font-semibold w-[100px]">Renewals</TableHead>
									<TableHead className="text-xs font-semibold w-[110px]">Renewal days</TableHead>
									<TableHead className="text-xs font-semibold w-[110px]">Fine / day (₹)</TableHead>
									<TableHead className="text-xs font-semibold w-[100px]">Max holds</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rules.map(rule => (
									<TableRow key={rule.category_code}>
										<TableCell className="text-sm font-medium">{rule.category_name}</TableCell>
										{([
											'max_items_allowed',
											'loan_period_days',
											'renewal_limit',
											'renewal_period_days',
											'late_charge_per_day',
											'reservation_limit',
										] as const).map(field => (
											<TableCell key={field}>
												<Input
													type="number"
													min={0}
													step={field === 'late_charge_per_day' ? '0.5' : '1'}
													value={rule[field]}
													onChange={e => editRule(rule.category_code, field, Number(e.target.value))}
													className="h-8 text-sm"
												/>
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			{/* Fine policy and numbering */}
			{policy && (
				<Card>
					<CardHeader className="px-4 py-3 border-b">
						<div className="flex items-center gap-2">
							<SlidersHorizontal className="h-4 w-4 text-brand-green dark:text-brand-green-400" />
							<h3 className="text-sm font-semibold font-heading">Fines, numbering and desk</h3>
						</div>
					</CardHeader>
					<CardContent className="p-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						<div className="space-y-1.5">
							<Label className="text-xs">Grace days before a fine starts</Label>
							<Input
								type="number" min={0}
								value={policy.fine_grace_days}
								onChange={e => setPolicyField('fine_grace_days', Number(e.target.value))}
								className="h-8 text-sm"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Maximum fine per book (₹)</Label>
							<Input
								type="number" min={0} placeholder="Leave blank for no cap"
								value={policy.fine_max_per_item ?? ''}
								onChange={e => setPolicyField('fine_max_per_item', e.target.value === '' ? null : Number(e.target.value))}
								className="h-8 text-sm"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Lost book: extra charge (% of price)</Label>
							<Input
								type="number" min={0}
								value={policy.lost_item_processing_percent}
								onChange={e => setPolicyField('lost_item_processing_percent', Number(e.target.value))}
								className="h-8 text-sm"
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<div>
								<Label className="text-xs">Count working days only</Label>
								<p className="text-[11px] text-muted-foreground">Sundays are skipped</p>
							</div>
							<Switch
								checked={policy.fine_working_days_only}
								onCheckedChange={v => setPolicyField('fine_working_days_only', v)}
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<div>
								<Label className="text-xs">Block borrowing when a fine is due</Label>
								<p className="text-[11px] text-muted-foreground">Off = they may still borrow</p>
							</div>
							<Switch
								checked={policy.block_borrowing_when_fine_due}
								onCheckedChange={v => setPolicyField('block_borrowing_when_fine_due', v)}
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<div>
								<Label className="text-xs">No Dues needed before exams</Label>
								<p className="text-[11px] text-muted-foreground">Shows a clearance check</p>
							</div>
							<Switch
								checked={policy.requires_no_dues}
								onCheckedChange={v => setPolicyField('requires_no_dues', v)}
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Member number</Label>
							<Select
								value={policy.member_number_source}
								onValueChange={v => setPolicyField('member_number_source', v as 'auto' | 'college_id')}
							>
								<SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
								<SelectContent>
									<SelectItem value="college_id">Use the college ID number</SelectItem>
									<SelectItem value="auto">Generate automatically</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Library opens</Label>
							<Input
								type="time"
								value={policy.opening_time?.slice(0, 5) ?? ''}
								onChange={e => setPolicyField('opening_time', e.target.value)}
								className="h-8 text-sm"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Library closes</Label>
							<Input
								type="time"
								value={policy.closing_time?.slice(0, 5) ?? ''}
								onChange={e => setPolicyField('closing_time', e.target.value)}
								className="h-8 text-sm"
							/>
						</div>

					</CardContent>
				</Card>
			)}
		</div>
	)
}
