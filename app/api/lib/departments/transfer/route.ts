/**
 * Moving books between the main library and a department.
 *
 * POST /api/lib/departments/transfer   send copies out, or bring them back
 * GET  /api/lib/departments/transfer?location_id=…   what has moved, and when
 *
 * A transfer is not a new book and not a copy. It is the same accession number
 * with a different `location_id` — which is precisely why the shelf report, the
 * accession register and the desk lookup show the department without a line of
 * their code changing, and why the annual return still counts the book once.
 *
 * Two things happen together on the way out: the copy moves, and its own
 * `is_lendable` is set from the department's default — off, for a reference
 * collection. Coming back, it is restored to lendable, because a book on the
 * main shelf that nobody may borrow is a book nobody asked for.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardRecordRow } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { logActivity } from '@/lib/library/activity-log'
import { blockedReason } from '@/lib/library/department-transfer-rules'
import type { DepartmentTransfer } from '@/types/lib-departments'

/** How many copies may be sent in one go. A trolley, not a lorry. */
const MAX_PER_TRANSFER = 200

/** `fetchAllRows` types its error as unknown; this is the readable half of it. */
function reason(error: unknown): string {
	if (error instanceof Error) return error.message
	if (error && typeof error === 'object' && 'message' in error) {
		return String((error as { message: unknown }).message)
	}
	return String(error)
}

/** A Supabase embed comes back as an object or a one-element array. */
function one<T>(value: T | T[] | null | undefined): T | null {
	if (Array.isArray(value)) return value[0] ?? null
	return value ?? null
}

interface DepartmentRow {
	id: string
	institution_id: string
	location_kind: string
	department_name: string | null
	incharge_name: string | null
	is_lendable: boolean
	is_active: boolean
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const locationId = searchParams.get('location_id')
		if (!locationId) {
			return NextResponse.json({ error: 'location_id is required' }, { status: 400 })
		}

		const guard = await guardRecordRow<DepartmentRow>(
			request,
			'lib_locations',
			locationId,
			'id, institution_id, location_kind, department_name, incharge_name, is_lendable, is_active'
		)
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()

		// Both directions for this department: what came in, and what went back.
		const { data, error } = await fetchAllRows<Record<string, any>>(range => supabase
			.from('lib_department_transfers')
			.select('*')
			.or(`to_location_id.eq.${locationId},from_location_id.eq.${locationId}`)
			.order('moved_at', { ascending: false })
			.range(range.from, range.to))

		// A database without the new table yet still shows the department and its
		// books — it simply cannot show the history, which is better than an
		// error page over a feature that has not been migrated in.
		if (error) {
			const message = reason(error)
			if (message.includes('lib_department_transfers')) {
				return NextResponse.json({ data: [], total: 0, note: 'Transfer history is not available yet' })
			}
			console.error('Error reading transfer history:', message)
			return NextResponse.json({ error: 'Failed to load the transfer history' }, { status: 500 })
		}

		const transfers: DepartmentTransfer[] = data.map(row => ({
			id: row.id,
			direction: row.direction,
			department_name: row.department_name,
			incharge_name: row.incharge_name,
			accession_number: row.accession_number,
			title: row.title,
			reference_only: row.reference_only,
			remarks: row.remarks,
			moved_at: row.moved_at,
			moved_by_name: row.moved_by_name,
		}))

