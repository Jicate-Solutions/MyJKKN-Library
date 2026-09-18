'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, CheckCircle, IndianRupee, Loader2 } from 'lucide-react'
import { settleFine } from '@/services/library/lib-circulation-service'
import { rupees, messageOf, type MemberCharge } from '@/lib/library/desk'
import type { LibLateCharge } from '@/types/lib'

export type SettleMode = 'paid' | 'waive'

export interface SettleRequest {
	/** What is being settled, as the desk shows it. */
	charge: MemberCharge
	mode: SettleMode
	/**
	 * Set for a book still out: its fine is worked out and settled by the
	 * server, and `charge` is only what the desk displays. Absent for a charge
	 * already on record, which is settled by its id.
	 */
	transaction_id?: string
}

/**
 * A late book's fine as a charge the desk can show, before any charge exists.
 *
 * The fine on a book still out is not on record yet — the settle route writes
 * it — but the dialog and the buttons read one shape, so it is dressed as one.
 */
export function fineAsCharge(fine: {
	amount: number
	overdue_days: number
	charge_per_day?: number
	title: string
	accession_number: string | null
	due_date: string | null
}): MemberCharge {
	return {
		id: '',
		overdue_days: fine.overdue_days,
		charge_per_day: fine.charge_per_day ?? 0,
		total_charge: fine.amount,
		waiver_amount: 0,
		net_payable: fine.amount,
		payment_status: 'unpaid',
		created_at: new Date().toISOString(),
		due_date: fine.due_date,
		returned_at: null,
		accession_number: fine.accession_number,
		title: fine.title,
	}
}

/**
 * Waive, and under it Paid — the two ways a fine is cleared at the desk.
 *
 * The same pair wherever a fine is met: the book scanned at Return or Renew,
 * a late book on the member's card, a charge already owing, and the line that
 * says what just happened. Both are open to the assistant librarian, who runs
 * the desk.
 */
export function FineButtons({
	onChoose,
	disabled,
	compact,
}: {
	onChoose: (mode: SettleMode) => void
	disabled?: boolean
	compact?: boolean
}) {
	const size = compact ? 'h-9 text-xs sm:h-7' : 'h-10 text-xs sm:h-8'
	return (
		<div className="flex flex-col gap-1.5">
			<Button size="sm" variant="outline" className={size} disabled={disabled} onClick={() => onChoose('waive')}>
				Waive
			</Button>
			<Button size="sm" className={size} disabled={disabled} onClick={() => onChoose('paid')}>
				<IndianRupee className="mr-1 h-3 w-3" />
				Paid
			</Button>
		</div>
	)
}

/**
 * Clearing one late fine, where the member is standing.
 *
 * Paid asks one question — is the money in hand? — and Yes records the whole
 * amount as paid. Waive asks why, and lets the whole amount off. Either way
 * the fine is cleared, and a late book can then be returned or renewed.
 */
export function SettleChargeDialog({
	settling,
	institutionId,
	onClose,
	onSettled,
}: {
	settling: SettleRequest | null
	institutionId: string | null
	onClose: () => void
	onSettled: (charge: LibLateCharge, request: SettleRequest) => void
}) {
	const [reason, setReason] = useState('')
	const [saving, setSaving] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	// A fresh form for each fine opened
	useEffect(() => {
		if (!settling) return
		setReason('')
		setFormError(null)
	}, [settling])

	const submit = async () => {
		if (!settling) return
		const { charge, mode, transaction_id } = settling

		if (mode === 'waive' && !reason.trim()) {
			setFormError('Say why the fine is being let off')
			return
		}

		try {
			setSaving(true)
			setFormError(null)
			const saved = await settleFine({
				institution_id: institutionId ?? '',
				mode,
				...(transaction_id ? { transaction_id } : { charge_id: charge.id }),
				...(mode === 'waive' ? { waiver_reason: reason.trim() } : {}),
			})
			onSettled(saved, settling)
		} catch (err) {
			setFormError(messageOf(err, 'Could not clear the fine'))
		} finally {
			setSaving(false)
		}
	}

	const amount = settling ? rupees(settling.charge.net_payable) : ''
	const days = settling?.charge.overdue_days ?? 0
	const late = days > 0 ? ` · ${days} day${days === 1 ? '' : 's'} late` : ''

	return (
		<Dialog open={settling !== null} onOpenChange={o => { if (!o && !saving) onClose() }}>
			<DialogContent className="sm:max-w-[440px]">
				<DialogHeader>
					<DialogTitle>
						{settling?.mode === 'paid' ? 'Mark the fine as paid?' : 'Waive the fine'}
					</DialogTitle>
					<DialogDescription>
						{settling?.charge.title} — {amount}{late}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{settling?.mode === 'paid' ? (
						<p className="text-sm">
							Yes records <span className="font-semibold">{amount}</span> as paid in full and clears the fine.
						</p>
					) : (
						<div className="space-y-2">
							<Label htmlFor="fine-reason">Why</Label>
							<Textarea
								id="fine-reason"
								value={reason}
								onChange={e => setReason(e.target.value)}
								placeholder="e.g. Library was closed for three of those days"
								rows={3}
								autoFocus
							/>
							<p className="text-xs text-muted-foreground">
								The whole {amount} is let off and the fine is cleared.
							</p>
						</div>
					)}

					{formError && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							<AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
							<span>{formError}</span>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>
						{settling?.mode === 'paid' ? 'No' : 'Cancel'}
					</Button>
					<Button onClick={submit} disabled={saving} autoFocus={settling?.mode === 'paid'}>
						{saving
							? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
							: settling?.mode === 'paid'
								? <><CheckCircle className="mr-2 h-4 w-4" />Yes, paid</>
								: `Waive ${amount}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
