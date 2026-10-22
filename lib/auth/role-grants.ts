/**
 * Temporary access for somebody MyJKKN has no library role for.
 *
 * The normal way in is the only way in: MyJKKN proves who you are and MyJKKN's
 * staff record says what you are. Occasionally that is not yet true of somebody
 * who needs the library today — a director sitting in on a meeting, an auditor,
 * a person being hired into a post that has not been created yet. Adding them
 * as staff in MyJKKN is the right long answer; this is the short one.
 *
 * What this is NOT: a second login. There is no password here and none is
 * stored anywhere in this project. A granted person still signs in through
 * MyJKKN exactly like everybody else — the token is validated the same way, the
 * email comes from MyJKKN, and all this does is answer the one question MyJKKN
 * could not: what library role does this email get. Somebody without a MyJKKN
 * account gains nothing from being listed here.
 *
 * WHY AN ENVIRONMENT VARIABLE AND NOT A FILE
 *
 * This repository is public. A file naming the accounts that currently hold
 * super_admin is a list of exactly who to phish, published to the world and
 * kept in the git history long after the grant expires. In the environment it
 * stays private, and it can be revoked by editing one value — no code change,
 * no review, no deploy of a commit that says who was given what.
 *
 * FORMAT
 *
 *   LIBRARY_ACCESS_GRANTS="email:role:YYYY-MM-DD,email:role:COLLEGE:YYYY-MM-DD"
 *
 * for example
 *
 *   LIBRARY_ACCESS_GRANTS="director@jkkn.ac.in:super_admin:2026-09-25,
 *                          priya@jkkn.ac.in:stock_check:CNR:2026-10-20"
 *
 * The date is the LAST DAY the grant works. After it, the entry stops being
 * read and the person goes back to whatever MyJKKN says they are — which for
 * somebody with no staff record is the restricted page. Nothing has to be
 * cleaned up and nothing in the database changes, which is the point: an
 * access grant that needs remembering is one that gets forgotten.
 *
 * Every entry must be complete. A line missing its role or its date, or naming
 * a role this library does not have, is refused and logged rather than guessed
 * at — a half-read grant is how somebody ends up with more than was meant.
 *
 * THE COLLEGE, AND WHY IT HAD TO BE ADDED
 *
 * A college's code — COP, AHS, CAS, CET, CNR, COE, DCH — may be given as a
 * fourth part. It is what somebody with no staff record is pinned to, because
 * MyJKKN only says which college a person belongs to on a staff record: without
 * one, a librarian or assistant librarian grant resolved to no college at all
 * and the person was refused at the door. Super Admin and Library Admin span
 * every college, so for those two it is neither needed nor read.
 *
 * STOCK CHECK HELPERS
 *
 * `stock_check` is not a MyJKKN role and is not a role in this library either.
 * It is the one kind of grant written for somebody who is not library staff at
 * all — a few learners helping count the shelves for a week. It works like an
 * assistant librarian's grant in one respect only, that their college is where
 * they scan; everything else is closed. One page opens, Stock Check, and the
 * only thing they can write is a scan in a round somebody else started. The
 * college is REQUIRED on this kind of grant: there is no staff record behind it
 * to fall back on, and a helper with no college could reach nothing anyway.
 *
 * They still sign in exactly like everybody else — Google, through MyJKKN, with
 * MyJKKN proving who they are and their MyJKKN account having to be live. This
 * list only answers what MyJKKN could not: that this address is expected, until
 * this date, at this college, for this one job.
 */

import { createHash } from 'crypto'
import { getSupabaseServer } from '@/lib/supabase-server'
import { LIBRARY_ROLES, normaliseRoleKey, type LibraryRole } from './library-roles'

export interface AccessGrant {
	email: string
	role: LibraryRole
	/** The college code they are pinned to, when the grant names one. */
	collegeCode: string | null
	/**
	 * A stock check helper: this one page, this one college, nothing else.
	 * See the note at the top of this file.
	 */
	scanOnly: boolean
	/** The last day it works, as written: 'YYYY-MM-DD'. */
	expiresOn: string
	/** End of that day, UTC. */
	expiresAt: number
}

/**
 * The role word that means "a stock check helper, and nothing more".
 *
 * Not a library role and not a MyJKKN one — it is only ever written in the
 * grant list, and it is turned into the lowest real role plus a short list of
 * what that person may reach.
 */
const STOCK_CHECK_GRANT = 'stock_check'

/** The only page a stock check helper may open. */
export const STOCK_CHECK_PAGES = ['/registry/stock-check']

/**
 * What a limited helper's requests may reach.
 *
 * Their page is closed by the page guard; this is the same answer for the API,
 * because a page being hidden has never been the same thing as a route being
 * shut. Read what the Stock Check screen reads, write one thing — a scan —
 * and nothing else: they cannot start or close a round, and no other module
 * answers them at all.
 */
