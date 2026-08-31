/**
 * Department libraries, from the browser's side.
 *
 * Every function here unwraps whatever envelope its route replies with and
 * hands the page a plain array or object. That is deliberate: a route that
 * returns `{ data, total }` and a page that treats it as a list is exactly the
 * mismatch that used to take the whole application down to a bare error page,
 * and it failed only when the request SUCCEEDED.
 */

import type {
	DepartmentRow,
	DepartmentLibrary,
	DepartmentBook,
	TransferCandidate,
	DepartmentTransfer,
	InchargeCandidate,
} from '@/types/lib-departments'

async function fail(res: Response, fallback: string): Promise<never> {
	const body = await res.json().catch(() => ({}))
	throw new Error(body.error || fallback)
}

/** Every department this college has in MyJKKN, with its library where one exists. */
export async function fetchDepartments(institutionId: string): Promise<{
	departments: DepartmentRow[]
	librariesOpen: number
}> {
	const res = await fetch(`/api/lib/departments?institution_id=${encodeURIComponent(institutionId)}`)
	if (!res.ok) await fail(res, 'Failed to load departments')

	const body = await res.json()
	return {
		departments: Array.isArray(body?.departments) ? body.departments : [],
		librariesOpen: Number(body?.libraries_open ?? 0),
	}
}

