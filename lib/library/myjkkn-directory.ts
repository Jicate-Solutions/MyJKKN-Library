/**
 * Who a college's library members are — read from MyJKKN, never stored here.
 *
 * The rule this file exists to keep: every Active learner and every Active
 * TEACHING staff member in MyJKKN is a member of their own college's library,
 * and nobody else is. There is no roll to enrol into, nothing to keep in step,
 * and no learner or staff record of any kind in this project's database. The
 * role a person holds is the role MyJKKN gives them; this library does not set
 * a second one.
 *
 * Teaching is MyJKKN's own answer, not a list of job titles kept here: every
 * staff category carries an `is_teaching` flag, and that flag alone decides it.
 * So Teaching, Facilitator and Principal are members, while Ayaah, Attender,
 * Admin Office, Maintenance and the rest are not — and a category added in
 * MyJKKN tomorrow lands on the right side without a change here.
 *
 * A college is only ever asked about its own people. Which MyJKKN institutions
 * a college covers is read from our `institutions` table — never from the
 * request — and every record that comes back is checked against that list
 * again before it is used. One college can therefore not see another's.
 *
 * Two ways in, for two different needs:
 *
 *   * `collegeDirectory` — the whole college, for the Members page and the
 *     counts on the dashboard. Several paginated calls to MyJKKN, so the
 *     answer is held briefly and shared. Nothing is written to Supabase.
 *   * `personByCardNumber` / `personByMyjkknId` — one person, for the desk and
 *     the gate. Answered from the roll where it is in hand; a staff member can
 *     also be asked for directly, and a person already identified once is
 *     re-checked by their MyJKKN id in a single call.
 *
 * Field names here follow what MyJKKN actually returns (see
 * `Reference_Documents/learners-staff-api-reference-data.md`), which is not the
 * same for the two:
 *
 *   * A learner is active when `lifecycle_status` is 'active'. There is no
 *     `is_active` on a learner at all.
 *   * A staff member is active when `is_active` is true, and carries an
 *     explicit `role` object — that is the role this library uses. Their
 *     `category` object says whether they teach.
 *   * Most learners have no `roll_number`. Their `application_id` is always
 *     there, so it stands in as the number they are found by.
 */

import { getSupabaseServer } from '@/lib/supabase-server'

const MYJKKN_API_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
/** No fallback written here: this repository is public. */
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''

const PAGE_SIZE = 200
/**
 * A ceiling, not a plan. The learner endpoint reports its own total, so only
 * the pages that exist are ever asked for; this is here so a broken envelope
 * cannot spin forever. It used to be 40, which is 8,000 people — close enough
 * to the 4,945 MyJKKN holds today that growth would have silently cut the roll
 * short, and a learner who was simply never fetched looks exactly like one who
 * does not exist.
 */
const MAX_PAGES = 200

/**
 * Pages read at once.
 *
 * The roll is 25 pages of learners and 5 of staff. Read one after another that
 * is 7.4 seconds of a librarian standing at the counter; read four at a time it
 * is 2.6. Four is the same width that proved fastest against Supabase — wider
 * batches stopped paying and started being throttled.
 */
const PARALLEL_PAGES = 4

/** A whole college is many calls; one person is one. They get different budgets. */
const LIST_TIMEOUT_MS = 20_000
const ONE_TIMEOUT_MS = 5_000

/**
 * How long a college's roll is reused before it is read again.
 *
 * Nothing is stored — this is memory in the running server, gone on restart.
 * It exists because building a college's roll is several calls to the slowest
 * service we depend on, and the dashboard, the members list and the reports
 * would otherwise each pay for it. Somebody enrolled in MyJKKN appears here
 * within this window at worst, and immediately at the desk and the gate, which
 * fall through to a live lookup when the roll does not have them.
 */
const DIRECTORY_TTL_MS = 5 * 60 * 1000

/** A college MyJKKN had nothing for is re-asked sooner. */
const EMPTY_TTL_MS = 60 * 1000

