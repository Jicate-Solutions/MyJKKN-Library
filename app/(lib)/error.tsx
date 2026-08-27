'use client'

/**
 * What a librarian sees when a page throws.
 *
 * Without this file, one component throwing anywhere in the library replaced
 * the entire application with Next.js's own "This page couldn't load" — a bare
 * white screen, no sidebar, no menu, no way back except the browser. A single
 * bad field in one table took away the desk, the catalogue and everything else
 * with it.
 *
 * React only stops at a boundary it can find. This is that boundary, placed on
 * the library layout so the shell around it survives: the sidebar stays, the
 * institution switcher stays, and every other page is still one click away.
 * Only the panel that failed is replaced.
 *
 * `reset()` re-renders the same page without a full reload, which is usually
 * enough — most of these are a request that came back in an unexpected shape,
 * and the second attempt succeeds.
 *
 * The message is deliberately shown rather than hidden. "Something went wrong"
 * tells a librarian nothing they can repeat down the phone, and the person who
 * has to fix it then starts from nothing.
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react'

export default function LibraryError({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		// The browser console is where this gets diagnosed from; the card below
		// only carries enough for somebody to report it
		console.error('[library] A page failed to render:', error)
	}, [error])

	return (
		<div className="flex flex-1 items-center justify-center p-4">
			<Card className="w-full max-w-lg border-l-4 border-l-destructive">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
						<AlertTriangle className="h-7 w-7 text-destructive" />
					</div>

					<div className="space-y-1">
						<h1 className="text-lg font-semibold font-heading">This page could not be shown</h1>
						<p className="text-sm text-muted-foreground">
							Nothing has been lost and nothing was saved incorrectly — the screen simply
							failed to draw. Try again; if it keeps happening, send the line below to
							whoever looks after the system.
						</p>
					</div>

					{(error.message || error.digest) && (
						<div className="w-full rounded-md border bg-muted/40 px-4 py-3 text-left">
							{error.message && (
								<p className="break-words font-mono text-xs text-foreground">{error.message}</p>
							)}
							{error.digest && (
								<p className="mt-1 font-mono text-[10px] text-muted-foreground">
									Reference: {error.digest}
								</p>
							)}
						</div>
					)}

					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							onClick={reset}
							size="sm"
							className="bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
						>
							<RefreshCw className="mr-1.5 h-4 w-4" />
							Try again
						</Button>
						<Button asChild variant="outline" size="sm">
							<Link href="/dashboard">
								<LayoutDashboard className="mr-1.5 h-4 w-4" />
								Go to the dashboard
							</Link>
						</Button>
					</div>

					<p className="text-xs text-muted-foreground">
						The rest of the library is still open — the menu on the left still works.
					</p>
				</CardContent>
			</Card>
		</div>
	)
}