/** Opens a library for one department. */
export async function openDepartmentLibrary(payload: {
	institution_id: string
	myjkkn_department_id: string
	is_lendable?: boolean
	incharge_myjkkn_id?: string
	incharge_name?: string
	incharge_designation?: string
	incharge_email?: string
}): Promise<DepartmentLibrary> {
	const res = await fetch('/api/lib/departments', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	if (!res.ok) await fail(res, 'Failed to open the department library')
	return res.json()
}

/** Changes the in-charge, the default rule, or whether the library is open. */
export async function updateDepartmentLibrary(payload: {
	id: string
	is_lendable?: boolean
	is_active?: boolean
	incharge_myjkkn_id?: string | null
	incharge_name?: string | null
	incharge_designation?: string | null
	incharge_email?: string | null
}): Promise<DepartmentLibrary> {
	const res = await fetch('/api/lib/departments', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	if (!res.ok) await fail(res, 'Failed to save the change')
	return res.json()
}

/** Closes a department library. Refused while books are still there. */
export async function closeDepartmentLibrary(id: string): Promise<void> {
	const res = await fetch(`/api/lib/departments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
	if (!res.ok) await fail(res, 'Failed to close the department library')
}

/** What sits in one department right now. */
export async function fetchDepartmentBooks(locationId: string): Promise<{
	books: DepartmentBook[]
	departmentName: string | null
	defaultLendable: boolean
}> {
	const res = await fetch(`/api/lib/departments/books?location_id=${encodeURIComponent(locationId)}`)
	if (!res.ok) await fail(res, 'Failed to load the books')

	const body = await res.json()
	return {
		books: Array.isArray(body?.data) ? body.data : [],
		departmentName: body?.department_name ?? null,
		defaultLendable: body?.default_lendable === true,
	}
}

/**
 * Copies in the main library that can be sent out.
 *
 * With no search this is the college's shelf, a page at a time — the screen
 * shows what is there rather than making somebody guess a title first. With a
 * search it is the matches, in one go.
 */
export async function fetchTransferCandidates(
	locationId: string,
	options: { search?: string; page?: number } = {}
): Promise<{
	candidates: TransferCandidate[]
	total: number
	hasMore: boolean
	truncated: boolean
}> {
	const params = new URLSearchParams({ location_id: locationId, available: '1' })
	if (options.search) params.set('search', options.search)
	if (options.page) params.set('page', String(options.page))

	const res = await fetch(`/api/lib/departments/books?${params}`)
	if (!res.ok) await fail(res, 'Failed to load the shelf')

	const body = await res.json()
	return {
		candidates: Array.isArray(body?.data) ? body.data : [],
		total: Number(body?.total ?? 0),
		hasMore: body?.has_more === true,
		truncated: body?.truncated === true,
	}
}

/** Turns issuing on or off for one copy — the exception the design allows for. */
export async function setBookIssuable(itemId: string, isLendable: boolean): Promise<void> {
	const res = await fetch('/api/lib/departments/books', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ item_id: itemId, is_lendable: isLendable }),
	})
	if (!res.ok) await fail(res, 'Failed to save the change')
}

/**
 * How many copies go in one request.
 *
 * The route refuses more than 200 at a time, deliberately — one request that
 * moves thousands of rows is a long lock on a table the circulation desk is
 * also using. Select all can easily pick more than that, so the work is sent in
 * batches instead of the screen refusing what it just offered.
 */
const TRANSFER_BATCH = 200

/**
 * Sends copies to a department, or brings them back to the main library.
 *
 * Batches are sent one after another rather than together: they all write to
 * the same rows of the same table, and firing them in parallel would have them
 * queue behind each other in the database anyway, with the added risk of a
 * partial failure being harder to report.
 */
export async function transferBooks(payload: {
	location_id: string
	item_ids: string[]
	direction: 'to_department' | 'to_main'
	remarks?: string
}): Promise<{
	moved: number
	refused: { accession_number: string; why: string }[]
	reference_only: boolean
}> {
	const batches: string[][] = []
	for (let at = 0; at < payload.item_ids.length; at += TRANSFER_BATCH) {
		batches.push(payload.item_ids.slice(at, at + TRANSFER_BATCH))
	}

	let moved = 0
	let referenceOnly = false
	const refused: { accession_number: string; why: string }[] = []

	for (const [index, item_ids] of batches.entries()) {
		const res = await fetch('/api/lib/departments/transfer', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...payload, item_ids }),
		})

		const body = await res.json().catch(() => ({}))

		if (!res.ok) {
			// A later batch failing does not undo the ones already moved, and
			// pretending otherwise would send somebody looking for books that are
			// already on the department shelf. So the count so far is reported.
			if (moved > 0) {
				throw new Error(
					`${moved} book${moved === 1 ? '' : 's'} moved, then it stopped: ${body.error || 'the rest could not be moved'}`
				)
			}
			throw new Error(body.error || 'Failed to move the books')
		}

		moved += Number(body?.moved ?? 0)
		if (Array.isArray(body?.refused)) refused.push(...body.refused)
		if (index === 0) referenceOnly = body?.reference_only === true
	}

	return { moved, refused, reference_only: referenceOnly }
}

/** What has moved in and out of this department. */
export async function fetchTransferHistory(locationId: string): Promise<DepartmentTransfer[]> {
	const res = await fetch(
		`/api/lib/departments/transfer?location_id=${encodeURIComponent(locationId)}`
	)
	if (!res.ok) await fail(res, 'Failed to load the transfer history')

	const body = await res.json()
	return Array.isArray(body?.data) ? body.data : []
}

/**
 * People who could be put in charge of a department library.
 *
 * The members route already answers this — everyone Active and TEACHING in this
 * college, which is exactly the pool an in-charge comes from: HOD, facilitator,
 * principal. Reusing it means the list can never disagree with the Members
 * page, and no second definition of "staff" is written anywhere.
 */
export async function searchIncharge(
	institutionId: string,
	search: string
): Promise<InchargeCandidate[]> {
	const params = new URLSearchParams({
		institution_id: institutionId,
		member_category: 'facilitator',
		search,
	})
	const res = await fetch(`/api/lib/members?${params}`)
	if (!res.ok) await fail(res, 'Failed to search staff')

	const body = await res.json()
	const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []

	return rows.slice(0, 40).map((row: any) => ({
		myjkkn_id: String(row.myjkkn_id ?? ''),
		display_name: String(row.display_name ?? 'Unnamed'),
		member_number: String(row.member_number ?? ''),
		role_label: String(row.role_label ?? ''),
		email: row.email ?? null,
		photo_url: row.photo_url ?? null,
	}))
}
