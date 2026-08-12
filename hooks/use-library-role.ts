'use client'

/**
 * The caller's library role, as this project sees it — not the MyJKKN one.
 *
 * While a super admin is viewing as someone else, `role` is that person's
 * role, because every screen must behave as it does for them. `impersonating`
 * says whose eyes you are looking through.
 *
 * Cached for the tab's lifetime so the sidebar, the route guard and the banner
 * share one request instead of asking on every navigation.
 */

import { useState, useEffect } from 'react'

export type LibraryRole = 'super_admin' | 'admin' | 'librarian' | 'assistant_librarian' | 'member'

export interface Impersonation {
	real_email: string
	viewing_as: string
}

export interface LibraryIdentity {
	role: LibraryRole | null
	fullName: string | null
	impersonating: Impersonation | null
}

const EMPTY: LibraryIdentity = { role: null, fullName: null, impersonating: null }

let cached: LibraryIdentity | null = null
let inFlight: Promise<LibraryIdentity> | null = null

async function loadIdentity(): Promise<LibraryIdentity> {
	if (cached) return cached
	if (!inFlight) {
		inFlight = fetch('/api/lib/access/me')
			.then(res => (res.ok ? res.json() : null))
			.then(json => {
				cached = json
					? {
						role: (json.role as LibraryRole) ?? null,
						fullName: json.full_name ?? null,
						impersonating: json.impersonating ?? null,
					}
					: EMPTY
				return cached
			})
			.catch(() => EMPTY)
			.finally(() => { inFlight = null })
	}
	return inFlight
}

/** Drops the cache so the next read reflects a started or stopped session. */
export function refreshLibraryRole() {
	cached = null
}

export function useLibraryRole() {
	const [identity, setIdentity] = useState<LibraryIdentity>(cached ?? EMPTY)
	const [isReady, setIsReady] = useState(cached !== null)

	useEffect(() => {
		let active = true
		loadIdentity().then(next => {
			if (!active) return
			setIdentity(next)
			setIsReady(true)
		})
		return () => { active = false }
	}, [])

	return {
		role: identity.role,
		fullName: identity.fullName,
		impersonating: identity.impersonating,
		isReady,
		isMember: identity.role === 'member',
	}
}
