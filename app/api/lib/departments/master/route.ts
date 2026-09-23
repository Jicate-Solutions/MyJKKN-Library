/**
 * The departments hub: GET/POST/PUT/DELETE /api/lib/departments/master
 *
 * One list per college — MyJKKN's departments, read live, plus the ones this
 * library added. Everything that offers a department reads this: the
 * Departments List page, the New Title form, bulk upload and edit, and the
 * Department Libraries screen.
 *
 *   GET    ?institution_id=…     the merged list, inactive ones flagged
 *   POST   { department_name }   add a department of our own
 *   PUT    { id } | { myjkkn_department_id }
 *                                edit ours, or switch a MyJKKN one on or off
 *   DELETE ?id=…                 remove one of ours, refused while in use
 *
 * A MyJKKN department is never edited or deleted here — its name, code and
 * degree stay MyJKKN's, and all this side holds is whether the library offers
 * it. Writing is a librarian's job; `/api/lib/departments` is already listed in
 * lib/auth/librarian-only.ts, and this route sits under it.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecordRow } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { logActivity } from '@/lib/library/activity-log'
import { collegeDepartmentList } from '@/lib/library/department-master'
import type { MergedDepartment } from '@/lib/library/department-master'

const MIGRATION = 'supabase/migrations/20260923_lib_departments.sql'
const MISSING_TABLE = `The departments list migration has not been run on this database yet — apply ${MIGRATION}`

const isMissingTable = (code?: string) => code === '42P01' || code === 'PGRST205' || code === '42703'

/** The row a write answers with, in the shape the screen already reads. */
const COLUMNS = `
	id, institution_id, source, myjkkn_department_id, department_code,
	department_name, display_name, is_active, sort_order, created_at, updated_at
`

interface DepartmentRowLite {
	id: string
	institution_id: string | null
	source: 'local' | 'myjkkn'
	department_name: string
	is_active: boolean
}

/**
 * How many books and department libraries would be affected.
 *
 * Shown beside each department so nobody deactivates the one that 400 books
 * are filed under without knowing it, and read again before a delete.
 */
