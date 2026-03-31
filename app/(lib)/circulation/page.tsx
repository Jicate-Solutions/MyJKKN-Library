'use client'

import { useState, useCallback } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { BarcodeScannerInput } from '@/components/library/barcode-scanner-input'
import { ResourceStatusBadge } from '@/components/library/resource-status-badge'
import { MemberCategoryBadge } from '@/components/library/member-category-badge'
import {
	CheckCircle, RefreshCw, RotateCcw, User, BookOpen, AlertTriangle, ArrowRightLeft,
} from 'lucide-react'
import { issueItem, returnItem, renewItem } from '@/services/library/lib-circulation-service'
import type { LibLendingTransaction, LibMember, LibItem } from '@/types/lib'

// ─── Issue Tab ────────────────────────────────────────────────────────────────

function IssueTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	const [step, setStep] = useState<'member' | 'item' | 'confirm'>('member')
	const [memberBarcode, setMemberBarcode] = useState('')
	const [itemBarcode, setItemBarcode] = useState('')
	const [member, setMember] = useState<LibMember | null>(null)
	const [item, setItem] = useState<LibItem | null>(null)
	const [issuing, setIssuing] = useState(false)
	const [result, setResult] = useState<LibLendingTransaction | null>(null)

	const lookupMember = useCallback(async (barcode: string) => {
		try {
			const res = await fetch(`/api/lib/members/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			if (!res.ok) throw new Error('Member not found')
			const data = await res.json()
			setMember(data)
			setStep('item')
		} catch {
			toast({ title: '❌ Member not found', description: `Barcode: ${barcode}`, variant: 'destructive' })
		}
	}, [institutionId, toast])

	const lookupItem = useCallback(async (barcode: string) => {
		try {
			const res = await fetch(`/api/lib/items/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			if (!res.ok) throw new Error('Item not found')
			const data = await res.json()
			setItem(data)
			setStep('confirm')
		} catch {
			toast({ title: '❌ Item not found', description: `Barcode: ${barcode}`, variant: 'destructive' })
		}
	}, [institutionId, toast])

	const handleIssue = async () => {
		if (!member || !item) return
		try {
			setIssuing(true)
			const tx = await issueItem({ member_id: member.id, item_id: item.id, institution_id: institutionId ?? '' })
			setResult(tx)
			toast({ title: '✅ Item issued successfully', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Issue failed'), variant: 'destructive' })
		} finally {
			setIssuing(false)
		}
	}

	const reset = () => {
		setStep('member')
		setMemberBarcode('')
		setItemBarcode('')
		setMember(null)
		setItem(null)
		setResult(null)
	}

	if (result) {
		return (
			<div className="space-y-4">
				<div className="flex flex-col items-center gap-3 py-10">
					<CheckCircle className="h-16 w-16 text-emerald-500" />
					<h3 className="text-xl font-semibold text-emerald-700">Issued Successfully</h3>
					<p className="text-muted-foreground text-sm text-center">
						Due date: <strong>{result.due_date ? new Date(result.due_date).toLocaleDateString('en-IN') : '—'}</strong>
					</p>
				</div>
				<Button className="h-10 px-6 w-full" onClick={reset}>Issue Another</Button>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* Step 1: Member */}
			<Card className={`transition-colors ${step === 'member' ? 'border-blue-400 shadow-sm' : member ? 'border-emerald-300' : ''}`}>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<div className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${member ? 'bg-emerald-500 text-white' : 'bg-blue-100 text-blue-700'}`}>
							{member ? '✓' : '1'}
						</div>
						Scan Member Card
						{member && (
							<Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 ml-auto text-xs">
								{member.member_number}
							</Badge>
						)}
					</CardTitle>
				</CardHeader>
				{step === 'member' && (
					<CardContent className="pt-0 pb-4 px-4">
						<BarcodeScannerInput
							onScan={lookupMember}
							placeholder="Scan member barcode or enter member number..."
							value={memberBarcode}
							onChange={setMemberBarcode}
						/>
					</CardContent>
				)}
				{member && step !== 'member' && (
					<CardContent className="pt-0 pb-3 px-4">
						<div className="flex items-center gap-2 text-sm">
							<User className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="font-medium">{member.display_name}</span>
							<MemberCategoryBadge category={member.member_category} />
						</div>
					</CardContent>
				)}
			</Card>

			{/* Step 2: Item */}
			<Card className={`transition-colors ${step === 'item' ? 'border-blue-400 shadow-sm' : item ? 'border-emerald-300' : 'opacity-60'}`}>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<div className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${item ? 'bg-emerald-500 text-white' : step === 'item' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>
							{item ? '✓' : '2'}
						</div>
						Scan Item Barcode
						{item && (
							<Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 ml-auto text-xs">
								{item.barcode}
							</Badge>
						)}
					</CardTitle>
				</CardHeader>
				{step === 'item' && (
					<CardContent className="pt-0 pb-4 px-4">
						<BarcodeScannerInput
							onScan={lookupItem}
							placeholder="Scan item barcode..."
							value={itemBarcode}
							onChange={setItemBarcode}
						/>
					</CardContent>
				)}
				{item && step === 'confirm' && (
					<CardContent className="pt-0 pb-3 px-4">
						<div className="text-sm">
							<p className="font-medium">{item.catalogue_record?.title}</p>
							<div className="flex items-center gap-2 mt-1">
								<span className="text-muted-foreground text-xs">Acc. {item.accession_number}</span>
								<ResourceStatusBadge status={item.status} />
							</div>
						</div>
					</CardContent>
				)}
			</Card>

			{/* Step 3: Confirm */}
			{step === 'confirm' && member && item && (
				<div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
					<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={reset}>Cancel</Button>
					<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleIssue} disabled={issuing}>
						{issuing ? (
							<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Issuing...</>
						) : (
							<><CheckCircle className="h-4 w-4 mr-2" />Confirm Issue</>
						)}
					</Button>
				</div>
			)}
		</div>
	)
}

// ─── Return Tab ───────────────────────────────────────────────────────────────

function ReturnTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	const [transaction, setTransaction] = useState<LibLendingTransaction | null>(null)
	const [returning, setReturning] = useState(false)
	const [result, setResult] = useState<LibLendingTransaction | null>(null)

	const lookupItem = useCallback(async (barcode: string) => {
		try {
			const res = await fetch(`/api/lib/circulation/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			if (!res.ok) throw new Error('Active loan not found for this item')
			const data = await res.json()
			setTransaction(data)
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Lookup failed'), variant: 'destructive' })
		}
	}, [institutionId, toast])

	const handleReturn = async () => {
		if (!transaction) return
		try {
			setReturning(true)
			const tx = await returnItem({ transaction_id: transaction.id, institution_id: institutionId ?? '' })
			setResult(tx)
			toast({ title: '✅ Item returned successfully', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Return failed'), variant: 'destructive' })
		} finally {
			setReturning(false)
		}
	}

	const reset = () => { setTransaction(null); setResult(null) }

	if (result) {
		return (
			<div className="space-y-4">
				<div className="flex flex-col items-center gap-3 py-10">
					<CheckCircle className="h-16 w-16 text-emerald-500" />
					<h3 className="text-xl font-semibold text-emerald-700">Returned Successfully</h3>
					<p className="text-muted-foreground text-sm">Item has been checked in</p>
				</div>
				<Button className="h-10 px-6 w-full" onClick={reset}>Return Another</Button>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<RotateCcw className="h-4 w-4 text-muted-foreground" />
						Scan Item to Return
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0 pb-4 px-4">
					<BarcodeScannerInput onScan={lookupItem} placeholder="Scan item barcode to return..." />
				</CardContent>
			</Card>

			{transaction && (
				<Card className="border-amber-300">
					<CardContent className="pt-4 pb-4 px-4 space-y-4">
						<div className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">Member</p>
								<p className="font-medium mt-0.5">{transaction.member?.display_name ?? transaction.member_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Item</p>
								<p className="font-medium mt-0.5 truncate">{transaction.item?.catalogue_record?.title ?? transaction.item_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Issued</p>
								<p className="mt-0.5">{new Date(transaction.issued_at).toLocaleDateString('en-IN')}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Due Date</p>
								<p className={`mt-0.5 ${transaction.overdue_days && transaction.overdue_days > 0 ? 'text-red-600 font-medium' : ''}`}>
									{new Date(transaction.due_date).toLocaleDateString('en-IN')}
								</p>
							</div>
						</div>
						{transaction.overdue_days && transaction.overdue_days > 0 && (
							<div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-red-700 text-sm">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>{transaction.overdue_days} days overdue — Charge: ₹{transaction.late_charge_amount?.toFixed(2)}</span>
							</div>
						)}
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={reset}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleReturn} disabled={returning}>
								{returning ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Returning...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Return</>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}

// ─── Renew Tab ────────────────────────────────────────────────────────────────

function RenewTab({ institutionId }: { institutionId: string | null }) {
	const { toast } = useToast()
	const [transaction, setTransaction] = useState<LibLendingTransaction | null>(null)
	const [renewing, setRenewing] = useState(false)
	const [result, setResult] = useState<LibLendingTransaction | null>(null)

	const lookupItem = useCallback(async (barcode: string) => {
		try {
			const res = await fetch(`/api/lib/circulation/lookup?barcode=${encodeURIComponent(barcode)}${institutionId ? `&institution_id=${institutionId}` : ''}`)
			if (!res.ok) throw new Error('Active loan not found for this item')
			const data = await res.json()
			setTransaction(data)
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Lookup failed'), variant: 'destructive' })
		}
	}, [institutionId, toast])

	const handleRenew = async () => {
		if (!transaction) return
		try {
			setRenewing(true)
			const tx = await renewItem({ transaction_id: transaction.id, institution_id: institutionId ?? '' })
			setResult(tx)
			toast({ title: '✅ Item renewed successfully', className: 'bg-green-50 border-green-200 text-green-800' })
		} catch (err) {
			toast({ title: '❌ ' + (err instanceof Error ? err.message : 'Renewal failed'), variant: 'destructive' })
		} finally {
			setRenewing(false)
		}
	}

	const reset = () => { setTransaction(null); setResult(null) }

	if (result) {
		return (
			<div className="space-y-4">
				<div className="flex flex-col items-center gap-3 py-10">
					<CheckCircle className="h-16 w-16 text-emerald-500" />
					<h3 className="text-xl font-semibold text-emerald-700">Renewed Successfully</h3>
					<p className="text-muted-foreground text-sm text-center">
						New due date: <strong>{result.due_date ? new Date(result.due_date).toLocaleDateString('en-IN') : '—'}</strong>
					</p>
				</div>
				<Button className="h-10 px-6 w-full" onClick={reset}>Renew Another</Button>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="py-3 px-4">
					<CardTitle className="text-sm flex items-center gap-2">
						<RefreshCw className="h-4 w-4 text-muted-foreground" />
						Scan Item to Renew
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0 pb-4 px-4">
					<BarcodeScannerInput onScan={lookupItem} placeholder="Scan item barcode to renew..." />
				</CardContent>
			</Card>

			{transaction && (
				<Card className="border-blue-300">
					<CardContent className="pt-4 pb-4 px-4 space-y-4">
						<div className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">Member</p>
								<p className="font-medium mt-0.5">{transaction.member?.display_name ?? transaction.member_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Item</p>
								<p className="font-medium mt-0.5 truncate">{transaction.item?.catalogue_record?.title ?? transaction.item_id}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Current Due Date</p>
								<p className="font-medium mt-0.5">{new Date(transaction.due_date).toLocaleDateString('en-IN')}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Renewals Used</p>
								<p className="font-medium mt-0.5">{transaction.renewal_count}</p>
							</div>
						</div>
						<div className="flex flex-col-reverse sm:flex-row gap-3">
							<Button variant="outline" className="h-10 px-6 w-full sm:w-auto" onClick={reset}>Cancel</Button>
							<Button className="h-10 px-6 w-full sm:w-auto flex-1" onClick={handleRenew} disabled={renewing}>
								{renewing ? (
									<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Renewing...</>
								) : (
									<><CheckCircle className="h-4 w-4 mr-2" />Confirm Renewal</>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CirculationPage() {
	const { institutionId } = useInstitutionFilter()

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto">
			{/* Header */}
			<div className="flex-shrink-0">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
						<ArrowRightLeft className="h-5 w-5 text-blue-600" />
					</div>
					<div>
						<h1 className="text-base font-semibold">Circulation Desk</h1>
						<p className="text-xs text-muted-foreground">Issue, return, and renew library resources</p>
					</div>
				</div>
			</div>

			{/* Tabs Card */}
			<Card className="flex-1">
				<CardContent className="p-4 sm:p-6">
					<div className="max-w-lg mx-auto">
						<Tabs defaultValue="issue">
							<TabsList className="w-full grid grid-cols-3 h-9">
								<TabsTrigger value="issue" className="text-sm">
									<BookOpen className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Issue
								</TabsTrigger>
								<TabsTrigger value="return" className="text-sm">
									<RotateCcw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Return
								</TabsTrigger>
								<TabsTrigger value="renew" className="text-sm">
									<RefreshCw className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
									Renew
								</TabsTrigger>
							</TabsList>
							<TabsContent value="issue" className="mt-5">
								<IssueTab institutionId={institutionId} />
							</TabsContent>
							<TabsContent value="return" className="mt-5">
								<ReturnTab institutionId={institutionId} />
							</TabsContent>
							<TabsContent value="renew" className="mt-5">
								<RenewTab institutionId={institutionId} />
							</TabsContent>
						</Tabs>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
