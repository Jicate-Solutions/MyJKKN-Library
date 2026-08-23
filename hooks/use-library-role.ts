'use client'

/**
 * The caller's library role, as MyJKKN gives it.
 *
 * This project keeps no roles of its own. A person is let in only when one of
 * their MyJKKN roles is a library role; `allowed` says whether that happened,
 * and `myjkknRoles` says what MyJKKN actually calls them, so the restricted
 * page can explain the refusal instead of just showing a locked door.
 *
 * While a super admin is viewing as someone else, `role` is that person's role,
 * because every screen must behave as it does for them. `impersonating` says
 * whose eyes you are looking through.
 *
 * Cached for the tab's lifetime so the sidebar, the route guard and the banner
 * share one request instead of asking on every navigation.
 */

import { useState, useEffect } from 'react'
import type { LibraryRole } from '@/lib/auth/library-roles'

export type { LibraryRole } from '@/lib/auth/library-roles'

export interface Impersonation {
	real_email: string
	viewing_as: string
}

export interface LibraryIdentity {
	role: LibraryRole | null
	fullName: string | null
	email: string | null
	impersonating: Impersonation | null
	/** null while unknown — neither allowed nor refused has been established yet. */
	allowed: boolean | null
	/** Why they were refused, when they were. */
	reason: string | null
	/** What MyJKKN says they are, library role or not. */
	myjkknRoles: string[]
	/** The roles that would have opened the library. */
	libraryRoles: string[]
	/**
	 * The pages their role may open, as a super admin set them on Role
	 * Management. null means unrestricted — a super admin, or the answer not
	 * being in yet.
	 */
	pages: string[] | null
}

const EMPTY: LibraryIdentity = {
	role: null,
	fullName: null,
	email: null,
	impersonating: null,
	allowed: null,
	reason: null,
	myjkknRoles: [],
	libraryRoles: [],
	pages: null,
}

let cached: LibraryIdentity | null = null
let inFlight: Promise<LibraryIdentity> | null = null

async function loadIdentity(): Promise<LibraryIdentity> {
	if (cached) return cached
	if (!inFlight) {
		inFlight = fetch('/api/lib/access/me')
			// A refusal still carries a body worth reading — it is what the
			// restricted page renders. Only a network failure gives nothing.
			.then(async res => {
				const json = await res.json().catch(() => null)
				return { ok: res.ok, json }
			})
			.then(({ ok, json }) => {
				cached = json
					? {
						role: (json.role as LibraryRole) ?? null,
						fullName: json.full_name ?? null,
						email: json.email ?? null,
						impersonating: json.impersonating ?? null,
						allowed: json.allowed === true ? true : json.allowed === false ? false : ok,
						reason: json.reason ?? null,
						myjkknRoles: json.myjkkn_roles ?? [],
						libraryRoles: json.library_roles ?? [],
						pages: Array.isArray(json.pages) ? json.pages : null,
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
		email: identity.email,
		impersonating: identity.impersonating,
		isReady,
		allowed: identity.allowed,
		reason: identity.reason,
		myjkknRoles: identity.myjkknRoles,
		libraryRoles: identity.libraryRoles,
		pages: identity.pages,
		/**
		 * Kept so the sidebar's signature does not have to change. Nobody is a
		 * `member` any more — borrowers do not sign in — so this is always false.
		 */
		isMember: false,
	}
}
