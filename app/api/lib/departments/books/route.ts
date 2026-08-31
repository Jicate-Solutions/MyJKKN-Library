/**
 * The books inside one department library, and the ones that could be sent.
 *
 * GET /api/lib/departments/books?location_id=…          what sits there now
 * GET /api/lib/departments/books?location_id=…&available=1&search=…
 *                                                       copies in the main
 *                                                       library, to send out
 * PUT /api/lib/departments/books                        may this copy be issued?
 *
 * The PUT is the small door the whole design turns on. A department library is
 * run for reference, so books arrive with their own `is_lendable` switched off
 * and circulation refuses them — that check already exists in
 * `/api/lib/circulation/issue` and is not touched here. When one or two books
 * do need to go out, this flips that copy's switch and the desk issues it like
 * any other book. Because the switch is on the copy, opening two books does not
 * open the department.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardRecordRow } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { logActivity } from '@/lib/library/activity-log'
import type { DepartmentBook, TransferCandidate } from '@/types/lib-departments'

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

/** One copy as the "send books" table draws it. */
function toCandidate(row: ItemRow): TransferCandidate {
	const record = one(row.catalogue_record)
	const location = one(row.location)
	return {
		id: row.id,
		accession_number: row.accession_number,
		copy_number: row.copy_number,
		status: row.status,
		is_lendable: row.is_lendable,
		title: record?.title ?? 'Untitled',
		author: record?.author ?? null,
		call_number: record?.call_number ?? null,
		location_name: location?.location_name ?? null,
		location_code: location?.location_code ?? null,
	}
}

interface ItemRow {
	id: string
	accession_number: string
	barcode: string | null
	copy_number: number
	status: string
	is_lendable: boolean
	condition: string
	accession_date: string | null
	location_id: string | null
	catalogue_record: {
		title: string
		author: string | null
		call_number: string | null
		isbn: string | null
		resource_format: string | null
	} | null
	location: { location_code: string; location_name: string } | null
}

const ITEM_COLUMNS = `
	id, accession_number, barcode, copy_number, status, is_lendable,
	condition, accession_date, location_id,
	catalogue_record:lib_catalogue_records(title, author, call_number, isbn, resource_format),
	location:lib_locations(location_code, location_name)
`

/**
 * The same columns, but the catalogue join is `!inner`.
 *
 * Used only when the search runs against title, author and the rest: an inner
 * join turns the embedded filter into a real filter on the copies, so a book
 * whose title does not match is gone rather than returned with a blank record.
 */
const ITEM_COLUMNS_INNER = ITEM_COLUMNS.replace(
	'lib_catalogue_records(',
	'lib_catalogue_records!inner('
)

/**
 * How many copies arrive per page while scrolling the shelf.
 *
 * Ten, so the table is a screenful rather than a wall — a hundred rows put
 * everything below the fold and made the page the thing you scrolled instead of
 * the list. More arrive on request.
 */
const CANDIDATE_PAGE = 10

/**
 * The ceiling on each half of a search.
 *
 * A search is two reads merged, so a shared page number would not line up
 * across them. Instead each side is capped and the screen is told when the cap
 * was reached, which is honest about what Select all is selecting. 250 a side
 * is far past what anybody ticks by hand, and still one fast read.
 */
const SEARCH_SIDE_LIMIT = 250

/**
 * PostgREST reads `,` as the end of a filter and `%` as its own wildcard, and
 * `(` `)` close an `or(...)` group early. A title with a comma in it would
 * otherwise come back as a syntax error rather than a search.
 */
