'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Clock, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import { asDate, asTime, canUndo, describeUndo, rupees, type DeskEvent } from '@/lib/library/desk'
import { cn } from '@/lib/utils'

const KIND_BADGE: Record<DeskEvent['kind'], { word: string; className: string }> = {
	issue: { word: 'Issued', className: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' },
	return: { word: 'Returned', className: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300' },
	renew: { word: 'Renewed', className: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300' },
}

/**
 * Everything this desk has done today, newest first.
 *
 * "Did that go through?" is asked a dozen times a day, and used to send the
 * librarian to the Activity Log with a member number on a slip. It is
 * answered here, on the same page, folded away until it is wanted. An action
 * made in this sitting keeps its Undo while the window is open.
 */
export function DeskTodayStrip({
	events,
	loading,
	onRefresh,
	onUndo,
	undoingKey,
}: {
	events: DeskEvent[]
	loading: boolean
	onRefresh: () => void
	onUndo: (event: DeskEvent) => void
	undoingKey: string | null
}) {
	const [open, setOpen] = useState(false)

	// While any line can still be undone, re-read the clock now and then so a
	// closed window takes its button with it.
	const [, tick] = useState(0)
	useEffect(() => {
		if (!events.some(e => canUndo(e))) return
		const timer = setInterval(() => tick(t => t + 1), 10000)
		return () => clearInterval(timer)
	}, [events])

	const live = events.filter(e => !e.undone)
	const counts = {
		issue: live.filter(e => e.kind === 'issue').length,
		return: live.filter(e => e.kind === 'return').length,
		renew: live.filter(e => e.kind === 'renew').length,
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
			<div className="flex items-center gap-2 px-3 py-2">
				<CollapsibleTrigger asChild>
					<button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
						<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="font-medium">Today at this desk</span>
						<span className="truncate text-xs text-muted-foreground">
							{loading && events.length === 0
								? 'reading…'
								: live.length === 0
									? 'nothing yet'
									: `${counts.issue} issued · ${counts.return} returned · ${counts.renew} renewed`}
						</span>
						<ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
					</button>
				</CollapsibleTrigger>
				<Button
					size="sm"
					variant="ghost"
					className="h-7 w-7 shrink-0 p-0"
					onClick={onRefresh}
					disabled={loading}
					title="Read again"
					aria-label="Read again"
				>
					<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
				</Button>
			</div>

			<CollapsibleContent>
				{events.length === 0 ? (
					<p className="border-t px-3 py-3 text-xs text-muted-foreground">
						{loading ? 'Reading today\'s work…' : 'No issues, returns or renewals at this college today yet.'}
					</p>
				) : (
					<div className="max-h-80 overflow-y-auto border-t">
						<ul className="divide-y">
							{events.map(event => {
								const badge = KIND_BADGE[event.kind]
								const owing = event.kind === 'return' && event.charge
									&& event.charge.net_payable > 0
									&& (event.charge.payment_status === 'unpaid' || event.charge.payment_status === 'partial')
								return (
									<li
										key={event.key}
										className={cn(
											'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm',
											event.undone && 'opacity-50'
										)}
									>
										<span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{asTime(event.at)}</span>
										<Badge variant="outline" className={cn('shrink-0 text-[11px]', badge.className)}>
											{event.undone ? `${badge.word} — undone` : badge.word}
										</Badge>
										<span className={cn('min-w-0 flex-1 truncate', event.undone && 'line-through')}>
											<span className="font-medium">{event.title}</span>
											{event.accession_number && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{event.accession_number}</span>}
										</span>
										<span className="truncate text-xs text-muted-foreground">
											{event.member_name}
											{event.member_number ? ` · ${event.member_number}` : ''}
											{event.kind !== 'return' && event.due_date ? ` · due ${asDate(event.due_date)}` : ''}
											{event.kind === 'return' && event.late_days ? ` · ${event.late_days}d late` : ''}
											{owing && event.charge ? ` · ${rupees(event.charge.net_payable)} owing` : ''}
										</span>
										{canUndo(event) && (
											<Button
												size="sm"
												variant="ghost"
												className="h-6 px-2 text-xs"
												disabled={undoingKey === event.key}
												title={describeUndo(event)}
												onClick={() => onUndo(event)}
											>
												{undoingKey === event.key
													? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
													: <Undo2 className="mr-1 h-3 w-3" />}
												Undo
											</Button>
										)}
									</li>
								)
							})}
						</ul>
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	)
}