/** One person, as every library screen needs them. */
export interface DirectoryPerson {
	/** MyJKKN's id for this person. The identity everything else hangs off. */
	myjkkn_id: string
	person_kind: 'learner' | 'facilitator'
	/**
	 * The number the desk scans or types. A learner's roll number where MyJKKN
	 * has one, their application id where it does not; a staff member's staff
	 * id. Empty when MyJKKN has given them no number at all — they are still a
	 * member and still listed, but there is nothing yet to scan.
	 */
	member_number: string
	/** Matched against lib_member_categories.category_code for the loan rules. */
	member_category: 'learner' | 'facilitator'
	display_name: string
	email: string | null
	phone: string | null
	photo_url: string | null
	/** MyJKKN's own word for what they are — their programme, or their role. */
	role_label: string
	institution_id: string
}

interface MyJKKNRow { [key: string]: any }

const text = (value: unknown): string => (value ?? '').toString().trim()

/** MyJKKN writes "NOT APPLICABLE" and friends where a number is missing. */
const PLACEHOLDERS = new Set(['not applicable', 'na', 'n/a', 'nil', 'none', '-', '--', 'null'])

function realNumber(value: string): string {
	if (!value || PLACEHOLDERS.has(value.toLowerCase())) return ''
	return value
}

/** Pulls the row array out, whichever envelope MyJKKN wrapped it in. */
function rowsOf(payload: any): MyJKKNRow[] {
	const body = payload?.data ?? payload
	if (Array.isArray(body)) return body
	if (Array.isArray(body?.data)) return body.data
	return body && typeof body === 'object' && body.id ? [body] : []
}

/** How many records the endpoint says it has in all, where it says so. */
function countOf(payload: any): number | null {
	const body = payload?.data ?? payload
	const raw = body?.count ?? payload?.count
	const total = Number(raw)
	return Number.isFinite(total) && total >= 0 ? total : null
}

/** One page, with the total the envelope reported alongside it. */
async function myjkknPage(
	path: string,
	timeoutMs: number
): Promise<{ rows: MyJKKNRow[]; total: number | null }> {
	if (!MYJKKN_API_KEY) return { rows: [], total: null }

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
		if (!res.ok) return { rows: [], total: null }
		const payload = await res.json()
		return { rows: rowsOf(payload), total: countOf(payload) }
	} catch {
		return { rows: [], total: null }
	} finally {
		clearTimeout(timeout)
	}
}

/** One GET to MyJKKN. Never throws — an unreachable MyJKKN is an empty list. */
async function myjkknGet(path: string, timeoutMs: number): Promise<MyJKKNRow[]> {
	return (await myjkknPage(path, timeoutMs)).rows
}

/**
 * Walks every page of a list.
 *
 * The first page answers two questions: what is on it, and how many records
 * there are in all. Where a total comes back, exactly the pages that exist are
 * read, four at a time — the roll used to be walked one page after another,
 * each waiting on the one before, which is most of the time a librarian spends
 * looking at nothing after typing a number.
 *
 * The staff endpoint reports no total, so there the batches keep going until a
 * short page says the list has ended. Pages requested past the end come back
 * empty, which costs a call and breaks nothing.
 */
async function myjkknPages(path: string): Promise<MyJKKNRow[]> {
	const join = path.includes('?') ? '&' : '?'
	const page = (n: number) => myjkknPage(`${path}${join}limit=${PAGE_SIZE}&page=${n}`, LIST_TIMEOUT_MS)

	const first = await page(1)
	const rows = [...first.rows]
	if (first.rows.length < PAGE_SIZE) return rows

	const lastPage = first.total !== null
		? Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES)
		: MAX_PAGES

	for (let next = 2; next <= lastPage; next += PARALLEL_PAGES) {
		const width = Math.min(PARALLEL_PAGES, lastPage - next + 1)
		const batch = await Promise.all(Array.from({ length: width }, (_, i) => page(next + i)))

		let ended = false
		for (const result of batch) {
			rows.push(...result.rows)
			if (result.rows.length < PAGE_SIZE) ended = true
		}

		// Without a reported total, a short page is the only sign the list is
		// finished. With one, the page count above is already exact.
		if (ended && first.total === null) break
	}

	return rows
}