export function limitedHelperAllows(method: string, pathname: string): boolean {
	const verb = (method || 'GET').toUpperCase()

	if (verb === 'GET') {
		return pathname.startsWith('/api/lib/stock')
			|| pathname === '/api/lib/institutions'
			|| pathname.startsWith('/api/lib/access/me')
	}

	if (verb === 'POST') {
		// The scan itself, and the activity log every page writes on its way in
		return pathname === '/api/lib/stock/scan' || pathname.startsWith('/api/lib/logs')
	}

	return false
}

/** Said to a helper who asked for something outside their one job. */
export const LIMITED_HELPER_MESSAGE =
	'Your temporary access covers the Stock Check page only'

/**
 * The grant list, parsed once.
 *
 * Read at module load because the environment cannot change under a running
 * server: editing it in Vercel redeploys, which starts a new one.
 */
let parsed: Map<string, AccessGrant> | null = null

function parseGrants(): Map<string, AccessGrant> {
	const grants = new Map<string, AccessGrant>()
	const raw = (process.env.LIBRARY_ACCESS_GRANTS || '').trim()
	if (!raw) return grants

	for (const entry of raw.split(',')) {
		const line = entry.trim()
		if (!line) continue

		// Three parts is the original format, four names the college in between.
		// The date is always last, so which shape this is can be read off the
		// count rather than guessed from the contents.
		const parts = line.split(':').map(p => (p ?? '').trim())
		const [emailPart, rolePart] = parts
		const collegePart = parts.length >= 4 ? parts[2] : ''
		const datePart = parts.length >= 4 ? parts[3] : parts[2]

		const email = (emailPart || '').toLowerCase()
		if (!email.includes('@')) {
			console.warn(`[access-grant] ignored "${line}" — no email address`)
			continue
		}

		const asked = normaliseRoleKey(rolePart)
		const scanOnly = asked === STOCK_CHECK_GRANT

		// A helper is given the lowest real role and then shut in to one page.
		// The role is still a real one because everything downstream — the
		// institution scope, the API guard, the activity log — is written in
		// terms of the four, and inventing a fifth would mean every one of them
		// learning about it.
		const role = (scanOnly ? 'assistant_librarian' : asked) as LibraryRole
		if (!(LIBRARY_ROLES as readonly string[]).includes(role)) {
			console.warn(`[access-grant] ignored ${email} — "${rolePart}" is not a library role`)
			continue
		}

		const collegeCode = (collegePart || '').toUpperCase() || null

		// A helper has no staff record behind them, so nothing else can say where
		// they are. Without the college they would be refused at the door anyway;
		// refused here instead, where the reason is written down.
		if (scanOnly && !collegeCode) {
			console.warn(`[access-grant] ignored ${email} — a ${STOCK_CHECK_GRANT} grant must name a college, e.g. ${email}:${STOCK_CHECK_GRANT}:CNR:2026-10-20`)
			continue
		}

		if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart || '')) {
			// An entry with no end date is refused rather than treated as
			// permanent: forgetting the date is exactly how a grant meant for an
			// afternoon is still open a year later.
			console.warn(
				`[access-grant] ignored ${email} — ${datePart ? `"${datePart}"` : 'no expiry date'} is not a date (YYYY-MM-DD)`
			)
			continue
		}

		// The whole of the named day, so a grant written for the 25th still works
		// on the evening of the 25th wherever the server happens to be running
		const expiresAt = Date.parse(`${datePart}T23:59:59.999Z`)
		if (Number.isNaN(expiresAt)) {
			console.warn(`[access-grant] ignored ${email} — "${datePart}" is not a real date`)
			continue
		}

		grants.set(email, { email, role, collegeCode, scanOnly, expiresOn: datePart, expiresAt })
	}

	if (grants.size > 0) {
		console.warn(
			`[access-grant] ${grants.size} temporary grant${grants.size === 1 ? '' : 's'} in force: ` +
			[...grants.values()]
				.map(g => `${g.email} → ${g.scanOnly ? 'stock check helper' : g.role}${g.collegeCode ? ` at ${g.collegeCode}` : ''} until ${g.expiresOn}`)
				.join('; ')
		)
	}

	return grants
}

function allGrants(): Map<string, AccessGrant> {
	if (!parsed) parsed = parseGrants()
	return parsed
}

// ── Stock check helpers, from the database ──────────────────────────────────
//
// The one kind of grant a super admin adds from a screen rather than from
// Vercel. Everything else in this file still comes from the environment, and
// deliberately so: the screen can only be opened by somebody who already holds
// super_admin, so putting the last super_admin grant behind it is how a library
// locks itself out.

/** See supabase/migrations/20261022_lib_stock_check_helpers.sql. */
const HELPERS_TABLE = 'lib_stock_check_helpers'

/** What Postgres and PostgREST say when the migration has not been run. */
const NO_TABLE = new Set(['42P01', 'PGRST205', '42703'])

interface HelperRow {
	email: string | null
	expires_on: string | null
	institution: { institution_code: string | null } | { institution_code: string | null }[] | null
}

/**
 * Held for half a minute.
 *
 * This is asked on the way in to every request from somebody MyJKKN gave no
 * library role, so it cannot be a database round trip each time. Half a minute
 * is short enough that a helper added on the Stock Check page is working before
 * anybody has finished telling them to try signing in again.
 */
