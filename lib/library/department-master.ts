/**
 * The one department list — MyJKKN's, plus the ones this library added.
 *
 * MyJKKN does not hold every department a library shelves by. Dental shelves
 * by twenty-one subjects, Arts & Science keeps a "Main Library" and a
 * "Miscellaneous" section, and none of those are MyJKKN departments. So the
 * library keeps its own rows in `lib_departments` and they sit beside MyJKKN's
 * in a single list.
 *
 * What comes from where:
 *
 *   * MyJKKN owns the departments it knows about — name, code, degree, order.
 *     They are read live on every call (cached ten minutes upstream), never
 *     copied into this database, so a rename there reaches every screen.
 *   * This library owns its own departments, and owns one switch per MyJKKN
 *     department: a `source = 'myjkkn'` row whose only meaning is `is_active`.
 *     That is how a college hides a MyJKKN department it does not shelve by
 *     without touching MyJKKN.
 *
 * Everywhere a department is offered — the Departments List page, the New Title
 * form, bulk upload and edit, the Department Libraries screen — reads this, so
 * there is one list and no second place to keep in step.
 *
 * Server side only.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import { collegeDepartments, myjkknDepartmentsConfigured } from '@/lib/library/myjkkn-departments'
import { departmentsFor } from '@/lib/library/catalogue-options'

/** One department, whichever side it came from. */
export interface MergedDepartment {
	/** A uuid either way: MyJKKN's department id, or our own row's id. */
	key: string
	source: 'myjkkn' | 'local'
	/** MyJKKN's id, on MyJKKN's departments only. */
	myjkkn_department_id: string | null
	/** Our row's id — on our departments, and on a switch against a MyJKKN one. */
	local_id: string | null
	department_code: string
	department_name: string
	display_name: string | null
	degree_name: string | null
	/** What every dropdown honours: off means it is not offered any more. */
	is_active: boolean
	/** Null for a department of ours; MyJKKN's own flag otherwise. */
	is_active_in_myjkkn: boolean | null
	sort_order: number
}

export interface DepartmentList {
	departments: MergedDepartment[]
	/** False when this server has no MyJKKN key, so only our own rows are here. */
	myjkkn_ok: boolean
	/** True when 20260923_lib_departments.sql has not been run on this database. */
	table_missing: boolean
}

/** The columns a department row is read with, everywhere in this file. */
const COLUMNS = `
	id, institution_id, source, myjkkn_department_id, department_code,
	department_name, display_name, is_active, sort_order, created_at, updated_at
`

interface LocalRow {
	id: string
	institution_id: string
	source: 'local' | 'myjkkn'
	myjkkn_department_id: string | null
	department_code: string | null
	department_name: string
	display_name: string | null
	is_active: boolean
	sort_order: number
}

/** A missing table is a migration that has not been run, not a failure. */
const isMissingTable = (code?: string) => code === '42P01' || code === 'PGRST205' || code === '42703'

/** Our own rows for this college. */
async function localRows(institutionId: string): Promise<{ rows: LocalRow[]; missing: boolean }> {
	const supabase = getSupabaseServer()
	const { data, error } = await supabase
		.from('lib_departments')
		.select(COLUMNS)
		.eq('institution_id', institutionId)
		.order('sort_order', { ascending: true })

	if (error) {
		if (isMissingTable(error.code)) return { rows: [], missing: true }
		console.error('[departments] Could not read this college\'s own departments:', error)
		return { rows: [], missing: false }
	}
	return { rows: (data ?? []) as unknown as LocalRow[], missing: false }
}

/**
 * Every department this college may file a book under, MyJKKN's and ours.
 *
 * Inactive ones are included and flagged, never dropped: a department switched
 * off today may still be written on a thousand books, and the screens that show
 * it have to be able to name it.
 */
export async function collegeDepartmentList(institutionId: string): Promise<DepartmentList> {
	const [myjkkn, local] = await Promise.all([
		collegeDepartments(institutionId),
		localRows(institutionId),
	])

	const switches = new Map(
		local.rows.filter(r => r.source === 'myjkkn' && r.myjkkn_department_id)
			.map(r => [r.myjkkn_department_id as string, r])
	)

	const departments: MergedDepartment[] = myjkkn.map(d => {
		const off = switches.get(d.id)
		return {
			key: d.id,
			source: 'myjkkn' as const,
			myjkkn_department_id: d.id,
			local_id: off?.id ?? null,
			department_code: d.department_code,
			department_name: d.department_name,
			display_name: d.display_name,
			degree_name: d.degree_name,
			// MyJKKN's own flag still counts: a department deactivated there is
			// not offered here either.
			is_active: d.is_active && (off ? off.is_active : true),
			is_active_in_myjkkn: d.is_active,
			sort_order: d.sort_order,
		}
	})

	// A department of ours that MyJKKN also has is not shown twice. MyJKKN's is
	// the one kept, because its name, code and degree are maintained there — and
	// the same name in the list twice would split one department's books between
	// two rows. The row stays in the table: if MyJKKN ever renames or drops that
	// department, ours comes back on its own.
	const fromMyjkkn = new Set(departments.map(d => d.department_name.trim().toLowerCase()))

	for (const row of local.rows) {
		if (row.source !== 'local') continue
		if (fromMyjkkn.has(row.department_name.trim().toLowerCase())) continue
		departments.push({
			key: row.id,
			source: 'local',
			myjkkn_department_id: null,
			local_id: row.id,
			department_code: row.department_code ?? '',
			department_name: row.department_name,
			display_name: row.display_name,
			degree_name: null,
			is_active: row.is_active,
			is_active_in_myjkkn: null,
			sort_order: row.sort_order,
		})
	}

	departments.sort((a, b) => a.department_name.localeCompare(b.department_name))

	return { departments, myjkkn_ok: myjkknDepartmentsConfigured(), table_missing: local.missing }
}

/**
 * The names a dropdown offers, and what a typed department is checked against.
 *
 * Falls back to the list that used to live in the code while the migration is
 * still unrun — cataloguing must not stop because a script has not been applied
 * yet, and that list is exactly what the form offered before this table.
 */
export async function activeDepartmentNames(
	institutionId: string,
	institutionCode?: string | null
): Promise<string[]> {
	const { departments, table_missing } = await collegeDepartmentList(institutionId)
	const names = departments.filter(d => d.is_active).map(d => d.department_name)
	if (table_missing) {
		for (const name of departmentsFor(institutionCode)) {
			if (!names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name)
		}
	}
	return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/**
 * Whether a typed or uploaded department is one this college offers.
 *
 * Case and surrounding spaces are ignored — a bulk sheet says "anatomy " and
 * means Anatomy. An inactive department is refused for new books while staying
 * readable on the old ones that carry it.
 */
export async function isKnownDepartment(
	institutionId: string,
	institutionCode: string | null | undefined,
	department: string
): Promise<boolean> {
	const wanted = department.trim().toLowerCase()
	if (!wanted) return false
	const names = await activeDepartmentNames(institutionId, institutionCode)
	// No list at all for this college: the form takes free text, as it always did.
	if (names.length === 0) return true
	return names.some(n => n.toLowerCase() === wanted)
}