// ── Which MyJKKN institutions a college covers ──────────────────────────────

const institutionIdCache = new Map<string, { ids: string[]; expiresAt: number }>()

/** A college's MyJKKN institutions barely change; an hour is well inside that. */
const INSTITUTION_IDS_TTL_MS = 60 * 60 * 1000

/**
 * The MyJKKN institutions this college is, from our own table.
 *
 * Read here and nowhere else, and never taken from the request — this single
 * lookup is what stops one college listing another's people.
 */
export async function myjkknInstitutionIdsFor(institutionId: string): Promise<string[]> {
	const cached = institutionIdCache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached.ids

	const supabase = getSupabaseServer()
	const { data } = await supabase
		.from('institutions')
		.select('myjkkn_institution_ids')
		.eq('id', institutionId)
		.maybeSingle()

	const ids: string[] = Array.isArray(data?.myjkkn_institution_ids) ? data.myjkkn_institution_ids : []
	institutionIdCache.set(institutionId, {
		ids,
		expiresAt: Date.now() + (ids.length > 0 ? INSTITUTION_IDS_TTL_MS : EMPTY_TTL_MS),
	})
	return ids
}

// ── Programme names, for what a learner's row says under their name ─────────

const programCache = new Map<string, { names: Map<string, string>; expiresAt: number }>()

async function programNamesFor(institutionId: string, myjkknIds: string[]): Promise<Map<string, string>> {
	const cached = programCache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached.names

	const names = new Map<string, string>()
	for (const myjkknId of myjkknIds) {
		const rows = await myjkknGet(
			`/api-management/organizations/programs?institution_id=${encodeURIComponent(myjkknId)}&limit=${PAGE_SIZE}`,
			LIST_TIMEOUT_MS
		)
		for (const row of rows) {
			const label = text(row.program_name) || text(row.program_id) || text(row.program_code)
			if (row.id && label) names.set(text(row.id), label)
		}
	}

	programCache.set(institutionId, { names, expiresAt: Date.now() + DIRECTORY_TTL_MS })
	return names
}

// ── Is this person a member at all? ─────────────────────────────────────────

/**
 * A learner is a member while MyJKKN calls them active.
 *
 * `lifecycle_status` is the field that says so — learners carry no `is_active`
 * at all, so testing for one would have quietly let everybody through.
 */
function learnerIsActive(row: MyJKKNRow): boolean {
	return text(row.lifecycle_status).toLowerCase() === 'active'
}

/** Staff do carry `is_active`, and that is the whole test. */
function staffIsActive(row: MyJKKNRow): boolean {
	return row.is_active === true
}

/**
 * Only teaching staff are members.
 *
 * MyJKKN files every staff member under a category, and the category itself
 * says whether it teaches. Reading that flag rather than matching job titles is
 * the point: there are 23 categories today and 94 spellings of a designation
 * between them, and a new one appears whenever somebody is hired into a job
 * nobody had before. A list kept here would be wrong within the month.
 *
 * So Teaching, Facilitator and Principal are members; Ayaah, Attender, Admin
 * Office, Library, Lab Assistant, Maintenance, Warden and the rest are not.
 *
 * A record with no category at all is not a member. That is the safe direction
 * — this rule says who to let in, so anything it cannot answer for stays out —
 * and it costs nothing today, as every active staff member has one.
 */
function staffIsTeaching(row: MyJKKNRow): boolean {
	return row.category?.is_teaching === true
}

/** Belongs to one of the MyJKKN institutions this college covers. */
function belongsHere(row: MyJKKNRow, myjkknIds: string[]): boolean {
	const rowInstitution = text(row.institution_id)
	// A record with no institution against it is not assumed to be ours
	return rowInstitution ? myjkknIds.includes(rowInstitution) : false
}