const HELPER_CACHE_MS = 30_000
let helperCache: { at: number; byEmail: Map<string, AccessGrant> } | null = null

/** Forget the cached list — called by the route that has just changed it. */
export function forgetStockHelpers(): void {
	helperCache = null
}

/**
 * Every helper whose last day has not passed, by email.
 *
 * A missing table is not an error here. Migrations in this project are run by
 * hand and can sit for weeks, and a migration nobody has run yet must never be
 * the reason somebody cannot sign in — so the answer is simply that there are
 * no helpers, which until the table exists is true.
 */
async function liveHelpers(): Promise<Map<string, AccessGrant>> {
	if (helperCache && Date.now() - helperCache.at < HELPER_CACHE_MS) return helperCache.byEmail

	const byEmail = new Map<string, AccessGrant>()
	try {
		const { data, error } = await getSupabaseServer()
			.from(HELPERS_TABLE)
			.select('email, expires_on, institution:institutions(institution_code)')

		if (error) {
			if (!NO_TABLE.has((error as { code?: string }).code ?? '')) {
				console.warn('[access-grant] could not read stock check helpers:', error.message)
			}
			helperCache = { at: Date.now(), byEmail }
			return byEmail
		}

		for (const row of (data ?? []) as unknown as HelperRow[]) {
			const email = (row.email ?? '').trim().toLowerCase()
			// Supabase types a nested one-to-one join as an array, so it is read
			// back through both shapes rather than fought with.
			const joined = Array.isArray(row.institution) ? row.institution[0] : row.institution
			// Kept as the college CODE, because that is what the rest of this file
			// deals in and what the access check turns back into an id.
			const collegeCode = (joined?.institution_code ?? '').toUpperCase() || null
			if (!email || !collegeCode || !row.expires_on) continue

			// The whole of the named day, read exactly as a grant written in the
			// environment is read, so the two lists lapse the same way.
			const expiresAt = Date.parse(`${row.expires_on}T23:59:59.999Z`)
			if (Number.isNaN(expiresAt) || expiresAt < Date.now()) continue

			byEmail.set(email, {
				email,
				// The lowest real role, then shut in to one page — the same shape a
				// stock_check line in the environment is turned into above.
				role: 'assistant_librarian' as LibraryRole,
				collegeCode,
				scanOnly: true,
				expiresOn: row.expires_on,
				expiresAt,
			})
		}
	} catch (err) {
		console.warn('[access-grant] stock check helpers unavailable:', err)
	}

	helperCache = { at: Date.now(), byEmail }
	return helperCache.byEmail
}

/**
 * The grant for this email, if there is one and it has not lapsed.
 *
 * Two lists, in this order. The environment first — every real library role
 * lives there and it is already in memory. Then the stock check helpers in the
 * database, which is the only list a screen can add to.
 */
export async function grantFor(email: string | null | undefined): Promise<AccessGrant | null> {
	const key = (email ?? '').trim().toLowerCase()
	if (!key) return null

	const grant = allGrants().get(key)
	if (grant && grant.expiresAt >= Date.now()) return grant

	return (await liveHelpers()).get(key) ?? null
}

/**
 * Every grant, lapsed ones included.
 *
 * The Staff Access screen shows these alongside the MyJKKN staff who hold a
 * library role, because two people with super_admin that the access screen does
 * not mention is precisely the kind of thing nobody discovers until it matters.
 */
export function listGrants(): (AccessGrant & { isExpired: boolean })[] {
	const now = Date.now()
	return [...allGrants().values()]
		.map(g => ({ ...g, isExpired: g.expiresAt < now }))
		.sort((a, b) => a.email.localeCompare(b.email))
}

/** True when any grant is configured at all. */
export function hasGrants(): boolean {
	return allGrants().size > 0
}

/**
 * A stable id for somebody who has no MyJKKN staff record.
 *
 * Everything in this project is filed under a UUID — favourites, the activity
 * log, the impersonation trail all declare `user_id uuid` — so a granted person
 * needs one too, or the first page they starred would fail on a type error.
 *
 * Derived from their email rather than generated, so it is the same id on every
 * request and after every restart: their starred pages and their activity are
 * still theirs tomorrow. This is RFC 4122 version 5 — the standard "name to
 * UUID" hash — so it cannot collide with a real MyJKKN id in any practical
 * sense, and it is not reversible into an address by looking at it.
 */
export function idForGrantedEmail(email: string): string {
	// The RFC's own DNS namespace. Any fixed namespace works; what matters is
	// that it never changes, because the id must not move under an existing row.
	const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

	const bytes = createHash('sha1')
		.update(Buffer.concat([
			Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex'),
			Buffer.from(email.trim().toLowerCase(), 'utf8'),
		]))
		.digest()

	const uuid = Buffer.from(bytes.subarray(0, 16))
	uuid[6] = (uuid[6] & 0x0f) | 0x50 // version 5
	uuid[8] = (uuid[8] & 0x3f) | 0x80 // RFC 4122 variant

	const hex = uuid.toString('hex')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
