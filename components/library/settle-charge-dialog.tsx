'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, CheckCircle, IndianRupee, Loader2, Paperclip, ReceiptIndianRupee, X } from 'lucide-react'
import { settleFine } from '@/services/library/lib-circulation-service'
import { uploadWaiverLetter } from '@/services/library/lib-late-charges-service'
import { rupees, messageOf, type MemberCharge } from '@/lib/library/desk'
import type { LibLateCharge } from '@/types/lib'

/**
 * The three ways a late fine stops standing in the way of the book.
 *
 * 'paid' and 'waive' are the counter's: money in hand, or let off. 'bill' puts
 * the amount on the learner's MyJKKN bill instead, beside their tuition and
 * hostel fees — the library stops asking for it, and it is marked paid here
 * only when MyJKKN says they have paid it.
 */
export type SettleMode = 'paid' | 'waive' | 'bill'

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
 * Waive, Paid, and — for a learner — Add to bill: the ways a fine is cleared.
 *
 * The same set wherever a fine is met: the book scanned at Return or Renew, a
 * late book on the member's card, a charge already owing, and the line that
 * says what just happened. All are open to the assistant librarian, who runs
 * the desk.
 *
 * Add to bill only appears where it can work — a learner, in a library whose
 * MyJKKN billing is set up. A facilitator has no MyJKKN bill to put it on, and
 * before somebody creates the Library Fine category over there the button
 * would only ever fail, so neither is offered it.
 */
