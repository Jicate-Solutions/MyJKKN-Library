'use client'

/**
 * A standing reminder that you are not yourself right now.
 *
 * While viewing as someone else the whole app behaves as it does for them, so
 * without this it is genuinely possible to forget and take a real action in
 * their name. It stays on screen the entire session and cannot be dismissed —
 * only exited.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLibraryRole, refreshLibraryRole } from '@/hooks/use-library-role'
import { Button } from '@/components/ui/button'
import { Eye, X } from 'lucide-react'

export function ImpersonationBanner() {
	const { impersonating, isReady } = useLibraryRole()
	const router = useRouter()
	const [leaving, setLeaving] = useState(false)

	if (!isReady || !impersonating) return null

	const stop = async () => {
		try {
			setLeaving(true)
			await fetch('/api/lib/access/impersonate', { method: 'DELETE' })
			refreshLibraryRole()
			// Full reload: every cached screen was rendered as the other person
			window.location.href = '/access'
		} catch {
			setLeaving(false)
		}
	}

	return (
		<div className="flex items-center justify-between gap-3 rounded-md border border-brand-yellow-600 bg-brand-yellow-100 px-3 py-2 dark:border-brand-yellow-800 dark:bg-brand-yellow-900/30">
			<div className="flex items-center gap-2 min-w-0">
				<Eye className="h-4 w-4 shrink-0 text-brand-yellow-900 dark:text-brand-yellow-500" />
				<p className="text-xs text-brand-yellow-900 dark:text-brand-yellow-500 truncate">
					You are viewing the library as <strong>{impersonating.viewing_as}</strong>.
					Anything you do here is done as them, and is recorded against {impersonating.real_email}.
				</p>
			</div>
			<Button
				size="sm"
				variant="outline"
				onClick={stop}
				disabled={leaving}
				className="h-7 shrink-0 border-brand-yellow-700 bg-transparent text-xs text-brand-yellow-900 hover:bg-brand-yellow-200 dark:border-brand-yellow-700 dark:text-brand-yellow-400 dark:hover:bg-brand-yellow-900/50"
			>
				<X className="mr-1 h-3 w-3" />
				{leaving ? 'Leaving...' : 'Back to my account'}
			</Button>
		</div>
	)
}
