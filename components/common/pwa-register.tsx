'use client'

/**
 * Registers the service worker that makes the library installable.
 *
 * Draws nothing. Production only: in development the worker would cache
 * built assets that change on every save, and the browser only allows a
 * worker on https or localhost anyway. A browser without service workers
 * simply keeps using the site as before.
 */

import { useEffect } from 'react'

export function PwaRegister() {
	useEffect(() => {
		if (process.env.NODE_ENV !== 'production') return
		if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
		if (!window.isSecureContext) return

		navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
			// Registration refused: the site works exactly as before, only not installable
		})
	}, [])

	return null
}
