/**
 * Department libraries for one college.
 *
 * GET    /api/lib/departments?institution_id=…   every MyJKKN department, with
 *                                                its library where one exists
 * POST   /api/lib/departments                    set a library up for a department
 * PUT    /api/lib/departments                    in-charge, default rule, active
 * DELETE /api/lib/departments?id=…               close one that holds no books
 *
 * The department list is MyJKKN's, read live on every request. This database
 * holds only what the library put inside a department: the fact that it has a
 * library, who is in charge of it, and — through `lib_items.location_id` — the
 * books that sit there. So when Dental adds five more departments in MyJKKN,
 * they appear here on the next load with nothing changed on this side.
 *
 * A department library is stored as a `lib_locations` row with
 * `location_kind = 'department'`. That is what makes the shelf report, the
 * accession register and the desk lookup show it correctly without knowing it
 * exists.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { logActivity } from '@/lib/library/activity-log'
import {
	collegeDepartments,
	myjkknDepartmentsConfigured,
	invalidateDepartments,
} from '@/lib/library/myjkkn-departments'
import type { DepartmentRow, DepartmentLibrary } from '@/types/lib-departments'

/** The columns a department library row is read with, everywhere in this file. */
const LIBRARY_COLUMNS = `
	id, institution_id, location_code, location_name,
	department_code, department_name, myjkkn_department_id,
	is_lendable, is_active, sort_order,
	incharge_myjkkn_id, incharge_name, incharge_designation, incharge_email,
	incharge_assigned_at, incharge_assigned_by,
	created_at
`

/** `fetchAllRows` types its error as unknown; this is the readable half of it. */
function reason(error: unknown): string {
	if (error instanceof Error) return error.message
	if (error && typeof error === 'object' && 'message' in error) {
		return String((error as { message: unknown }).message)
	}
	return String(error)
}

/**
 * A code that reads correctly wherever a shelf code is shown.
 *
 * The accession register and the shelf report print `location_code` beside
 * cupboard codes like "28-B", so "DEPT-COP-9" says at a glance that the book is
 * not on a rack downstairs. Prefixed rather than bare because a department code
 * and a cupboard code could otherwise collide.
 */
function codeForDepartment(departmentCode: string): string {
	return `DEPT-${departmentCode}`.slice(0, 60)
}

/**
 * How many books each department library holds, and how many of those may go
 * out.
 *
 * One grouped read for the whole college rather than one per department —
 * fifteen departments would otherwise be fifteen round trips for a screen that
 * shows two numbers per row. Retired and lost copies are left out: a shelf
 * count that includes books nobody can find is not a shelf count.
 */
