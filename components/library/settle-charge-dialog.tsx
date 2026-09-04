'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { collectPayment, waiveCharge } from '@/services/library/lib-late-charges-service'
import { rupees, messageOf, type MemberCharge } from '@/lib/library/desk'
import type { LibLateCharge } from '@/types/lib'

export type SettleMode = 'collect' | 'waive'

export interface SettleRequest {
	charge: MemberCharge
	mode: SettleMode
}

/**
 * Collecting or waiving one late charge, where the member is standing.
 *
 * Collecting needs a reference and waiving needs a reason — both are what the
 * charges page asks for, and neither is invented here, so a fine settled at the
 * desk is recorded exactly as one settled from that page. The member card and
 * the line that says "returned, ₹25 to collect" both open this same dialog.
 */
export function SettleChargeDialog({
	settling,
	onClose,
	onSettled,
}: {
	settling: SettleRequest | null
	onClose: () => void
	onSettled: (charge: LibLateCharge, request: SettleRequest) => void
}) {
	const [reference, setReference] = useState('')
	const [reason, setReason] = useState('')
	const [amount, setAmount] = useState('')
	const [saving, setSaving] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	// A fresh form for each charge opened. The amount starts as the whole of
	// what is still owed, which is what is waived most of the time; a librarian
	// letting off only part of it types over this.
	useEffect(() => {
		if (!settling) return
		setReference('')
		setReason('')
		setAmount(String(settling.charge.net_payable))
		setFormError(null)
	}, [settling])

	const submit = async () => {
		if (!settling) return
		const { charge, mode } = settling

		if (mode === 'collect' && !reference.trim()) {
			setFormError('A receipt or reference number is needed to record the payment')
			return
		}
		if (mode === 'waive' && !reason.trim()) {
			setFormError('Say why the charge is being let off')
			return
		}

		try {
			setSaving(true)
			setFormError(null)
			let saved: LibLateCharge
			if (mode === 'collect') {
				saved = await collectPayment(charge.id, { payment_reference: reference.trim() })
			} else {
				const asked = Number(amount)
				saved = await waiveCharge(charge.id, {
					waiver_amount: Number.isFinite(asked) && asked > 0 ? asked : charge.net_payable,
					waiver_reason: reason.trim(),
				})
			}
			onSettled(saved, settling)
		} catch (err) {
			setFormError(messageOf(err, 'Could not settle the charge'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog open={settling !== null} onOpenChange={o => { if (!o && !saving) onClose() }}>
			<DialogContent className="sm:max-w-[440px]">
				<DialogHeader>
					<DialogTitle>
						{settling?.mode === 'collect' ? 'Collect payment' : 'Waive the charge'}
					</DialogTitle>
					<DialogDescription>
						{settling?.charge.title} — {settling ? rupees(settling.charge.net_payable) : ''} owing
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{settling?.mode === 'collect' ? (
						<div className="space-y-2">
							<Label htmlFor="charge-reference">Receipt or reference number</Label>
							<Input
								id="charge-reference"
								value={reference}
								onChange={e => setReference(e.target.value)}
								onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
								placeholder="e.g. RCPT/2026/0148"
								autoFocus
							/>
						</div>
					) : (
						<>
							<div className="space-y-2">
								<Label htmlFor="charge-amount">How much to let off</Label>
								<Input
									id="charge-amount"
									type="number"
									min="0"
									step="0.01"
									value={amount}
									onChange={e => setAmount(e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Less than the full amount leaves the rest still owed.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="charge-reason">Why</Label>
								<Textarea
									id="charge-reason"
									value={reason}
									onChange={e => setReason(e.target.value)}
									placeholder="e.g. Library was closed for three of those days"
									rows={3}
									autoFocus
								/>
							</div>
						</>
					)}

					{formError && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							<AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
							<span>{formError}</span>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
					<Button onClick={submit} disabled={saving}>
						{saving
							? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
							: settling?.mode === 'collect' ? 'Record payment' : 'Waive'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
