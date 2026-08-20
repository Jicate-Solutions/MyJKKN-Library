'use client'

/**
 * The signed-in person's starred pages.
 *
 * Held in one store rather than fetched per component, because two places show
 * the same list at once — the star in the header and the Favourites section in
 * the sidebar — and they must agree the instant either one changes.
 *
 * Every change is applied on screen first and sent to the server after. If the
 * server refuses, the previous list is put back, so a failed save can never
 * leave the sidebar showing something that was not saved.
 */

import { create } from 'zustand'

export interface FavouritePage {
	id?: string
	path: string
	title: string
	module: string
	sortOrder: number
	isPinned: boolean
}

/** Pinned first, then the order the person arranged. */
function inOrder(list: FavouritePage[]): FavouritePage[] {
	return [...list].sort((a, b) => {
		if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
		return a.sortOrder - b.sortOrder
	})
}

interface FavouritesState {
	favourites: FavouritePage[]
	loading: boolean
	/** False until the first load finishes, so nothing renders a guess. */
	loaded: boolean
	error: string | null

	load: (force?: boolean) => Promise<void>
	isFavourite: (path: string) => boolean
	add: (page: { path: string; title: string; module: string }) => Promise<void>
	remove: (path: string) => Promise<void>
	togglePin: (path: string) => Promise<void>
	reorder: (orderedPaths: string[]) => Promise<void>
}

export const usePageFavourites = create<FavouritesState>()((set, get) => ({
	favourites: [],
	loading: false,
	loaded: false,
	error: null,

	async load(force = false) {
		const { loading, loaded } = get()
		if (loading) return
		if (loaded && !force) return

		set({ loading: true, error: null })
		try {
			const res = await fetch('/api/lib/favourites')
			if (!res.ok) throw new Error('Could not load your favourites')
			const data = (await res.json()) as FavouritePage[]
			set({ favourites: inOrder(data), loaded: true })
		} catch (err) {
			// A sidebar section that cannot load is simply not shown; it must never
			// take the page down with it
			set({ error: err instanceof Error ? err.message : 'Could not load your favourites', loaded: true })
		} finally {
			set({ loading: false })
		}
	},

	isFavourite(path) {
		return get().favourites.some(f => f.path === path)
	},

	async add(page) {
		const previous = get().favourites
		if (previous.some(f => f.path === page.path)) return

		const optimistic: FavouritePage = {
			path: page.path,
			title: page.title,
			module: page.module,
			sortOrder: previous.length,
			isPinned: false,
		}
		set({ favourites: inOrder([...previous, optimistic]) })

		try {
			const res = await fetch('/api/lib/favourites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(page),
			})
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed')

			// Take the saved row back, so the id it was given is the one we hold
			const saved = (await res.json()) as FavouritePage
			set(state => ({
				favourites: inOrder(state.favourites.map(f => (f.path === saved.path ? saved : f))),
			}))
		} catch {
			set({ favourites: previous })
		}
	},

	async remove(path) {
		const previous = get().favourites
		set({ favourites: previous.filter(f => f.path !== path) })

		try {
			const res = await fetch(`/api/lib/favourites?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
			if (!res.ok) throw new Error('Failed')
		} catch {
			set({ favourites: previous })
		}
	},

	async togglePin(path) {
		const previous = get().favourites
		const target = previous.find(f => f.path === path)
		if (!target) return

		const isPinned = !target.isPinned
		set({ favourites: inOrder(previous.map(f => (f.path === path ? { ...f, isPinned } : f))) })

		try {
			const res = await fetch('/api/lib/favourites', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path, isPinned }),
			})
			if (!res.ok) throw new Error('Failed')
		} catch {
			set({ favourites: previous })
		}
	},

	async reorder(orderedPaths) {
		const previous = get().favourites

		// The dragged order is the new sort_order, top to bottom. Pinned rows keep
		// their pin; the list is re-sorted so pinned still come first.
		const byPath = new Map(previous.map(f => [f.path, f]))
		const next = orderedPaths
			.map((path, index) => {
				const found = byPath.get(path)
				return found ? { ...found, sortOrder: index } : null
			})
			.filter((f): f is FavouritePage => f !== null)

		if (next.length !== previous.length) return
		set({ favourites: inOrder(next) })

		try {
			const res = await fetch('/api/lib/favourites', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ order: orderedPaths }),
			})
			if (!res.ok) throw new Error('Failed')
		} catch {
			set({ favourites: previous })
		}
	},
}))