async function bookCounts(institutionId: string, locationIds: string[]) {
	const counts = new Map<string, { total: number; issuable: number }>()
	if (locationIds.length === 0) return counts

	const supabase = getSupabaseServer()
	const { data, error } = await fetchAllRows<{ location_id: string; is_lendable: boolean }>(
		range => supabase
			.from('lib_items')
			.select('location_id, is_lendable')
			.eq('institution_id', institutionId)
			.in('location_id', locationIds)
			.not('status', 'in', '("retired","lost")')
			.order('location_id', { ascending: true })
			.range(range.from, range.to)
	)

	// A count that cannot be read is left absent rather than shown as zero —
	// "no books here" and "we could not tell" must not look the same.
	if (error) {
		console.warn('[departments] Could not count books:', reason(error))
		return counts
	}

	for (const row of data) {
		if (!row.location_id) continue
		const entry = counts.get(row.location_id) ?? { total: 0, issuable: 0 }
		entry.total += 1
		if (row.is_lendable) entry.issuable += 1
		counts.set(row.location_id, entry)
	}
	return counts
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		// Every college has its own departments and its own rules; there is no
		// sensible "all colleges" answer to this screen.
		if (!guard.institutionId) {
			return NextResponse.json(
				{ error: 'Select a college first — department libraries belong to one college at a time' },
				{ status: 400 }
			)
		}

		if (!myjkknDepartmentsConfigured()) {
			return NextResponse.json(
				{ error: 'MyJKKN is not configured on this server, so the department list cannot be read' },
				{ status: 503 }
			)
		}

		const supabase = getSupabaseServer()

		// MyJKKN's list and our own rows do not depend on each other, so they are
		// read together rather than one waiting on the other.
		const [departments, { data: libraries, error }] = await Promise.all([
			collegeDepartments(guard.institutionId),
			supabase
				.from('lib_locations')
				.select(LIBRARY_COLUMNS)
				.eq('institution_id', guard.institutionId)
				.eq('location_kind', 'department')
				.order('sort_order', { ascending: true }),
		])

		if (error) {
			// The migration for this feature has not been run on this database yet.
			// Said plainly rather than as a 500, because the fix is one script and
			// the person reading it is the person who runs it.
			if (error.code === '42703' || error.code === '42P01') {
				return NextResponse.json(
					{
						error: 'The department libraries migration has not been run on this database yet — apply supabase/migrations/20260828_lib_department_libraries.sql',
					},
					{ status: 503 }
				)
			}
			console.error('Error reading department libraries:', error)
			return NextResponse.json({ error: 'Failed to load department libraries' }, { status: 500 })
		}

		const rows = (libraries || []) as unknown as DepartmentLibrary[]
		const counts = await bookCounts(guard.institutionId, rows.map(r => r.id))

		const byDepartment = new Map<string, DepartmentLibrary>()
		for (const row of rows) {
			const withCounts: DepartmentLibrary = {
				...row,
				book_count: counts.get(row.id)?.total ?? 0,
				issuable_count: counts.get(row.id)?.issuable ?? 0,
			}
			if (row.myjkkn_department_id) byDepartment.set(row.myjkkn_department_id, withCounts)
		}

		const result: DepartmentRow[] = departments.map(department => ({
			myjkkn_department_id: department.id,
			department_code: department.department_code,
			department_name: department.department_name,
			display_name: department.display_name,
			degree_name: department.degree_name,
			is_active_in_myjkkn: department.is_active,
			library: byDepartment.get(department.id) ?? null,
		}))

		// A library whose department MyJKKN no longer returns still holds books,
		// and dropping it here would hide them. It is listed at the end, marked as
		// gone from MyJKKN, so somebody can move the books back before it is closed.
		for (const [departmentId, library] of byDepartment) {
			if (result.some(r => r.myjkkn_department_id === departmentId)) continue
			result.push({
				myjkkn_department_id: departmentId,
				department_code: library.department_code ?? '',
				department_name: library.department_name ?? 'Department no longer in MyJKKN',
				display_name: null,
				degree_name: null,
				is_active_in_myjkkn: false,
				library,
			})
		}

		return NextResponse.json({
			institution_id: guard.institutionId,
			departments: result,
			total_departments: result.length,
			libraries_open: rows.filter(r => r.is_active).length,
		})
	} catch (error) {
		console.error('Unexpected error listing department libraries:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json(
				{ error: 'Only library staff can open a department library' },
				{ status: 403 }
			)
		}

		const departmentId = String(body.myjkkn_department_id ?? '').trim()
		if (!departmentId) {
			return NextResponse.json({ error: 'Choose a department' }, { status: 400 })
		}

		// The name and code are taken from MyJKKN's own answer, never from the
		// request — otherwise a hand-edited body could open a library against a
		// department belonging to another college.
		const departments = await collegeDepartments(guard.institutionId!)
		const department = departments.find(d => d.id === departmentId)
		if (!department) {
			return NextResponse.json(
				{ error: 'That department does not belong to this college' },
				{ status: 400 }
			)
		}

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_locations')
			.insert({
				institution_id: guard.institutionId,
				location_kind: 'department',
				location_code: codeForDepartment(department.department_code),
				location_name: department.department_name,
				section: department.department_name,
				myjkkn_department_id: department.id,
				department_code: department.department_code,
				department_name: department.department_name,
				// Reference by default, which is how a department library is run.
				// This is only the default for arriving books; each copy carries its
				// own switch, so one or two can be issued later without changing it.
				is_lendable: body.is_lendable === true,
				is_active: true,
				sort_order: department.sort_order,
				incharge_myjkkn_id: String(body.incharge_myjkkn_id ?? '').trim() || null,
				incharge_name: String(body.incharge_name ?? '').trim() || null,
				incharge_designation: String(body.incharge_designation ?? '').trim() || null,
				incharge_email: String(body.incharge_email ?? '').trim() || null,
				incharge_assigned_at: body.incharge_myjkkn_id ? new Date().toISOString() : null,
				incharge_assigned_by: body.incharge_myjkkn_id ? (guard.caller.fullName ?? guard.caller.email) : null,
			})
			.select(LIBRARY_COLUMNS)
			.single()

		if (error) {
			if (error.code === '23505') {
				return NextResponse.json(
					{ error: `${department.department_name} already has a library` },
					{ status: 400 }
				)
			}
			if (error.code === '42703' || error.code === '42P01') {
				return NextResponse.json(
					{ error: 'The department libraries migration has not been run on this database yet' },
					{ status: 503 }
				)
			}
			console.error('Error opening department library:', error)
			return NextResponse.json({ error: 'Failed to open the department library' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: guard.institutionId,
			action: 'create',
			resource_type: 'department_library',
			resource_id: '/departments',
			new_values: {
				department_name: department.department_name,
				incharge_name: body.incharge_name ?? null,
			},
			metadata: { location_id: (data as any)?.id, department_code: department.department_code },
		})

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error opening department library:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	try {
		const body = await request.json()
		if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

		const guard = await guardRecord(request, 'lib_locations', body.id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json(
				{ error: 'Only library staff can change a department library' },
				{ status: 403 }
			)
		}

		const supabase = getSupabaseServer()

		// Only the fields this screen owns. The department itself is MyJKKN's and
		// is never edited here, so `myjkkn_department_id`, the code and the name
		// are deliberately absent from this update.
		const changes: Record<string, unknown> = {}

		if ('is_lendable' in body) changes.is_lendable = body.is_lendable === true
		if ('is_active' in body) changes.is_active = body.is_active === true

		// The in-charge is set and cleared as one thing — a name without an id
		// cannot be traced back to a person, and an id without a name reads as
		// nothing on screen.
		if ('incharge_myjkkn_id' in body) {
			const inchargeId = String(body.incharge_myjkkn_id ?? '').trim()
			if (inchargeId) {
				const name = String(body.incharge_name ?? '').trim()
				if (!name) {
					return NextResponse.json({ error: 'The in-charge needs a name' }, { status: 400 })
				}
				changes.incharge_myjkkn_id = inchargeId
				changes.incharge_name = name
				changes.incharge_designation = String(body.incharge_designation ?? '').trim() || null
				changes.incharge_email = String(body.incharge_email ?? '').trim() || null
				changes.incharge_assigned_at = new Date().toISOString()
				changes.incharge_assigned_by = guard.caller.fullName ?? guard.caller.email
			} else {
				changes.incharge_myjkkn_id = null
				changes.incharge_name = null
				changes.incharge_designation = null
				changes.incharge_email = null
				changes.incharge_assigned_at = null
				changes.incharge_assigned_by = null
			}
		}

		if (Object.keys(changes).length === 0) {
			return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
		}

		// The row as it stands, so the log can say what it was before. Read here
		// rather than after, because the update overwrites the only copy of it.
		const { data: before } = await supabase
			.from('lib_locations')
			.select('incharge_name, incharge_myjkkn_id, is_lendable, is_active, department_name')
			.eq('id', body.id)
			.maybeSingle()

		const { data, error } = await supabase
			.from('lib_locations')
			.update(changes)
			.eq('id', body.id)
			.eq('location_kind', 'department')
			.select(LIBRARY_COLUMNS)
			.single()

		if (error) {
			console.error('Error updating department library:', error)
			return NextResponse.json({ error: 'Failed to save the change' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: (data as any)?.institution_id ?? null,
			action: 'update',
			resource_type: 'department_library',
			resource_id: '/departments',
			old_values: before ?? undefined,
			new_values: changes,
			metadata: { location_id: body.id, department_name: before?.department_name },
		})

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating department library:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const id = searchParams.get('id')
		if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

		const guard = await guardRecord(request, 'lib_locations', id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'library_admin')) {
			return NextResponse.json(
				{ error: 'Only a library admin can close a department library' },
				{ status: 403 }
			)
		}

		const supabase = getSupabaseServer()

		// A department library still holding books must not be deleted. The
		// foreign key would not stop it — `lib_items.location_id` is ON DELETE SET
		// NULL, so the row would go and the books would quietly lose the only
		// record of where they are. Refusing here is the whole protection.
		const { count } = await supabase
			.from('lib_items')
			.select('*', { count: 'exact', head: true })
			.eq('location_id', id)

		if ((count ?? 0) > 0) {
			return NextResponse.json(
				{
					error: `${count} book${count === 1 ? '' : 's'} still sit here. Send them back to the main library first, or mark this library closed instead.`,
				},
				{ status: 400 }
			)
		}

		const { data: before } = await supabase
			.from('lib_locations')
			.select('department_name, institution_id')
			.eq('id', id)
			.maybeSingle()

		const { error } = await supabase
			.from('lib_locations')
			.delete()
			.eq('id', id)
			.eq('location_kind', 'department')

		if (error) {
			console.error('Error closing department library:', error)
			return NextResponse.json({ error: 'Failed to close the department library' }, { status: 500 })
		}

		invalidateDepartments(before?.institution_id ?? undefined)

		await logActivity(request, {
			institution_id: before?.institution_id ?? null,
			action: 'delete',
			resource_type: 'department_library',
			resource_id: '/departments',
			old_values: before ?? undefined,
			metadata: { location_id: id },
		})

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error closing department library:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
