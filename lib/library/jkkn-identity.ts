/**
 * The QR on a JKKN ID card, turned into the person it belongs to.
 *
 * The colleges replaced the barcode on their ID cards with a QR code. The QR
 * holds one thing — the permanent JKKN id printed under it, `554938-1` — as
 * plain text, so a 2D scanner types it into the same box a barcode went into
 * and nothing about scanning changes. What changes is that this number is not
 * a number anybody is listed under: MyJKKN's staff and learner records have
 * never heard of it. Asking MyJKKN for `554938-1` returns nothing at all.
 *
 * It is answered by `jkkn_identities` in the sign-in project — the same
 * project `lib/auth/supabase-auth.ts` describes, reached with the same service
 * key, because the table is behind RLS and refuses the anon key outright
 * (42501, permission denied). Every row carries the id and a link to whoever
 * holds it:
 *
 *   * `person_kind` 'learner'     → `learner_profile_id`, the MyJKKN learner
 *   * `person_kind` 'team_member' → `team_member_id`, the MyJKKN staff member
 *
 * Both of those are exactly the ids this library already identifies people by
 * (`DirectoryPerson.myjkkn_id`), which is what makes this a lookup and not a
 * new kind of membership: the card says who, and MyJKKN still says whether
 * they are an active member of the college whose gate they are standing at.
 *
 * Deliberately NOT answered, all three checked against the live table on
 * 9 Sep 2026:
 *
 *   * `person_kind` 'both' — nine people who are a learner AND a staff member.
 *     Choosing one of the two for them is a decision the library was asked to
 *     make and declined: their cards resolve to nobody, and they carry on
 *     using their number exactly as they did before.
 *   * 'associate' and 'external_participant' — 309 cards that link to no
 *     member of any college. They are refused the same way an unknown card is.
 *   * A row whose link is missing (there is one, `305633-0`) and a retired
 *     card. Both are cards with nobody behind them.
 *
 * A card this cannot place is not an error — the caller falls back to reading
 * the value as a member number, and the door says "no member found" as it
 * always has.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const AUTH_URL = process.env.NEXT_PUBLIC_SUPABASE_URL1 ?? ''
/**
 * Server-only, and deliberately not `NEXT_PUBLIC_`.
 *
 * `jkkn_identities` is behind RLS: with the anon key it answers 42501 rather
 * than an empty list, so there is nothing to be gained by trying. Without this
 * key set, QR cards simply do not resolve and everything else works as before.
 */
const AUTH_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY1 ?? ''

/**
 * What a JKKN id looks like: six digits, a dash, one digit.
 *
 * Not a guess — all 7,672 ids in the table are this shape and no other. It is
 * narrow on purpose. Card numbers people are actually listed under carry
 * letters (`JKKN-CET-1954`, `NOTJIC007`, `NB230057`), so nothing that is
 * already scanned today can be mistaken for a QR id, and a value that is not
 * this shape never costs a lookup.
 */
const JKKN_ID = /^\d{6}-\d$/

/** Whether this scanned value could be the permanent id from a card's QR. */
export function looksLikeJkknId(value: string): boolean {
	return JKKN_ID.test(value.trim())
}

/** Whose card this is, in the terms the rest of the library already speaks. */
export interface JkknCardHolder {
	person_kind: 'learner' | 'facilitator'
	/** The MyJKKN learner-profile id or staff id. */
	myjkkn_id: string
}

/** True when this deployment can read the identity table at all. */
export function jkknIdentitiesConfigured(): boolean {
	return AUTH_URL.length > 0 && AUTH_SERVICE_KEY.length > 0
}

let reader: SupabaseClient | null = null

/** One read-only client, made once. It carries no session, so it is shareable. */
function getReader(): SupabaseClient | null {
	if (!jkknIdentitiesConfigured()) return null

	if (!reader) {
		reader = createClient(AUTH_URL, AUTH_SERVICE_KEY, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	}
	return reader
}

/**
 * Cards already read, so a queue at the door does not ask twice.
 *
 * A card's id and the person behind it are written once when the card is
 * issued and not touched again, so this is safe to hold briefly. Five minutes
 * is short enough that a card retired this morning stops working this morning,
 * and long enough that the same student scanning in and out at lunch costs one
 * lookup rather than two. A card that resolved to nobody is remembered too,
 * and for the same reason: a stranger's card scanned over and over at a busy
 * door must not become a queue of database round trips.
 */
const CARD_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { holder: JkknCardHolder | null; until: number }>()

/**
 * The person a QR card belongs to, or null when the card places nobody.
 *
 * This says who holds the card and nothing more. Whether they are a member of
 * the college doing the scanning is MyJKKN's answer, asked afterwards by the
 * caller — so a card from another campus is found here and still turned away
 * at the door, and one college cannot see another's people through a card.
 */
export async function personBehindJkknId(jkknId: string): Promise<JkknCardHolder | null> {
	const id = jkknId.trim()
	if (!looksLikeJkknId(id)) return null

	const remembered = cache.get(id)
	if (remembered && remembered.until > Date.now()) return remembered.holder

	const supabase = getReader()
	if (!supabase) return null

	const holder = await readCard(supabase, id)

	// Kept small by hand: a door does thousands of scans a day and this map has
	// no other bound. Clearing it whole is fine — the next scan of a card that
	// was in it costs one lookup, which is what it cost before there was a map.
	if (cache.size > 5000) cache.clear()
	cache.set(id, { holder, until: Date.now() + CARD_TTL_MS })

	return holder
}

/** One row, read and judged. Never throws — an unreachable table is an unknown card. */
async function readCard(supabase: SupabaseClient, id: string): Promise<JkknCardHolder | null> {
	try {
		const { data, error } = await supabase
			.from('jkkn_identities')
			.select('person_kind, learner_profile_id, team_member_id, retired_at')
			.eq('jkkn_id', id)
			// A card handed back or reissued places nobody.
			.is('retired_at', null)
			.limit(1)
			.maybeSingle()

		if (error) {
			// 42P01 is a project without the table, PGRST116 no row. Neither is
			// worth a line in the log at a door; anything else is.
			if (error.code !== 'PGRST116' && error.code !== '42P01') {
				console.error('[qr] could not read jkkn_identities:', error.message)
			}
			return null
		}

		if (!data) return null

		const kind = (data.person_kind ?? '').toString()
		const learner = (data.learner_profile_id ?? '').toString().trim()
		const staff = (data.team_member_id ?? '').toString().trim()

		if (kind === 'learner' && learner) return { person_kind: 'learner', myjkkn_id: learner }
		if (kind === 'team_member' && staff) return { person_kind: 'facilitator', myjkkn_id: staff }

		// 'both', 'associate', 'external_participant', or a row with no link at
		// all: a card with nobody this library can act on behind it.
		return null
	} catch (err) {
		console.error('[qr] jkkn_identities lookup failed:', err)
		return null
	}
}