// ── Shaping one MyJKKN record into a member ─────────────────────────────────

/**
 * Every number a learner might be found by, best first.
 *
 * Most learners have no roll number and no register number — MyJKKN leaves
 * both null until the college assigns them — but every one of them has an
 * application id, and it is printed on what they carry. So the desk can find
 * them by any of the three.
 */
function learnerNumbers(row: MyJKKNRow): string[] {
	return [
		realNumber(text(row.roll_number)),
		realNumber(text(row.register_number)),
		realNumber(text(row.application_id)),
	].filter(Boolean)
}

function learnerToPerson(
	row: MyJKKNRow,
	institutionId: string,
	programNames: Map<string, string>
): DirectoryPerson | null {
	const id = text(row.id)
	if (!id) return null

	const name = [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ')
	const numbers = learnerNumbers(row)

	return {
		myjkkn_id: id,
		person_kind: 'learner',
		member_number: numbers[0] ?? '',
		member_category: 'learner',
		display_name: name || numbers[0] || 'Unnamed learner',
		email: text(row.college_email) || text(row.student_email) || null,
		phone: text(row.student_mobile) || null,
		photo_url: text(row.student_photo_url) || null,
		role_label: programNames.get(text(row.program_id)) || 'Learner',
		institution_id: institutionId,
	}
}

function staffToPerson(row: MyJKKNRow, institutionId: string): DirectoryPerson | null {
	const id = text(row.id)
	if (!id) return null

	const name = [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ')
	const number = realNumber(text(row.staff_id))

	return {
		myjkkn_id: id,
		person_kind: 'facilitator',
		member_number: number,
		member_category: 'facilitator',
		display_name: name || number || 'Unnamed staff member',
		email: text(row.institution_email) || text(row.email) || null,
		phone: text(row.phone) || null,
		photo_url: text(row.profile_picture) || null,
		// Their MyJKKN role, in MyJKKN's own words. This library does not set a
		// second role of its own — HOD is HOD here because it is HOD there.
		role_label: text(row.role?.role_name)
			|| text(row.designation)
			|| text(row.category?.category_name)
			|| 'Staff',
		institution_id: institutionId,
	}
}

// ── The whole college ───────────────────────────────────────────────────────

interface CachedDirectory {
	people: DirectoryPerson[]
	/** Every number each person answers to, for the desk's exact-match lookup. */
	byNumber: Map<string, DirectoryPerson>
	expiresAt: number
}

const directoryCache = new Map<string, CachedDirectory>()
const directoryInFlight = new Map<string, Promise<CachedDirectory>>()

/** Cards are typed by hand as often as they are scanned. Compare them loosely. */
const normalise = (value: string): string => value.trim().toLowerCase()

async function buildDirectory(institutionId: string): Promise<CachedDirectory> {
	const myjkknIds = await myjkknInstitutionIdsFor(institutionId)
	if (myjkknIds.length === 0) {
		return { people: [], byNumber: new Map(), expiresAt: Date.now() + EMPTY_TTL_MS }
	}

	const programNames = await programNamesFor(institutionId, myjkknIds)

	const people: DirectoryPerson[] = []
	const byNumber = new Map<string, DirectoryPerson>()
	const seen = new Set<string>()

	const remember = (person: DirectoryPerson, numbers: string[]) => {
		if (seen.has(person.myjkkn_id)) return
		seen.add(person.myjkkn_id)
		people.push(person)
		for (const number of numbers) {
			// First person to claim a number keeps it. Two people cannot share
			// one, and quietly overwriting would hand the wrong card to the desk.
			const key = normalise(number)
			if (key && !byNumber.has(key)) byNumber.set(key, person)
		}
	}

	// A college can map to more than one MyJKKN institution, and those rolls have
	// nothing to do with each other — read one after another, the second waited
	// out the whole of the first for no reason. Fetched together, the build costs
	// the slowest roll rather than the sum of them.
	const rolls = await Promise.all(myjkknIds.map(async myjkknId => {
		const [learners, staff] = await Promise.all([
			myjkknPages(`/api-management/learners/profiles?institution_id=${encodeURIComponent(myjkknId)}`),
			myjkknPages(`/api-management/staff?institution_id=${encodeURIComponent(myjkknId)}`),
		])
		return { learners, staff }
	}))

	// Recorded in the order the ids were given, not the order they came back in,
	// so which person keeps a shared card number does not depend on the network.
	for (const { learners, staff } of rolls) {
		for (const row of learners) {
			if (!learnerIsActive(row) || !belongsHere(row, myjkknIds)) continue
			const person = learnerToPerson(row, institutionId, programNames)
			if (person) remember(person, learnerNumbers(row))
		}

		for (const row of staff) {
			if (!staffIsActive(row) || !staffIsTeaching(row) || !belongsHere(row, myjkknIds)) continue
			const person = staffToPerson(row, institutionId)
			if (person) remember(person, [person.member_number].filter(Boolean))
		}
	}

	people.sort((a, b) => a.display_name.localeCompare(b.display_name))

	return {
		people,
		byNumber,
		expiresAt: Date.now() + (people.length > 0 ? DIRECTORY_TTL_MS : EMPTY_TTL_MS),
	}
}

/**
 * The college's roll, built or reused.
 *
 * Shared between callers that arrive together — a page opening the members
 * list and its scorecards at the same moment makes one trip, not two.
 */
async function directoryFor(institutionId: string): Promise<CachedDirectory> {
	const cached = directoryCache.get(institutionId)
	if (cached && cached.expiresAt > Date.now()) return cached

	const running = directoryInFlight.get(institutionId)
	if (running) return running

	const empty: CachedDirectory = { people: [], byNumber: new Map(), expiresAt: Date.now() + EMPTY_TTL_MS }

	const work = buildDirectory(institutionId)
		.catch(error => {
			console.error('[directory] Could not read the college roll from MyJKKN:', error)
			return empty
		})
		.then(built => {
			directoryCache.set(institutionId, built)
			return built
		})
		.finally(() => {
			directoryInFlight.delete(institutionId)
		})

	directoryInFlight.set(institutionId, work)
	return work
}

/** The roll only if it is already in hand. Never builds, never waits. */
function cachedDirectory(institutionId: string): CachedDirectory | null {
	const cached = directoryCache.get(institutionId)
	return cached && cached.expiresAt > Date.now() ? cached : null
}

/** Every member of one college: its Active learners and its Active staff. */
export async function collegeDirectory(institutionId: string): Promise<DirectoryPerson[]> {
	return (await directoryFor(institutionId)).people
}

/** How many people a college's library has. */
export async function collegeMemberCount(institutionId: string): Promise<number> {
	return (await directoryFor(institutionId)).people.length
}

// ── One person ──────────────────────────────────────────────────────────────

/**
 * The person whose card carries this number, in this college.
 *
 * Three steps, in this order:
 *
 *   1. The roll, if it happens to be in hand already. No network at all, so a
 *      queue of scans costs nothing once the first one has been answered.
 *   2. Otherwise ask MyJKKN about this one person. Staff only — their endpoint
 *      honours a search and answers in one call, so a teacher hired this
 *      morning is not turned away this afternoon.
 *   3. Otherwise read the college's roll and look again. Learners always come
 *      this way, because MyJKKN's learner endpoint has no search to ask.
 *
 * Step three is what a librarian meets when they open the desk and type a roll
 * number without having opened anything else first, so it is not a rare path
 * and is not treated as one: the roll is read four pages at a time, about two
 * and a half seconds for the whole college, and held for five minutes
 * afterwards. It used to be read one page after another, and the desk gave up
 * before it finished.
 */
export async function personByCardNumber(
	institutionId: string,
	cardNumber: string
): Promise<DirectoryPerson | null> {
	const wanted = normalise(cardNumber)
	if (!wanted) return null

	const inHand = cachedDirectory(institutionId)
	if (inHand) {
		const hit = inHand.byNumber.get(wanted)
		if (hit) return hit
	}

	const searched = await searchOnePerson(institutionId, cardNumber)
	if (searched) return searched

	// Already looked through this roll above and it did not have them
	if (inHand) return null

	return (await directoryFor(institutionId)).byNumber.get(wanted) ?? null
}

/**
 * Asks MyJKKN about one staff member by their number.
 *
 * Staff only, and deliberately. The staff endpoint documents `search` and
 * honours it, so one person costs one call. The learner endpoint documents no
 * search at all, and measurement on 2026-08-25 confirmed it: asking it for
 * `?search=JKKN-CNR-588` returned the same total of 4,945 and simply handed
 * back the first fifty learners in the organisation. This used to ask anyway
 * and match the number itself, which found a learner only if they happened to
 * be in that arbitrary fifty — so a roll number typed at the desk on a cold
 * server found nobody, over and over, while the same number worked once the
 * Members page had been opened.
 *
 * Learners are therefore found through the college's roll, which is what the
 * caller falls through to. Two things still decide a match and both must hold:
 * the record belongs to one of this college's institutions, and one of the
 * numbers it answers to matches whole — `PB2300` finds nobody where `PB23001`
 * finds one person.
 */
async function searchOnePerson(institutionId: string, cardNumber: string): Promise<DirectoryPerson | null> {
	const myjkknIds = await myjkknInstitutionIdsFor(institutionId)
	if (myjkknIds.length === 0) return null

	const wanted = normalise(cardNumber)
	const query = encodeURIComponent(cardNumber.trim())

	const staff = await myjkknGet(`/api-management/staff?search=${query}&limit=50`, ONE_TIMEOUT_MS)

	for (const row of staff) {
		if (!staffIsActive(row) || !staffIsTeaching(row) || !belongsHere(row, myjkknIds)) continue
		if (normalise(realNumber(text(row.staff_id))) !== wanted) continue
		return staffToPerson(row, institutionId)
	}

	return null
}

/**
 * One person by their MyJKKN id.
 *
 * Used where a card has already been read once and the request has to prove
 * the same person again before anything is written — the desk sends back who
 * it found, and this is what checks that they are still a member of this
 * college before a book leaves the building.
 */
export async function personByMyjkknId(
	institutionId: string,
	kind: 'learner' | 'facilitator',
	myjkknId: string
): Promise<DirectoryPerson | null> {
	const id = text(myjkknId)
	if (!id) return null

	// The roll if it is in hand, but never built for this — asking MyJKKN about
	// one person by id is a single call, and a book must not wait on a college.
	const inHand = cachedDirectory(institutionId)
	const hit = inHand?.people.find(p => p.myjkkn_id === id && p.person_kind === kind)
	if (hit) return hit

	const myjkknIds = await myjkknInstitutionIdsFor(institutionId)
	if (myjkknIds.length === 0) return null

	const rows = await myjkknGet(
		kind === 'learner'
			? `/api-management/learners/profiles/${encodeURIComponent(id)}`
			: `/api-management/staff/${encodeURIComponent(id)}`,
		ONE_TIMEOUT_MS
	)

	const row = rows[0]
	if (!row || !belongsHere(row, myjkknIds)) return null

	if (kind === 'learner') {
		if (!learnerIsActive(row)) return null
		const programNames = await programNamesFor(institutionId, myjkknIds)
		return learnerToPerson(row, institutionId, programNames)
	}

	if (!staffIsActive(row) || !staffIsTeaching(row)) return null
	return staffToPerson(row, institutionId)
}

/** True when MyJKKN can be reached at all — the pages say so rather than showing nothing. */
export function myjkknConfigured(): boolean {
	return MYJKKN_API_KEY.length > 0
}
