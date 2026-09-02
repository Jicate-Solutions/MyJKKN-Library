/**
 * The last register this browser was shown, kept so the next visit opens on it.
 *
 * Every visit to the catalogue used to start from nothing: a spinner while the
 * whole register came down again, even for the librarian who left the page
 * twenty seconds ago to issue a book. Now the last copy is shown at once and
 * the fresh one is fetched behind it — the page is readable immediately and
 * correct a moment later.
 *
 * Two layers, because they fail differently:
 *
 *   * memory — survives moving between pages of the app, which is the common
 *     case, and has no size limit. Gone on a full reload.
 *   * sessionStorage — survives a reload, and is gone when the tab closes, so a
 *     shared desk never opens on yesterday's register. Capped by the browser at
 *     a few megabytes; the largest college's register is close to that, and a
 *     write that will not fit is simply skipped rather than failing the page.
 *
 * Keyed by the request URL, which already carries the institution — so seven
 * colleges are seven entries, and a super admin switching between them is
 * shown each one's own register and never another's.
 *
 * Forgotten, not patched, whenever this page changes the register: a book
 * added or removed clears the entry, and the next visit reads afresh. A cache
 * that tried to mirror every edit would eventually disagree with the shelf.
 */

import { isRegisterPayload, type RegisterPayload } from '@/lib/library/register-rows'

const PREFIX = 'lib:register:'

/** Bumped whenever the payload's shape changes, so an older tab's copy is ignored rather than misread. */
const VERSION = 1

interface Stored {
	v: number
	payload: RegisterPayload
}

const memory = new Map<string, RegisterPayload>()

function storage(): Storage | null {
	try {
		return typeof window !== 'undefined' ? window.sessionStorage : null
	} catch {
		// Some browsers throw on the accessor itself when site data is blocked
		return null
	}
}

export function readRegisterCache(key: string): RegisterPayload | null {
	const held = memory.get(key)
	if (held) return held

	const store = storage()
	if (!store) return null
	try {
		const raw = store.getItem(PREFIX + key)
		if (!raw) return null
		const parsed = JSON.parse(raw) as Partial<Stored>
		if (parsed.v !== VERSION || !isRegisterPayload(parsed.payload)) return null
		memory.set(key, parsed.payload)
		return parsed.payload
	} catch {
		return null
	}
}

export function writeRegisterCache(key: string, payload: RegisterPayload): void {
	memory.set(key, payload)

	const store = storage()
	if (!store) return
	try {
		store.setItem(PREFIX + key, JSON.stringify({ v: VERSION, payload } satisfies Stored))
	} catch {
		// Quota exceeded, or storage disabled — memory still has it, and the
		// next reload simply fetches as it always did.
	}
}

export function clearRegisterCache(key: string): void {
	memory.delete(key)
	const store = storage()
	if (!store) return
	try {
		store.removeItem(PREFIX + key)
	} catch {
		// Nothing to do: an entry that cannot be removed also cannot be read
	}
}
