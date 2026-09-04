'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle, IndianRupee, Loader2, RotateCcw, Undo2 } from 'lucide-react'
import { canUndo, describeEvent, describeUndo, rupees, type DeskEvent, type MemberCharge } from '@/lib/library/desk'
import type { SettleMode } from '@/components/library/settle-charge-dialog'

const KIND_WORD: Record<DeskEvent['kind'], string> = {
	issue: 'Issued',
	return: 'Returned',
	renew: 'Renewed',
}

/**
 * What the desk last did, said on the page and left there.
 *
 * A toast is gone in four seconds, and at a counter the librarian is looking
 * at the learner when it fires. This line stays until the next action
 * replaces it, and it carries the two things that action might still need:
 * Undo, while the window is open, and Collect or Waive when a late return
 * has raised a charge.
 */
export function DeskLastResult({
	event,
	undoingKey,
	onUndo,
	onSettle,
}: {
	event: DeskEvent | null
	undoingKey: string | null
	onUndo: (event: DeskEvent) => void
	onSettle: (charge: MemberCharge, mode: SettleMode) => void
}) {
	// Re-read the clock every few seconds while an undo is on offer, so the
	// button goes away when the window closes rather than at the next action.
	const [, tick] = useState(0)
	useEffect(() => {
		if (!event || !canUndo(event)) return
		const timer = setInterval(() => tick(t => t + 1), 5000)
		return () => clearInterval(timer)
	}, [event])

	if (!event) return null

	const undone = event.undone === true
	const owing = !undone && event.kind === 'return' && event.charge
		&& event.charge.net_payable > 0
		&& (event.charge.payment_status === 'unpaid' || event.charge.payment_status === 'partial')
		? event.charge
		: null
	const undoable = canUndo(event)
	const busy = undoingKey === event.key

	return (
		<div
			role="status"
			aria-live="polite"
			className={
				undone
					? 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground'
					: owing
						? 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
						: 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
			}
		>
			{undone
				? <RotateCcw className="h-4 w-4 shrink-0" />
				: <CheckCircle className="h-4 w-4 shrink-0" />}

			<span className="min-w-0 flex-1">
				<span className="font-medium">{undone ? 'Undone' : KIND_WORD[event.kind]}</span>
				{' '}
				<span className="font-medium">{event.title}</span>
				{event.accession_number && <span className="ml-1.5 font-mono text-xs opacity-70">{event.accession_number}</span>}
				<span className="block text-xs opacity-80 sm:inline sm:ml-1.5">
					{undone
						? event.kind === 'issue'
							? `— back on the shelf, nothing lent to ${event.member_name}`
							: event.kind === 'return'
								? `— back with ${event.member_name}, the return and its charge removed`
								: `— old due date restored for ${event.member_name}`
						: `— ${describeEvent(event)}`}
				</span>
			</span>

			<span className="flex shrink-0 items-center gap-2">
				{owing && (
					<>
						<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSettle(owing, 'waive')}>
							Waive
						</Button>
						<Button size="sm" className="h-7 text-xs" onClick={() => onSettle(owing, 'collect')}>
							<IndianRupee className="mr-1 h-3 w-3" />
							Collect {rupees(owing.net_payable)}
						</Button>
					</>
				)}
				{undoable && (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-xs"
						disabled={busy}
						title={describeUndo(event)}
						onClick={() => onUndo(event)}
					>
						{busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
						Undo
					</Button>
				)}
			</span>
		</div>
	)
}
