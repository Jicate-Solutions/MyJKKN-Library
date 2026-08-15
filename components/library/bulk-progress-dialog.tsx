'use client'

/**
 * What a sheet looks like while it is going in.
 *
 * A thousand-row upload takes long enough that a silent button reads as a dead
 * one — the librarian clicks again, or closes the tab half way through. This
 * sits in the middle of the page, says how far along it is, and cannot be
 * dismissed while the work is running.
 *
 * The percentage is real, not decorative: the sheet is sent in batches and this
 * counts the rows the server has actually answered for.
 */

import { Loader2 } from 'lucide-react'

interface Props {
	open: boolean
	/** "Adding books" while uploading, "Saving changes" while editing. */
	title: string
	/** Rows the server has answered for so far. */
	done: number
	/** Total rows in the sheet. Zero means there is nothing to count yet. */
	total: number
	/** One line under the bar — what is happening right now. */
	note?: string
}

export function BulkProgressDialog({ open, title, done, total, note }: Props) {
	if (!open) return null

	const counting = total > 0
	const percent = counting ? Math.min(100, Math.round((done / total) * 100)) : 0

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			{/* No onClick: the work must not be dismissable half way through */}
			<div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

			<div
				role="status"
				aria-live="polite"
				className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
			>
				<div className="flex items-center gap-3">
					<Loader2 className="h-5 w-5 animate-spin text-primary" />
					<div className="flex-1">
						<p className="text-sm font-semibold">{title}</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							{counting ? `${done} of ${total} books` : 'Please wait...'}
						</p>
					</div>
					{counting && (
						<span className="text-2xl font-bold tabular-nums text-primary">{percent}%</span>
					)}
				</div>

				<div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className={
							counting
								? 'h-full rounded-full bg-primary transition-all duration-300 ease-out'
								: 'h-full w-1/3 rounded-full bg-primary animate-pulse'
						}
						style={counting ? { width: `${percent}%` } : undefined}
					/>
				</div>

				{note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}

				<p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
					Do not close this page until it finishes
				</p>
			</div>
		</div>
	)
}
