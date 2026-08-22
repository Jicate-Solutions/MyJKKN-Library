/**
 * The person signing in, as MyJKKN has them.
 *
 * MyJKKN owns who someone is AND what they are. This project keeps no user
 * table of its own any more: the sign-in token proves an email address, and
 * everything else — their id, their name, their college, and every role they
 * hold — is read from their MyJKKN staff record on that basis.
 *
 * The identity that everything else hangs off is the MyJKKN staff `id`, a
 * UUID that every staff member has and that never changes. `staff_id` (AHS137)
 * is an employee code, is missing on some records, and is therefore never used
 * as an identity.
 *
 * Someone MyJKKN has no staff record for — a learner, or an address that does
 * not belong to staff at all — simply does not resolve, and the library shows
 * them the restricted page. That is the intended outcome, not an error.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import { normaliseRoleKey } from './library-roles'

const MYJKKN_API_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
/** No fallback written here: this repository is public. */
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''

const TIMEOUT_MS = 6_000
const PAGE_SIZE = 200
const MAX_PAGES = 40

/** One signed-in person. */
export interface MyjkknStaff {
	/** MyJKKN's staff UUID. The identity used everywhere in this project. */
	id: string
	email: string
	fullName: string | null
	/** The employee code, e.g. AHS137. Display only — often missing. */
	staffCode: string | null
	/**
	 * Every role key MyJKKN gives this person, flattened.
	 *
	 * Collected from every shape MyJKKN uses, because a person may hold more
	 * than one role and only one of them needs to be a library role for them to
	 * get in.
	 */
	roleKeys: string[]
	/** Their college, as MyJKKN numbers it. Mapped to ours separately. */
	myjkknInstitutionId: string | null
	isActive: boolean
}

interface MyJKKNRow { [key: string]: any }

const text = (value: unknown): string => (value ?? '').toString().trim()

/** Pulls the row array out, whichever envelope MyJKKN wrapped it in. */
function rowsOf(payload: any): MyJKKNRow[] {
	const body = payload?.data ?? payload
	if (Array.isArray(body)) return body
	if (Array.isArray(body?.data)) return body.data
	return body && typeof body === 'object' && body.id ? [body] : []
}

