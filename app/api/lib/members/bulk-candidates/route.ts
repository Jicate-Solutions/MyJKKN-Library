/**
 * Who could be enrolled in bulk: GET /api/lib/members/bulk-candidates
 *
 * The Bulk tab of Add Member asks this one question — "show me this
 * department's or this program's learners, and tell me which of them can be
 * enrolled" — and gets back everything it needs to draw the list: the
 * department and program dropdowns, the learners themselves, each one's batch
 * dates, and the reason any of them cannot be ticked.
 *
 * All of it is assembled here rather than in the browser because MyJKKN needs
 * several calls (programs, departments, learners per program, a batch each) and
 * because who is already a member is a question only this database can answer.
 *
 * Query: institution_id (required), department_id, program_id — the last two
 * are MyJKKN ids. With neither, only the dropdown lists come back, which is
 * what the tab needs when it first opens.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'

const MYJKKN_API_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''
const FETCH_TIMEOUT_MS = 20000
const PAGE_SIZE = 200
const MAX_PAGES = 30

interface MyJKKNRow { [key: string]: any }

async function myjkknGet(path: string): Promise<MyJKKNRow[]> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const res = await fetch(`${MYJKKN_API_URL}${path}`, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${MYJKKN_API_KEY}`,
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			cache: 'no-store',
			signal: controller.signal,
		})
		if (!res.ok) return []
		const payload = await res.json()
		const data = payload?.data ?? payload
		return Array.isArray(data) ? data : data ? [data] : []
	} catch {
		return []
	} finally {
		clearTimeout(timeout)
	}
}

/** One MyJKKN record by id, or null. */
async function myjkknGetOne(path: string): Promise<MyJKKNRow | null> {
	const rows = await myjkknGet(path)
	return rows[0] ?? null
}

/**
 * Every learner of one program.
 *
 * MyJKKN honours `program_id` but reports no page count, so pages are walked
 * until one comes back short — asking for a fixed number of pages would either
 * miss learners or waste calls.
 */
async function learnersOfProgram(programId: string): Promise<MyJKKNRow[]> {
	const rows: MyJKKNRow[] = []
	for (let page = 1; page <= MAX_PAGES; page++) {
		const batch = await myjkknGet(
			`/api-management/learners/profiles?program_id=${encodeURIComponent(programId)}&limit=${PAGE_SIZE}&page=${page}`
		)
		rows.push(...batch)
		if (batch.length < PAGE_SIZE) break
	}
	return rows
}

const text = (value: unknown): string => (value ?? '').toString().trim()

/** MyJKKN writes "NOT APPLICABLE" and friends where a roll number is missing. */
const PLACEHOLDERS = new Set(['not applicable', 'na', 'n/a', 'nil', 'none', '-', '--'])

function rollNumberOf(learner: MyJKKNRow): string | null {
	const value = text(learner.roll_number) || text(learner.register_number)
	if (!value || PLACEHOLDERS.has(value.toLowerCase())) return null
	return value
}

