'use client'

import { useCallback } from 'react'

interface NavigationLogParams {
	to_path: string
	menu_title?: string
	menu_section?: string
}

/**
 * Hook for logging navigation events.
 * Provides a non-blocking fire-and-forget log function.
 */
export function useNavigationLog() {
	const logNavigation = useCallback(async (params: NavigationLogParams) => {
		try {
			await fetch('/api/lib/log/navigation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...params,
					logged_at: new Date().toISOString(),
				}),
			})
		} catch {
			// Silent fail — logging is non-critical
		}
	}, [])

	return { logNavigation }
}