function escapeForIlike(value: string): string {
	return value.replace(/[,()%\\]/g, ' ').trim()
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const locationId = searchParams.get('location_id')
		if (!locationId) {
			return NextResponse.json({ error: 'location_id is required' }, { status: 400 })
		}

		// Guarding on the department library row rather than on a query parameter
		// is what keeps one college out of another's departments: an id from
		// elsewhere answers 404, exactly as if it did not exist.
		const guard = await guardRecordRow<{
			id: string
			institution_id: string
			location_kind: string
			department_name: string | null
			is_lendable: boolean
		}>(
			request,
			'lib_locations',
			locationId,
			'id, institution_id, location_kind, department_name, is_lendable'
		)
		if (!guard.ok) return guard.response

		if (guard.row.location_kind !== 'department') {
			return NextResponse.json({ error: 'That is not a department library' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const institutionId = guard.row.institution_id
		const wantsCandidates = searchParams.get('available') === '1'
		const search = (searchParams.get('search') ?? '').trim()

		// ── Copies in the main library, offered for sending out ────────────────
		if (wantsCandidates) {
			const page = Math.max(0, Number(searchParams.get('page') ?? 0) || 0)
			const from = page * CANDIDATE_PAGE
			const to = from + CANDIDATE_PAGE - 1

			/**
			 * Not in this department already.
			 *
			 * Written as an `or` on purpose. `location_id <> '<id>'` is NULL for a
			 * copy that has no shelf recorded, and NULL is not true, so a plain
			 * `neq` silently drops every such copy. Today that is EVERY copy in the
			 * system — all 81,787 of them have no shelf — so the neq this replaced
			 * offered nothing at all, for every college, however the search was
			 * spelled.
			 */
			const notHere = `location_id.is.null,location_id.neq.${locationId}`

			// ── Nothing typed: the shelf itself, a page at a time ────────────────
			//
			// The whole point of this screen is to see what is there without having
			// to guess a title first. Engineering has 27,996 available copies, so
			// it arrives in pages rather than all at once, ordered by accession
			// number so the order is stable while paging.
			if (!search) {
				const { data, error, count } = await supabase
					.from('lib_items')
					.select(ITEM_COLUMNS, { count: 'exact' })
					.eq('institution_id', institutionId)
					.or(notHere)
					.order('accession_number', { ascending: true })
					.range(from, to)

				if (error) {
					console.error('Error listing copies to send:', error)
					return NextResponse.json({ error: 'Failed to load the shelf' }, { status: 500 })
				}

				const rows = (data ?? []) as unknown as ItemRow[]
				return NextResponse.json({
					data: rows.map(toCandidate),
					total: count ?? rows.length,
					page,
					has_more: from + rows.length < (count ?? 0),
					truncated: false,
				})
			}

			// ── Something typed: two reads, side by side ─────────────────────────
			//
			// The accession number and barcode are on the copy; the title, author,
			// ISBN and call number are on the catalogue record above it. PostgREST
			// cannot OR across a parent and its embedded child in one filter, so
			// this is two queries — but they are fired TOGETHER, so the wait is the
			// slower of the two rather than the sum. Measured against Engineering,
			// the biggest college, each comes back in about 70ms.
			const term = escapeForIlike(search)

			const [onCopy, onTitle] = await Promise.all([
				supabase
					.from('lib_items')
					.select(ITEM_COLUMNS)
					.eq('institution_id', institutionId)
					.or(notHere)
					.or(`accession_number.ilike.%${term}%,barcode.ilike.%${term}%`)
					.order('accession_number', { ascending: true })
					.limit(SEARCH_SIDE_LIMIT),

				// `!inner` makes the join a filter: a copy whose title does not
				// match drops out entirely, instead of coming back with an empty
				// record attached.
				supabase
					.from('lib_items')
					.select(ITEM_COLUMNS_INNER)
					.eq('institution_id', institutionId)
					.or(notHere)
					.or(
						`title.ilike.%${term}%,author.ilike.%${term}%,isbn.ilike.%${term}%,` +
						`call_number.ilike.%${term}%,publisher_name.ilike.%${term}%`,
						{ referencedTable: 'catalogue_record' }
					)
					.order('accession_number', { ascending: true })
					.limit(SEARCH_SIDE_LIMIT),
			])

			if (onCopy.error || onTitle.error) {
				console.error('Error searching the shelf:', onCopy.error ?? onTitle.error)
				return NextResponse.json({ error: 'Failed to search the shelf' }, { status: 500 })
			}

			// The same copy can match on both sides — an accession number that also
			// appears in a call number — so they are merged by id, not concatenated.
			const merged = new Map<string, ItemRow>()
			for (const row of (onCopy.data ?? []) as unknown as ItemRow[]) merged.set(row.id, row)
			for (const row of (onTitle.data ?? []) as unknown as ItemRow[]) merged.set(row.id, row)

			const rows = [...merged.values()]
				.sort((a, b) => a.accession_number.localeCompare(b.accession_number))

			// Either side hitting its ceiling means there are matches not shown.
			// Said out loud rather than left for somebody to discover after they
			// have ticked Select all and think they have taken everything.
			const truncated =
				(onCopy.data?.length ?? 0) >= SEARCH_SIDE_LIMIT ||
				(onTitle.data?.length ?? 0) >= SEARCH_SIDE_LIMIT

			return NextResponse.json({
				data: rows.map(toCandidate),
				total: rows.length,
				page: 0,
				has_more: false,
				truncated,
			})
		}

		// ── What sits in this department now ───────────────────────────────────
		//
		// Read in slices: a well-stocked department passes the thousand rows a
		// single request returns, and the cap is applied silently — the reply
		// would look complete while leaving books off the shelf list.
		const { data: rawRows, error } = await fetchAllRows<Record<string, any>>(range => supabase
			.from('lib_items')
			.select(ITEM_COLUMNS)
			.eq('institution_id', institutionId)
			.eq('location_id', locationId)
			.order('accession_number', { ascending: true })
			.range(range.from, range.to))

		if (error) {
			console.error('Error reading department books:', reason(error))
			return NextResponse.json({ error: 'Failed to load the books' }, { status: 500 })
		}

		// The embed comes back typed as an array by the client's generics; `one`
		// below is what actually reads it, so the shape is asserted once here.
		const data = rawRows as unknown as ItemRow[]

		// A copy on loan is still the department's book; the borrower's name and
		// due date are read in one go rather than one query per book.
		const onLoanIds = data.filter(row => row.status === 'on_loan').map(row => row.id)
		const loans = new Map<string, { name: string | null; due: string | null }>()

		if (onLoanIds.length > 0) {
			const { data: active } = await supabase
				.from('lib_lending_transactions')
				.select('item_id, due_date, member:lib_borrowers(display_name)')
				.in('item_id', onLoanIds)
				.in('transaction_status', ['active', 'overdue'])

			for (const loan of (active || []) as any[]) {
				loans.set(loan.item_id, {
					name: one<{ display_name: string }>(loan.member)?.display_name ?? null,
					due: loan.due_date ?? null,
				})
			}
		}

		const books: DepartmentBook[] = data.map(row => {
			const record = one(row.catalogue_record)
			const loan = loans.get(row.id)
			return {
				id: row.id,
				accession_number: row.accession_number,
				barcode: row.barcode,
				copy_number: row.copy_number,
				status: row.status,
				is_lendable: row.is_lendable,
				condition: row.condition,
				accession_date: row.accession_date,
				title: record?.title ?? 'Untitled',
				author: record?.author ?? null,
				call_number: record?.call_number ?? null,
				isbn: record?.isbn ?? null,
				resource_format: record?.resource_format ?? null,
				on_loan_to: loan?.name ?? null,
				due_date: loan?.due ?? null,
			}
		})

		return NextResponse.json({
			data: books,
			total: books.length,
			issuable: books.filter(b => b.is_lendable).length,
			department_name: guard.row.department_name,
			default_lendable: guard.row.is_lendable,
		})
	} catch (error) {
		console.error('Unexpected error reading department books:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

/**
 * Turn one copy's issuing on or off.
 *
 * This is the exception the whole department library is built to allow. It
 * changes nothing about the department and nothing about the other books —
 * `lib_items.is_lendable` is per copy, and the circulation desk already reads
 * it on every issue.
 */
export async function PUT(request: Request) {
	try {
		const body = await request.json()
		const itemId = String(body.item_id ?? '').trim()
		if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
		if (typeof body.is_lendable !== 'boolean') {
			return NextResponse.json({ error: 'is_lendable must be true or false' }, { status: 400 })
		}

		const guard = await guardRecordRow<{
			id: string
			institution_id: string
			is_lendable: boolean
			status: string
			accession_number: string
			location_id: string | null
		}>(
			request,
			'lib_items',
			itemId,
			'id, institution_id, is_lendable, status, accession_number, location_id'
		)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json(
				{ error: 'Only library staff can change whether a book may be issued' },
				{ status: 403 }
			)
		}

		const supabase = getSupabaseServer()

		// Turning issuing OFF for a copy that is already out would leave the
		// database saying something the shelf disagrees with. The book comes back
		// first; then it can be made reference-only.
		if (!body.is_lendable && guard.row.status === 'on_loan') {
			return NextResponse.json(
				{ error: 'This copy is out with a member. Take the return first, then mark it reference only.' },
				{ status: 400 }
			)
		}

		const { data, error } = await supabase
			.from('lib_items')
			.update({ is_lendable: body.is_lendable, updated_at: new Date().toISOString() })
			.eq('id', itemId)
			.select('id, accession_number, is_lendable')
			.single()

		if (error) {
			console.error('Error changing whether a copy may be issued:', error)
			return NextResponse.json({ error: 'Failed to save the change' }, { status: 500 })
		}

		await logActivity(request, {
			institution_id: guard.row.institution_id,
			action: 'update',
			resource_type: 'department_book',
			resource_id: '/departments',
			old_values: { is_lendable: guard.row.is_lendable },
			new_values: { is_lendable: body.is_lendable },
			metadata: {
				item_id: itemId,
				accession_number: guard.row.accession_number,
				now: body.is_lendable ? 'can be issued' : 'reference only',
			},
		})

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error changing a copy:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