const dayOnly = (value: unknown): string | null => {
	const value_ = text(value)
	return value_ ? value_.split('T')[0] : null
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json(
				{ error: 'Choose a college first — bulk enrolment works one library at a time' },
				{ status: 400 }
			)
		}
		if (!MYJKKN_API_KEY) {
			return NextResponse.json({ error: 'MYJKKN_API_KEY not configured' }, { status: 500 })
		}

		const supabase = getSupabaseServer()

		// Which MyJKKN institutions this college is — read from the database, never
		// taken from the request, so one library can never list another's learners.
		const { data: institution } = await supabase
			.from('institutions')
			.select('myjkkn_institution_ids')
			.eq('id', institutionId)
			.maybeSingle()

		const myjkknIds: string[] = institution?.myjkkn_institution_ids ?? []
		if (myjkknIds.length === 0) {
			return NextResponse.json({
				departments: [],
				programs: [],
				staff_categories: [],
				candidates: [],
				total: 0,
				note: 'This college is not linked to MyJKKN yet',
			})
		}

		// Departments and programs, as MyJKKN has them for this college
		const departments: MyJKKNRow[] = []
		const programs: MyJKKNRow[] = []
		for (const myjkknId of myjkknIds) {
			const [depts, progs] = await Promise.all([
				myjkknGet(`/api-management/organizations/departments?institution_id=${myjkknId}&limit=${PAGE_SIZE}`),
				myjkknGet(`/api-management/organizations/programs?institution_id=${myjkknId}&limit=${PAGE_SIZE}`),
			])
			// The endpoints filter properly, but the check costs nothing and a
			// stray record from another campus would be a serious mistake here.
			//
			// Retired programs and departments are left out — MyJKKN's own screens
			// hide them, and a librarian offered "MPHARM (Pharmacognosy)" when the
			// college stopped running it would rightly think the list is wrong.
			departments.push(...depts.filter(d => myjkknIds.includes(d.institution_id) && d.is_active !== false))
			programs.push(...progs.filter(p => myjkknIds.includes(p.institution_id) && p.is_active !== false))
		}

		const departmentList = departments
			.map(d => ({ id: d.id as string, code: text(d.department_code), name: text(d.department_name) || text(d.department_code) }))
			.sort((a, b) => a.name.localeCompare(b.name))

		const programList = programs
			.map(p => ({
				id: p.id as string,
				code: text(p.program_id) || text(p.program_code),
				name: text(p.program_name) || text(p.program_id),
				department_id: (p.department_id ?? p.department?.id ?? null) as string | null,
			}))
			.sort((a, b) => a.name.localeCompare(b.name))

		const departmentFilter = searchParams.get('department_id')
		const programFilter = searchParams.get('program_id')
		const categoryFilter = searchParams.get('staff_category_id')
		const kind = searchParams.get('category') === 'facilitator' ? 'facilitator' : 'learner'

		// ── Facilitators ────────────────────────────────────────────────
		// Staff are a shorter, flatter list than learners: no program, no batch,
		// and few enough that a college's whole roll fits in one read. They are
		// grouped by the category MyJKKN files them under — Teaching, Library,
		// Lab Assistant — because that is how a librarian thinks of them.
		if (kind === 'facilitator') {
			const staffRows: MyJKKNRow[] = []
			const seenStaff = new Set<string>()
			for (const myjkknId of myjkknIds) {
				for (let page = 1; page <= MAX_PAGES; page++) {
					const rows = await myjkknGet(
						`/api-management/staff?institution_id=${myjkknId}&limit=${PAGE_SIZE}&page=${page}`
					)
					for (const row of rows) {
						if (!row?.id || seenStaff.has(row.id)) continue
						if (row.institution_id && !myjkknIds.includes(row.institution_id)) continue
						if (row.is_active === false) continue
						seenStaff.add(row.id)
						staffRows.push(row)
					}
					if (rows.length < PAGE_SIZE) break
				}
			}

			// The categories this college actually employs, taken from the staff
			// themselves — MyJKKN keeps no per-college category list
			const categoryMap = new Map<string, string>()
			for (const row of staffRows) {
				const id = text(row.category_id)
				const name = text(row.category?.category_name)
				if (id && name && !categoryMap.has(id)) categoryMap.set(id, name)
			}
			const staffCategories = [...categoryMap.entries()]
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name))

			const { data: staffMembers } = await supabase
				.from('lib_members')
				.select('facilitator_id, member_number')
				.eq('institution_id', institutionId)
				.not('facilitator_id', 'is', null)
				.range(0, 9999)

			const alreadyStaff = new Map(
				(staffMembers || []).map(m => [m.facilitator_id as string, m.member_number as string])
			)

			const departmentNames = new Map(departmentList.map(d => [d.id, d.name]))

			const staff = staffRows
				.filter(row => !departmentFilter || text(row.department_id) === departmentFilter)
				.filter(row => !categoryFilter || text(row.category_id) === categoryFilter)
				.map(row => {
					const enrolledAs = alreadyStaff.get(row.id)
					return {
						id: row.id as string,
						name: [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || 'Unnamed staff member',
						roll_number: text(row.staff_id) || null,
						email: text(row.institution_email) || text(row.email) || null,
						phone: text(row.phone) || null,
						program_id: null,
						// What the row says under the name: their designation and where they sit
						program_name: [text(row.designation), departmentNames.get(text(row.department_id)) ?? text(row.department?.department_name)]
							.filter(Boolean).join(' · ') || null,
						batch_id: null,
						batch_label: text(row.category?.category_name) || null,
						// Staff have no batch — the dates are typed once on the screen
						membership_start_date: null,
						membership_end_date: null,
						blocked_code: enrolledAs ? 'already_member' : null,
						blocked_reason: enrolledAs ? `Already a member (${enrolledAs})` : null,
					}
				})
				.sort((a, b) => a.name.localeCompare(b.name))

			return NextResponse.json({
				departments: departmentList,
				programs: programList,
				staff_categories: staffCategories,
				candidates: staff,
				total: staff.length,
				ready: staff.filter(s => !s.blocked_code).length,
			})
		}

		// Nothing chosen yet — the tab only needs the dropdowns
		if (!departmentFilter && !programFilter) {
			return NextResponse.json({ departments: departmentList, programs: programList, staff_categories: [], candidates: [], total: 0 })
		}

		// Which programs to read. A program named directly wins; otherwise every
		// program of the chosen department. Both are checked against this
		// college's own list, so an id from elsewhere returns nothing.
		const wanted = programFilter
			? programList.filter(p => p.id === programFilter)
			: programList.filter(p => p.department_id === departmentFilter)

		if (wanted.length === 0) {
			return NextResponse.json({ departments: departmentList, programs: programList, staff_categories: [], candidates: [], total: 0 })
		}

		const programNames = new Map(wanted.map(p => [p.id, p.name]))
		const learnerRows: MyJKKNRow[] = []
		const seenLearners = new Set<string>()

		for (const program of wanted) {
			const rows = await learnersOfProgram(program.id)
			for (const row of rows) {
				if (!row?.id || seenLearners.has(row.id)) continue
				// Only this college's learners, whatever the program list said
				if (row.institution_id && !myjkknIds.includes(row.institution_id)) continue
				seenLearners.add(row.id)
				learnerRows.push(row)
			}
		}

		// Batch dates, one call per distinct batch rather than one per learner
		const batchIds = [...new Set(learnerRows.map(r => text(r.batch_id)).filter(Boolean))]
		const batchById = new Map<string, { label: string; start: string | null; end: string | null }>()
		const BATCH_CONCURRENCY = 5
		for (let i = 0; i < batchIds.length; i += BATCH_CONCURRENCY) {
			const slice = batchIds.slice(i, i + BATCH_CONCURRENCY)
			const fetched = await Promise.all(
				slice.map(id => myjkknGetOne(`/api-management/academic/batches/${encodeURIComponent(id)}`))
			)
			slice.forEach((id, index) => {
				const batch = fetched[index]
				if (!batch) return
				batchById.set(id, {
					label: [text(batch.batch_code), text(batch.batch_year)].filter(Boolean).join(' · '),
					start: dayOnly(batch.start_date),
					end: dayOnly(batch.end_date),
				})
			})
		}

		// Who is already enrolled here. Scoped to this institution: the same
		// person may hold a membership at another JKKN library.
		const { data: members } = await supabase
			.from('lib_members')
			.select('learner_id, member_number')
			.eq('institution_id', institutionId)
			.not('learner_id', 'is', null)
			.range(0, 9999)

		const enrolled = new Map((members || []).map(m => [m.learner_id as string, m.member_number as string]))

		const learners = learnerRows.map(row => {
			const rollNumber = rollNumberOf(row)
			const batchId = text(row.batch_id)
			const batch = batchId ? batchById.get(batchId) : undefined
			const alreadyMember = enrolled.get(row.id)

			// The reasons a learner cannot go in with the rest, in the order the
			// librarian would want to hear them
			const blocked = alreadyMember
				? { code: 'already_member', reason: `Already a member (${alreadyMember})` }
				: !rollNumber
					? { code: 'no_roll_number', reason: 'No roll number in MyJKKN' }
					: !batch?.start
						? { code: 'no_batch', reason: 'No batch dates in MyJKKN — add from the Individual tab' }
						: null

			return {
				id: row.id as string,
				name: [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || rollNumber || 'Unnamed learner',
				roll_number: rollNumber,
				email: text(row.college_email) || text(row.student_email) || null,
				phone: text(row.student_mobile) || null,
				program_id: text(row.program_id) || null,
				program_name: programNames.get(text(row.program_id)) ?? null,
				batch_id: batchId || null,
				batch_label: batch?.label ?? null,
				membership_start_date: batch?.start ?? null,
				membership_end_date: batch?.end ?? null,
				blocked_code: blocked?.code ?? null,
				blocked_reason: blocked?.reason ?? null,
			}
		})

		learners.sort((a, b) => a.name.localeCompare(b.name))

		return NextResponse.json({
			departments: departmentList,
			programs: programList,
			staff_categories: [],
			candidates: learners,
			total: learners.length,
			ready: learners.filter(l => !l.blocked_code).length,
		})
	} catch (error) {
		console.error('Unexpected error listing bulk candidates:', error)
		return NextResponse.json({ error: 'Failed to load learners from MyJKKN' }, { status: 500 })
	}
}