async function usageFor(institutionId: string, departments: MergedDepartment[]) {
	const supabase = getSupabaseServer()
	const books = new Map<string, number>()
	const libraries = new Map<string, boolean>()

	const [{ data: records, error: recordError }, { data: locations }] = await Promise.all([
		supabase
			.from('lib_catalogue_records')
			.select('department')
			.eq('institution_id', institutionId)
			.not('department', 'is', null)
			.range(0, 9999),
		supabase
			.from('lib_locations')
			.select('department_name, myjkkn_department_id')
			.eq('institution_id', institutionId)
			.eq('location_kind', 'department'),
	])

	// A count that cannot be read is left absent rather than shown as zero.
	if (!recordError) {
		for (const row of records ?? []) {
			const key = String((row as { department: string }).department ?? '').trim().toLowerCase()
			if (key) books.set(key, (books.get(key) ?? 0) + 1)
		}
	}
	for (const row of (locations ?? []) as { department_name: string | null; myjkkn_department_id: string | null }[]) {
		if (row.department_name) libraries.set(row.department_name.trim().toLowerCase(), true)
		if (row.myjkkn_department_id) libraries.set(row.myjkkn_department_id, true)
	}

	return departments.map(d => ({
		...d,
		title_count: books.get(d.department_name.trim().toLowerCase()) ?? 0,
		has_library: libraries.get(d.department_name.trim().toLowerCase())
			?? (d.myjkkn_department_id ? libraries.get(d.myjkkn_department_id) ?? false : false),
	}))
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		// Departments belong to one college; there is no "all colleges" answer.
		if (!guard.institutionId) {
			return NextResponse.json(
				{ error: 'Select a college first — departments belong to one college at a time' },
				{ status: 400 }
			)
		}

		const list = await collegeDepartmentList(guard.institutionId)
		const withUsage = searchParams.get('usage') === 'false'
			? list.departments.map(d => ({ ...d, title_count: 0, has_library: false }))
			: await usageFor(guard.institutionId, list.departments)

		return NextResponse.json({
			institution_id: guard.institutionId,
			departments: withUsage,
			total: withUsage.length,
			active: withUsage.filter(d => d.is_active).length,
			from_myjkkn: withUsage.filter(d => d.source === 'myjkkn').length,
			added_here: withUsage.filter(d => d.source === 'local').length,
			myjkkn_ok: list.myjkkn_ok,
			table_missing: list.table_missing,
			migration: list.table_missing ? MIGRATION : null,
		})
	} catch (error) {
		console.error('Unexpected error listing departments:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can add a department' }, { status: 403 })
		}
		if (!guard.institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const name = String(body.department_name ?? '').trim()
		if (!name) return NextResponse.json({ error: 'Give the department a name' }, { status: 400 })

		// MyJKKN already has it: adding a second copy of the same name would put
		// the department in the list twice and split its books between them.
		const existing = await collegeDepartmentList(guard.institutionId)
		if (existing.departments.some(d => d.department_name.trim().toLowerCase() === name.toLowerCase())) {
			return NextResponse.json({ error: `${name} is already in this college's list` }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_departments')
			.insert({
				institution_id: guard.institutionId,
				source: 'local',
				department_name: name,
				department_code: String(body.department_code ?? '').trim() || null,
				display_name: String(body.display_name ?? '').trim() || null,
				is_active: body.is_active !== false,
				sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
				created_by: guard.caller.fullName ?? guard.caller.email,
			})
			.select(COLUMNS)
			.single()

		if (error) {
			if (isMissingTable(error.code)) return NextResponse.json({ error: MISSING_TABLE }, { status: 503 })
			if (error.code === '23505') {
				return NextResponse.json({ error: `${name} is already in this college's list` }, { status: 400 })
			}
			console.error('Error adding a department:', error)
			return NextResponse.json({ error: 'Failed to add the department' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: guard.institutionId,
			action: 'create',
			resource_type: 'department',
			resource_id: '/departments-list',
			new_values: { department_name: name },
			metadata: { department_id: (data as { id?: string })?.id },
		})

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error adding a department:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	try {
		const body = await request.json()

		// ── Switching a MyJKKN department on or off ────────────────────────
		//
		// Nothing of MyJKKN's is edited: this writes only our own switch row,
		// whose single meaning is whether the library offers that department.
		const myjkknId = String(body.myjkkn_department_id ?? '').trim()
		if (myjkknId) {
			const guard = await guardWrite(request, body.institution_id)
			if (!guard.ok) return guard.response
			if (!hasAtLeast(guard.caller, 'librarian')) {
				return NextResponse.json({ error: 'Only library staff can change a department' }, { status: 403 })
			}
			if (!guard.institutionId) {
				return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
			}

			// The department has to be this college's own, checked against MyJKKN's
			// answer rather than the request — the id in a body proves nothing.
			const list = await collegeDepartmentList(guard.institutionId)
			const department = list.departments.find(d => d.myjkkn_department_id === myjkknId)
			if (!department) {
				return NextResponse.json({ error: 'That department does not belong to this college' }, { status: 400 })
			}

			const supabase = getSupabaseServer()
			const wanted = body.is_active !== false
			const { data, error } = department.local_id
				? await supabase
					.from('lib_departments')
					.update({ is_active: wanted, updated_at: new Date().toISOString(), updated_by: guard.caller.fullName ?? guard.caller.email })
					.eq('id', department.local_id)
					.eq('institution_id', guard.institutionId)
					.select(COLUMNS)
					.single()
				: await supabase
					.from('lib_departments')
					.insert({
						institution_id: guard.institutionId,
						source: 'myjkkn',
						myjkkn_department_id: myjkknId,
						department_name: department.department_name,
						department_code: department.department_code || null,
						is_active: wanted,
						sort_order: department.sort_order,
						created_by: guard.caller.fullName ?? guard.caller.email,
					})
					.select(COLUMNS)
					.single()

			if (error) {
				if (isMissingTable(error.code)) return NextResponse.json({ error: MISSING_TABLE }, { status: 503 })
				console.error('Error switching a MyJKKN department:', error)
				return NextResponse.json({ error: 'Failed to save the change' }, { status: 500 })
			}

			await logActivity(request, {
				institution_id: guard.institutionId,
				action: 'update',
				resource_type: 'department',
				resource_id: '/departments-list',
				new_values: { department_name: department.department_name, is_active: wanted },
				metadata: { myjkkn_department_id: myjkknId },
			})

			return NextResponse.json(data)
		}

		// ── Editing one of our own ─────────────────────────────────────────
		if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

		const guard = await guardRecordRow<DepartmentRowLite>(request, 'lib_departments', body.id, COLUMNS)
		if (!guard.ok) return guard.response
		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change a department' }, { status: 403 })
		}

		const before = guard.row
		if (before.source !== 'local') {
			return NextResponse.json(
				{ error: 'This department comes from MyJKKN — its name is changed there, not here' },
				{ status: 400 }
			)
		}

		const changes: Record<string, unknown> = {}
		if ('department_name' in body) {
			const name = String(body.department_name ?? '').trim()
			if (!name) return NextResponse.json({ error: 'Give the department a name' }, { status: 400 })
			if (name.toLowerCase() !== before.department_name.toLowerCase() && before.institution_id) {
				const list = await collegeDepartmentList(before.institution_id)
				if (list.departments.some(d => d.key !== before.id && d.department_name.trim().toLowerCase() === name.toLowerCase())) {
					return NextResponse.json({ error: `${name} is already in this college's list` }, { status: 400 })
				}
			}
			changes.department_name = name
		}
		if ('department_code' in body) changes.department_code = String(body.department_code ?? '').trim() || null
		if ('display_name' in body) changes.display_name = String(body.display_name ?? '').trim() || null
		if ('is_active' in body) changes.is_active = body.is_active !== false
		if ('sort_order' in body && Number.isFinite(Number(body.sort_order))) changes.sort_order = Number(body.sort_order)

		if (Object.keys(changes).length === 0) {
			return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
		}
		changes.updated_at = new Date().toISOString()
		changes.updated_by = guard.caller.fullName ?? guard.caller.email

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_departments')
			.update(changes)
			.eq('id', before.id)
			.select(COLUMNS)
			.single()

		if (error) {
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Another department already has that name' }, { status: 400 })
			}
			console.error('Error changing a department:', error)
			return NextResponse.json({ error: 'Failed to save the change' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: before.institution_id,
			action: 'update',
			resource_type: 'department',
			resource_id: '/departments-list',
			old_values: { department_name: before.department_name, is_active: before.is_active },
			new_values: changes,
			metadata: { department_id: before.id },
		})

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error changing a department:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const id = searchParams.get('id')
		if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

		const guard = await guardRecordRow<DepartmentRowLite>(request, 'lib_departments', id, COLUMNS)
		if (!guard.ok) return guard.response
		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can remove a department' }, { status: 403 })
		}

		const row = guard.row
		if (row.source !== 'local') {
			return NextResponse.json(
				{ error: 'This department comes from MyJKKN — switch it off instead of removing it' },
				{ status: 400 }
			)
		}

		const supabase = getSupabaseServer()

		// A department in use is never deleted. Books carry the department as
		// text, so deleting the row would not touch them — but it would leave
		// books filed under something no list can name. Deactivating keeps them
		// readable and stops it being offered for new ones.
		const [{ count: titles }, { count: libraries }] = await Promise.all([
			supabase
				.from('lib_catalogue_records')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', row.institution_id)
				.ilike('department', row.department_name),
			supabase
				.from('lib_locations')
				.select('*', { count: 'exact', head: true })
				.eq('institution_id', row.institution_id)
				.eq('location_kind', 'department')
				.ilike('department_name', row.department_name),
		])

		if ((titles ?? 0) > 0 || (libraries ?? 0) > 0) {
			const parts = []
			if ((titles ?? 0) > 0) parts.push(`${titles} title${titles === 1 ? '' : 's'}`)
			if ((libraries ?? 0) > 0) parts.push('a department library')
			return NextResponse.json(
				{
					error: `${row.department_name} still has ${parts.join(' and ')}. Switch it off instead — it then stops being offered for new books and the old ones keep their department.`,
					in_use: true,
					title_count: titles ?? 0,
				},
				{ status: 400 }
			)
		}

		const { error } = await supabase.from('lib_departments').delete().eq('id', row.id)
		if (error) {
			console.error('Error removing a department:', error)
			return NextResponse.json({ error: 'Failed to remove the department' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: row.institution_id,
			action: 'delete',
			resource_type: 'department',
			resource_id: '/departments-list',
			old_values: { department_name: row.department_name },
			metadata: { department_id: row.id },
		})

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error removing a department:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