export function FineButtons({
	onChoose,
	disabled,
	compact,
	canBill,
}: {
	onChoose: (mode: SettleMode) => void
	disabled?: boolean
	compact?: boolean
	/** Whether this fine can go on a MyJKKN bill — a learner, billing configured. */
	canBill?: boolean
}) {
	const size = compact ? 'h-9 text-xs sm:h-7' : 'h-10 text-xs sm:h-8'
	return (
		<div className="flex flex-col gap-1.5">
			<Button size="sm" variant="outline" className={size} disabled={disabled} onClick={() => onChoose('waive')}>
				Waive
			</Button>
			{canBill && (
				<Button
					size="sm"
					variant="outline"
					className={size}
					disabled={disabled}
					title="Put it on their MyJKKN bill — they pay it there with their other fees"
					onClick={() => onChoose('bill')}
				>
					<ReceiptIndianRupee className="mr-1 h-3 w-3" />
					Add to bill
				</Button>
			)}
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
 * amount as paid. Waive asks why, and lets the whole amount off. Add to bill
 * asks nothing beyond Yes: the amount goes onto the learner's MyJKKN bill and
 * stays owed there. Any of the three clears the counter, and a late book can
 * then be returned or renewed.
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
	/** The principal's signed letter, chosen but not yet sent. Optional. */
	const [letter, setLetter] = useState<File | null>(null)
	const letterRef = useRef<HTMLInputElement>(null)

	// A fresh form for each fine opened
	useEffect(() => {
		if (!settling) return
		setReason('')
		setFormError(null)
		setLetter(null)
		if (letterRef.current) letterRef.current.value = ''
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

			// The letter goes up first and the waiver carries its path. If this
			// throws, nothing is settled — better a fine still owing than a
			// waiver on record claiming a letter that was never stored.
			let doc: { path: string; name: string } | null = null
			if (mode === 'waive' && letter) {
				doc = await uploadWaiverLetter(institutionId ?? '', letter)
			}

			const saved = await settleFine({
				institution_id: institutionId ?? '',
				mode,
				...(transaction_id ? { transaction_id } : { charge_id: charge.id }),
				...(mode === 'waive' ? { waiver_reason: reason.trim() } : {}),
				...(doc ? { waiver_document_path: doc.path, waiver_document_name: doc.name } : {}),
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
						{settling?.mode === 'paid'
							? 'Mark the fine as paid?'
							: settling?.mode === 'bill'
								? 'Add the fine to their MyJKKN bill?'
								: 'Waive the fine'}
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
					) : settling?.mode === 'bill' ? (
						<div className="space-y-2 text-sm">
							<p>
								<span className="font-semibold">{amount}</span> goes onto their MyJKKN bill, beside
								their other fees. They pay it there, in their own time.
							</p>
							<p className="text-xs text-muted-foreground">
								The book can go back now. The fine stays owed until MyJKKN says it is paid, and
								this library marks it Paid on its own when that happens — so do not take the money
								at the counter as well.
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{/* Required, and said so before the librarian types rather than
							    after they press the button. Money let off is the one thing
							    here nobody can reconstruct later: without the reason on the
							    record there is no answer to "why was this waived". */}
							<Label htmlFor="fine-reason">
								Why <span className="text-destructive">*</span>
							</Label>
							<Textarea
								id="fine-reason"
								value={reason}
								onChange={e => setReason(e.target.value)}
								placeholder="e.g. Library was closed for three of those days"
								rows={3}
								autoFocus
								required
								aria-required="true"
							/>
							<p className="text-xs text-muted-foreground">
								A reason is needed. The whole {amount} is let off and the fine is cleared.
							</p>

							{/* The signed letter, and deliberately optional. Where the
							    college asks for a letter the principal has signed, it
							    belongs on the record beside the reason — a typed
							    sentence is not what authorised the money. Where no
							    letter was asked for, a small fine let off at the
							    counter should not wait for one. */}
							<div className="space-y-1.5 pt-1">
								<Label htmlFor="waiver-letter" className="text-xs font-normal text-muted-foreground">
									Signed letter <span className="font-normal">(optional)</span>
								</Label>

								{letter ? (
									<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
										<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate" title={letter.name}>{letter.name}</span>
										<span className="shrink-0 text-muted-foreground">
											{(letter.size / 1048576).toFixed(1)} MB
										</span>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-6 w-6 shrink-0 p-0"
											disabled={saving}
											onClick={() => {
												setLetter(null)
												if (letterRef.current) letterRef.current.value = ''
											}}
											aria-label="Remove the letter"
										>
											<X className="h-3.5 w-3.5" />
										</Button>
									</div>
								) : (
									<p className="text-xs text-muted-foreground">
										Attach the letter the principal signed, if there is one. PDF, JPG or PNG, up to 1 MB.
									</p>
								)}

								<Input
									ref={letterRef}
									id="waiver-letter"
									type="file"
									accept="application/pdf,image/jpeg,image/png"
									disabled={saving}
									className="h-9 cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
									onChange={e => {
										const picked = e.target.files?.[0] ?? null
										// Refused here as well as on the server, so the
										// librarian hears it now rather than after waiting
										// for the upload to finish and fail.
										if (picked && picked.size > 1024 * 1024) {
											setFormError(`That file is ${(picked.size < 2 * 1024 * 1024 ? `${Math.round(picked.size / 1024)} KB` : `${(picked.size / 1048576).toFixed(1)} MB`)} — 1 MB is the most we can take`)
											e.target.value = ''
											setLetter(null)
											return
										}
										setFormError(null)
										setLetter(picked)
									}}
								/>
							</div>
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
						{settling?.mode === 'paid' || settling?.mode === 'bill' ? 'No' : 'Cancel'}
					</Button>
					{/* Waive waits for its reason: the button cannot be pressed on an
					    empty box, so the refusal is visible before the click, not after
					    it. Paid and Add to bill ask nothing and stay ready. */}
					<Button
						onClick={submit}
						disabled={saving || (settling?.mode === 'waive' && !reason.trim())}
						autoFocus={settling?.mode !== 'waive'}
					>
						{saving
							? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
							: settling?.mode === 'paid'
								? <><CheckCircle className="mr-2 h-4 w-4" />Yes, paid</>
								: settling?.mode === 'bill'
									? <><ReceiptIndianRupee className="mr-2 h-4 w-4" />Yes, add {amount} to their bill</>
									: `Waive ${amount}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