/** One GET to MyJKKN. Never throws — an unreachable MyJKKN is an empty list. */
async function myjkknGet(path: string): Promise<MyJKKNRow[]> {
	if (!MYJKKN_API_KEY) return []

	try {
		const res = await fetch(`${MYJKKN_API_URL}${path}`, {
			method: 'GET',
			headers: { Authorization: `Bearer ${MYJKKN_API_KEY}`, Accept: 'application/json' },
			cache: 'no-store',
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) return []
		return rowsOf(await res.json())
	} catch {
		return []
	}
}

/**
 * Every role key on one staff record.
 *
 * MyJKKN's staff API returns a single `role_key` and a single `role` object
 * today, but a person can be given more than one role, and where those extra
 * roles surface differs by endpoint. So every plausible shape is read and the
 * results are pooled: whichever field MyJKKN fills, the role is found. Only one
 * of them has to be a library role for the person to be let in.
 */
export function roleKeysOf(row: MyJKKNRow): string[] {
	const found = new Set<string>()

	const add = (value: unknown) => {
		const key = normaliseRoleKey(value)
		if (key) found.add(key)
	}

	// The single role, in both the shapes it appears in
	add(row.role_key)
	add(row.role?.role_key)
	add(row.role?.role_name)

	// Any list of roles, whatever MyJKKN happens to call it
	for (const field of ['roles', 'user_roles', 'additional_roles', 'role_keys']) {
		const list = row[field]
		if (!Array.isArray(list)) continue
		for (const entry of list) {
			if (entry && typeof entry === 'object') {
				add(entry.role_key)
				add(entry.role_name)
				add(entry.name)
				add(entry.role?.role_key)
				add(entry.role?.role_name)
			} else {
				add(entry)
			}
		}
	}

	return [...found]
}

/** Shapes one MyJKKN staff record into the person this project works with. */
function toStaff(row: MyJKKNRow, email: string): MyjkknStaff | null {
	const id = text(row.id)
	if (!id) return null

	const name = [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ')

	return {
		id,
		email: text(row.institution_email) || text(row.email) || email,
		fullName: name || null,
		staffCode: text(row.staff_id) || null,
		roleKeys: roleKeysOf(row),
		myjkknInstitutionId: text(row.institution_id) || null,
		isActive: row.is_active === true,
	}
}

const sameEmail = (a: unknown, b: string): boolean =>
	text(a).toLowerCase() === b.toLowerCase()

/**
 * How long a resolved staff record is reused.
 *
 * Every guarded route begins by identifying the caller, and a page opens
 * several at once. Without this, each would be its own trip to MyJKKN on top of
 * the token validation that already costs one. Short enough that a role changed
 * in MyJKKN takes effect within the minute.
 */
const STAFF_TTL_MS = 60_000

/** A miss is held far more briefly — just long enough to absorb one burst. */
const MISS_TTL_MS = 15_000

const MAX_CACHED = 500

const staffCache = new Map<string, { staff: MyjkknStaff | null; expiresAt: number }>()
const inFlight = new Map<string, Promise<MyjkknStaff | null>>()

function remember(key: string, staff: MyjkknStaff | null): MyjkknStaff | null {
	if (staffCache.size >= MAX_CACHED) {
		const now = Date.now()
		for (const [k, entry] of staffCache) if (entry.expiresAt <= now) staffCache.delete(k)
		if (staffCache.size >= MAX_CACHED) staffCache.clear()
	}
	staffCache.set(key, {
		staff,
		expiresAt: Date.now() + (staff ? STAFF_TTL_MS : MISS_TTL_MS),
	})
	return staff
}

/** Drops what is known about one person, or everyone. */
export function invalidateStaff(key?: string | null): void {
	if (!key) {
		staffCache.clear()
		return
	}
	staffCache.delete(`email:${key.toLowerCase()}`)
	staffCache.delete(`id:${key}`)
}

/**
 * The staff record behind one email address.
 *
 * MyJKKN's search is a contains-match, so the answer is only accepted when an
 * email on the record matches whole — a search for `a@jkkn.ac.in` must never
 * sign somebody in as `deepa@jkkn.ac.in`.
 */
async function requestByEmail(email: string): Promise<MyjkknStaff | null> {
	const rows = await myjkknGet(`/api-management/staff?search=${encodeURIComponent(email)}&limit=50`)

	const match = rows.find(row =>
		sameEmail(row.institution_email, email) || sameEmail(row.email, email)
	)

	return match ? toStaff(match, email) : null
}

export async function staffByEmail(email: string): Promise<MyjkknStaff | null> {
	const wanted = text(email).toLowerCase()
	if (!wanted || !MYJKKN_API_KEY) return null

	const key = `email:${wanted}`
	const cached = staffCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.staff

	const running = inFlight.get(key)
	if (running) return running

	const work = requestByEmail(wanted)
		.then(staff => remember(key, staff))
		.finally(() => inFlight.delete(key))

	inFlight.set(key, work)
	return work
}

/** One staff member by their MyJKKN id — used by "view as". */
export async function staffById(staffId: string): Promise<MyjkknStaff | null> {
	const id = text(staffId)
	if (!id || !MYJKKN_API_KEY) return null

	const key = `id:${id}`
	const cached = staffCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.staff

	const running = inFlight.get(key)
	if (running) return running

	const work = myjkknGet(`/api-management/staff/${encodeURIComponent(id)}`)
		.then(rows => (rows[0] ? toStaff(rows[0], '') : null))
		.then(staff => remember(key, staff))
		.finally(() => inFlight.delete(key))

	inFlight.set(key, work)
	return work
}

/**
 * Every staff member MyJKKN has, across every campus.
 *
 * Only used by the Staff Access screen, which lists who holds a library role.
 * Not cached here — that screen is opened rarely and by one person.
 */
export async function allStaff(): Promise<MyjkknStaff[]> {
	if (!MYJKKN_API_KEY) return []

	const people: MyjkknStaff[] = []
	const seen = new Set<string>()

	for (let page = 1; page <= MAX_PAGES; page++) {
		const rows = await myjkknGet(`/api-management/staff?limit=${PAGE_SIZE}&page=${page}`)
		for (const row of rows) {
			const staff = toStaff(row, '')
			if (!staff || seen.has(staff.id)) continue
			seen.add(staff.id)
			people.push(staff)
		}
		if (rows.length < PAGE_SIZE) break
	}

	return people
}

// ── Which of our colleges a MyJKKN institution is ───────────────────────────

let collegeMap: { byMyjkknId: Map<string, string>; expiresAt: number } | null = null

/** A college's MyJKKN institutions barely change; an hour is well inside that. */
const COLLEGE_MAP_TTL_MS = 60 * 60 * 1000

/**
 * Turns MyJKKN's institution id into ours.
 *
 * A staff record says which MyJKKN institution someone belongs to; every screen
 * here works in terms of our own `institutions` row. This is the one place that
 * translation happens, and it is read from our table rather than assumed.
 */
export async function collegeForMyjkknInstitution(myjkknInstitutionId: string | null): Promise<string | null> {
	if (!myjkknInstitutionId) return null

	if (!collegeMap || collegeMap.expiresAt <= Date.now()) {
		const supabase = getSupabaseServer()
		const { data } = await supabase.from('institutions').select('id, myjkkn_institution_ids')

		const byMyjkknId = new Map<string, string>()
		for (const row of data ?? []) {
			const ids: string[] = Array.isArray(row.myjkkn_institution_ids) ? row.myjkkn_institution_ids : []
			for (const id of ids) byMyjkknId.set(id, row.id as string)
		}

		collegeMap = { byMyjkknId, expiresAt: Date.now() + COLLEGE_MAP_TTL_MS }
	}

	return collegeMap.byMyjkknId.get(myjkknInstitutionId) ?? null
}

/** True when MyJKKN can be reached at all. */
export function myjkknStaffConfigured(): boolean {
	return MYJKKN_API_KEY.length > 0
}
