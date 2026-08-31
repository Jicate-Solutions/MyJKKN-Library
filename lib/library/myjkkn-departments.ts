/**
 * What departments a college has — read from MyJKKN, never stored here.
 *
 * The same rule the member roll follows: MyJKKN owns which departments exist,
 * this library owns only what sits inside them. So when Dental adds its
 * remaining five departments in MyJKKN, they appear on the Department
 * Libraries screen by themselves — no code change, no deployment, no list to
 * keep in step.
 *
 * A college is only ever asked about its own departments. Which MyJKKN
 * institutions a college covers comes from our own `institutions` table via
 * `myjkknInstitutionIdsFor`, never from the request, and every row that comes
 * back is checked against that list again before it is used. That double check
 * is what stops one college seeing another's departments — Arts (Aided) and
 * Arts (Self) sit next to each other in MyJKKN and must not mix.
 *
 * Field names follow what `GET /api-management/organizations/departments`
 * actually returns:
 *
 *   id, institution_id, department_code, department_name, display_name,
 *   is_active, department_order, head_of_department_id, degree { … }
 *
 * `head_of_department_id` is carried through but deliberately NOT used to
 * pre-fill the in-charge. MyJKKN has an HOD recorded for 7 of the 76
 * departments across the seven colleges — all seven of them at Pharmacy — so
 * defaulting to it would silently do nothing almost everywhere and look broken
 * where it did work. It is here for the day MyJKKN fills the rest in.
 */

import { myjkknInstitutionIdsFor } from './myjkkn-directory'

const MYJKKN_API_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
/** No fallback written here: this repository is public. */
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''

/**
 * All 89 departments across every institution fit in one page of 200, so this
 * is a single call. The limit is still passed in case MyJKKN's own default is
 * smaller than the list.
 */
const PAGE_SIZE = 200
const TIMEOUT_MS = 10_000

/**
 * Departments change perhaps twice a year. Ten minutes is short enough that
 * the five Dental is about to add show up while somebody is still on the
 * phone about them, and long enough that opening the screen repeatedly does
 * not go back to MyJKKN each time.
 */
const TTL_MS = 10 * 60 * 1000

/** A college MyJKKN had nothing for is re-asked sooner. */
const EMPTY_TTL_MS = 60 * 1000

/** One department, as the library needs it. */
export interface MyJKKNDepartment {
	/** MyJKKN's id. What a department library is tied to. */
	id: string
	institution_id: string
	department_code: string
	department_name: string
	/** The short form MyJKKN shows, e.g. "HAP" for Human Anatomy and Physiology. */
	display_name: string | null
	degree_name: string | null
	is_active: boolean
	sort_order: number
	/** MyJKKN's HOD for this department, offered as the default in-charge. */
	head_of_department_id: string | null
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

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const res = await fetch(`${MYJKKN_API_URL}${path}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${MYJKKN_API_KEY}`,
				Accept: 'application/json',
			},
			cache: 'no-store',
			signal: controller.signal,
		})
		if (!res.ok) return []
		return rowsOf(await res.json())
	} catch {
		return []
	} finally {
		clearTimeout(timeout)
	}
}

function toDepartment(row: MyJKKNRow): MyJKKNDepartment | null {
	const id = text(row.id)
	const institutionId = text(row.institution_id ?? row.institution?.id)
	const name = text(row.department_name ?? row.name)
	if (!id || !institutionId || !name) return null

	return {
		id,
		institution_id: institutionId,
		department_code: text(row.department_code) || id.slice(0, 8),
		department_name: name,
		display_name: text(row.display_name) || null,
		degree_name: text(row.degree?.degree_name) || null,
		is_active: row.is_active !== false,
		sort_order: Number(row.department_order ?? 0) || 0,
		head_of_department_id: text(row.head_of_department_id) || null,
	}
}

// ── Cache ───────────────────────────────────────────────────────────────────

const cache = new Map<string, { departments: MyJKKNDepartment[]; expiresAt: number }>()

/** Drops a college's cached list so the next read goes back to MyJKKN. */
export function invalidateDepartments(institutionId?: string) {
	if (institutionId) cache.delete(institutionId)
	else cache.clear()
}

/**
 * This college's departments, in the order MyJKKN sorts them.
 *
 * Inactive departments are included and flagged rather than dropped. A
 * department that MyJKKN deactivates after its library was set up must still
 * appear here, or that library — and the books in it — would vanish from the
 * screen while the books sat on the shelf.
 */
export async function collegeDepartments(institutionId: string): Promise<MyJKKNDepartment[]> {
	const cached = cache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached.departments

	const myjkknIds = await myjkknInstitutionIdsFor(institutionId)
	if (myjkknIds.length === 0) {
		cache.set(institutionId, { departments: [], expiresAt: Date.now() + EMPTY_TTL_MS })
		return []
	}

	const allowed = new Set(myjkknIds)
	const seen = new Set<string>()
	const departments: MyJKKNDepartment[] = []

	// Asked per institution so MyJKKN filters what it can, then filtered again
	// here — the server-side filter has been seen to be ignored on other
	// endpoints, and one college showing another's departments is exactly the
	// mistake this project cannot make.
	for (const myjkknId of myjkknIds) {
		const rows = await myjkknGet(
			`/api-management/organizations/departments?institution_id=${encodeURIComponent(myjkknId)}&limit=${PAGE_SIZE}&page=1`
		)

		for (const row of rows) {
			const department = toDepartment(row)
			if (!department) continue
			if (!allowed.has(department.institution_id)) continue
			if (seen.has(department.id)) continue
			seen.add(department.id)
			departments.push(department)
		}
	}

	departments.sort((a, b) =>
		a.sort_order - b.sort_order || a.department_name.localeCompare(b.department_name)
	)

	cache.set(institutionId, {
		departments,
		expiresAt: Date.now() + (departments.length > 0 ? TTL_MS : EMPTY_TTL_MS),
	})
	return departments
}

/** True when this server can reach MyJKKN at all. */
export function myjkknDepartmentsConfigured(): boolean {
	return Boolean(MYJKKN_API_KEY)
}