		return NextResponse.json({ data: transfers, total: transfers.length })
	} catch (error) {
		console.error('Unexpected error reading transfer history:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()

		const locationId = String(body.location_id ?? '').trim()
		const direction = body.direction === 'to_main' ? 'to_main' : 'to_department'
		const itemIds: string[] = Array.isArray(body.item_ids)
			? [...new Set<string>(
				body.item_ids.map((id: unknown) => String(id).trim()).filter((id: string) => id.length > 0)
			)]
			: []

		if (!locationId) return NextResponse.json({ error: 'location_id is required' }, { status: 400 })
		if (itemIds.length === 0) {
			return NextResponse.json({ error: 'Choose at least one book' }, { status: 400 })
		}
		if (itemIds.length > MAX_PER_TRANSFER) {
			return NextResponse.json(
				{ error: `Send at most ${MAX_PER_TRANSFER} books at a time` },
				{ status: 400 }
			)
		}

		// The department library is the guarded record — a location id belonging
		// to another college answers 404, so the institution can never be taken
		// from the request body.
		const guard = await guardRecordRow<DepartmentRow>(
			request,
			'lib_locations',
			locationId,
			'id, institution_id, location_kind, department_name, incharge_name, is_lendable, is_active'
		)
		if (!guard.ok) return guard.response

		if (guard.row.location_kind !== 'department') {
			return NextResponse.json({ error: 'That is not a department library' }, { status: 400 })
		}
		if (direction === 'to_department' && !guard.row.is_active) {
			return NextResponse.json(
				{ error: 'This department library is closed. Reopen it before sending books.' },
				{ status: 400 }
			)
		}

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can move books' }, { status: 403 })
		}

		const supabase = getSupabaseServer()
		const institutionId = guard.row.institution_id

		// Every copy is read first, in one go: what it is, where it is, and
		// whether it is free to move. Sending a book that is out with a member
		// would put it on a department shelf it is not on.
		const { data: rows, error: readError } = await supabase
			.from('lib_items')
			.select(`
				id, accession_number, status, is_lendable, location_id, institution_id,
				catalogue_record:lib_catalogue_records(title)
			`)
			.in('id', itemIds)

		if (readError) {
			console.error('Error reading the copies to move:', readError)
			return NextResponse.json({ error: 'Failed to read the selected books' }, { status: 500 })
		}

		const found = (rows || []) as any[]
		const movable: any[] = []
		const refused: { accession_number: string; why: string }[] = []

		for (const item of found) {
			// Belt and braces on top of the guard: a copy from another college can
			// never be moved onto this college's department shelf.
			if (item.institution_id !== institutionId) {
				refused.push({ accession_number: item.accession_number, why: 'Belongs to another college' })
				continue
			}
			// The same rule the screen greys the checkbox with, read from the same
			// file — so a copy the desk cannot tick is exactly a copy this refuses.
			const blocked = blockedReason(item.status)
			if (blocked) {
				refused.push({ accession_number: item.accession_number, why: blocked })
				continue
			}
			if (direction === 'to_department' && item.location_id === locationId) {
				refused.push({ accession_number: item.accession_number, why: 'Already in this department' })
				continue
			}
			if (direction === 'to_main' && item.location_id !== locationId) {
				refused.push({ accession_number: item.accession_number, why: 'Not in this department' })
				continue
			}
			movable.push(item)
		}

		const missing = itemIds.filter(id => !found.some(f => f.id === id))
		for (const id of missing) {
			refused.push({ accession_number: id.slice(0, 8), why: 'No such copy in this college' })
		}

		if (movable.length === 0) {
			return NextResponse.json(
				{ error: 'None of those books could be moved', refused },
				{ status: 400 }
			)
		}

		// On the way out, a copy takes the department's default: reference-only
		// unless the department is run as a lending one. On the way back it is
		// lendable again — a book on the main shelf that may not be borrowed is
		// not what anyone asked for, and the desk would refuse it forever.
		const referenceOnly = direction === 'to_department' ? !guard.row.is_lendable : false
		const movedIds = movable.map(item => item.id)

		if (direction === 'to_department') {
			const { error: moveError } = await supabase
				.from('lib_items')
				.update({
					location_id: locationId,
					is_lendable: !referenceOnly,
					updated_at: new Date().toISOString(),
				})
				.in('id', movedIds)

			if (moveError) {
				console.error('Error moving the copies:', moveError)
				return NextResponse.json({ error: 'Failed to move the books' }, { status: 500 })
			}
		} else {
			// Coming back, each copy returns to the shelf it left. That shelf was
			// overwritten when it went out, so the only record of it is the
			// outbound transfer line — which is one of the reasons that table
			// exists. A copy whose outbound line is missing comes back with no
			// shelf rather than being put on someone else's.
			const { data: outbound } = await supabase
				.from('lib_department_transfers')
				.select('item_id, from_location_id, moved_at')
				.in('item_id', movedIds)
				.eq('direction', 'to_department')
				.order('moved_at', { ascending: false })

			const homeShelf = new Map<string, string | null>()
			for (const line of outbound || []) {
				// Ordered newest first, so the first line seen for a copy is the
				// most recent time it left — earlier ones are older history.
				if (!homeShelf.has(line.item_id)) homeShelf.set(line.item_id, line.from_location_id)
			}

			// Copies going back to the same shelf are updated together; only the
			// distinct shelves cost a round trip, not the books.
			const byShelf = new Map<string | null, string[]>()
			for (const id of movedIds) {
				const shelf = homeShelf.get(id) ?? null
				byShelf.set(shelf, [...(byShelf.get(shelf) ?? []), id])
			}

			for (const [shelf, ids] of byShelf) {
				const { error: moveError } = await supabase
					.from('lib_items')
					.update({
						location_id: shelf,
						is_lendable: true,
						updated_at: new Date().toISOString(),
					})
					.in('id', ids)

				if (moveError) {
					console.error('Error returning the copies:', moveError)
					return NextResponse.json({ error: 'Failed to move the books' }, { status: 500 })
				}
			}
		}

		// The history is written after the move, and its failure is never allowed
		// to undo it: the books really are on the department shelf by now, and
		// answering "failed" would send somebody to move them back.
		const remarks = String(body.remarks ?? '').trim() || null
		const movedByName = guard.caller.fullName ?? guard.caller.email

		const { error: historyError } = await supabase.from('lib_department_transfers').insert(
			movable.map(item => ({
				institution_id: institutionId,
				item_id: item.id,
				direction,
				from_location_id: item.location_id,
				to_location_id: direction === 'to_department' ? locationId : null,
				department_name: guard.row.department_name,
				incharge_name: guard.row.incharge_name,
				accession_number: item.accession_number,
				title: one<{ title: string }>(item.catalogue_record)?.title ?? null,
				reference_only: referenceOnly,
				remarks,
				moved_by: guard.caller.userId,
				moved_by_name: movedByName,
			}))
		)

		if (historyError) {
			console.warn('[departments] Transfer history not written:', historyError.message)
		}

		await logActivity(request, {
			institution_id: institutionId,
			action: 'update',
			resource_type: 'department_transfer',
			resource_id: '/departments',
			new_values: {
				direction,
				department_name: guard.row.department_name,
				moved: movable.length,
				reference_only: referenceOnly,
			},
			metadata: {
				location_id: locationId,
				accession_numbers: movable.map(i => i.accession_number).slice(0, 50),
			},
		})

		return NextResponse.json({
			moved: movable.length,
			refused,
			reference_only: referenceOnly,
			direction,
			history_written: !historyError,
		})
	} catch (error) {
		console.error('Unexpected error moving books:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
