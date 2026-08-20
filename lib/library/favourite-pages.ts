'use client'

/**
 * Turning the page you are on into something that can be starred.
 *
 * The menu already knows every page's name, its group and its icon, so the star
 * asks the menu rather than keeping a second list that would go stale. A page
 * the menu does not know — a detail page like /registry/<id> — is starred as the
 * page it came from, because a shortcut to one particular book is not a
 * shortcut anybody wants in their sidebar.
 */

import type { ElementType } from 'react'
import { Star } from 'lucide-react'
import { navGroups } from '@/components/layout/lib-sidebar'

export interface FavouritablePage {
	path: string
	title: string
	module: string
	icon: ElementType
}

/** True when `pathname` is `prefix` or sits underneath it. */
function isUnder(pathname: string, prefix: string): boolean {
	if (prefix === '/') return pathname === '/'
	return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * The menu entry this path belongs to, or null when it belongs to none.
 *
 * The longest matching url wins, so /circulation/holds resolves to Holds rather
 * than to the Circulation Desk that sits above it in the menu.
 */
export function favouritablePageFor(pathname: string): FavouritablePage | null {
	let best: FavouritablePage | null = null

	for (const group of navGroups) {
		for (const item of group.items) {
			if (!isUnder(pathname, item.url)) continue
			if (best && item.url.length <= best.path.length) continue
			best = { path: item.url, title: item.title, module: group.label, icon: item.icon }
		}
	}

	return best
}

/**
 * The icon for a starred path. Read from the menu each time, so a page whose
 * icon changes there changes here too; a page that has left the menu keeps its
 * place in the list under a plain star rather than disappearing.
 */
export function iconForPath(path: string): ElementType {
	return favouritablePageFor(path)?.icon ?? Star
}
