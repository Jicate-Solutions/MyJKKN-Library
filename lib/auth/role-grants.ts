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
 *   LIBRARY_ACCESS_GRANTS="email:role:YYYY-MM-DD,email:role:YYYY-MM-DD"
 *
 * for example
 *
 *   LIBRARY_ACCESS_GRANTS="director@jkkn.ac.in:super_admin:2026-09-25"
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
 */

import { createHash } from 'crypto'
import { LIBRARY_ROLES, normaliseRoleKey, type LibraryRole } from './library-roles'

export interface AccessGrant {
	email: string
	role: LibraryRole
	/** The last day it works, as written: 'YYYY-MM-DD'. */
	expiresOn: string
	/** End of that day, UTC. */
	expiresAt: number
}

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

		const [emailPart, rolePart, datePart] = line.split(':').map(p => (p ?? '').trim())

		const email = (emailPart || '').toLowerCase()
		if (!email.includes('@')) {
			console.warn(`[access-grant] ignored "${line}" — no email address`)
			continue
		}

		const role = normaliseRoleKey(rolePart) as LibraryRole
		if (!(LIBRARY_ROLES as readonly string[]).includes(role)) {
			console.warn(`[access-grant] ignored ${email} — "${rolePart}" is not a library role`)
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

		grants.set(email, { email, role, expiresOn: datePart, expiresAt })
	}

	if (grants.size > 0) {
		console.warn(
			`[access-grant] ${grants.size} temporary grant${grants.size === 1 ? '' : 's'} in force: ` +
			[...grants.values()].map(g => `${g.email} → ${g.role} until ${g.expiresOn}`).join('; ')
		)
	}

	return grants
}

function allGrants(): Map<string, AccessGrant> {
	if (!parsed) parsed = parseGrants()
	return parsed
}

/** The grant for this email, if there is one and it has not lapsed. */
export function grantFor(email: string | null | undefined): AccessGrant | null {
	const key = (email ?? '').trim().toLowerCase()
	if (!key) return null

	const grant = allGrants().get(key)
	if (!grant) return null
	if (grant.expiresAt < Date.now()) return null

	return grant
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
