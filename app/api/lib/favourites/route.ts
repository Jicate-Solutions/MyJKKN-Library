/**
 * A person's starred pages.
 *
 * Deliberately not behind `guardCollection`: favourites belong to a person, not
 * to a campus, so there is no institution to scope. What replaces that guard is
 * stricter — every query is filtered by `caller.userId`, which comes from the
 * session and never from the request, so there is no id in the URL or body that
 * could point at somebody else's list. That is also why a member may use it:
 * their two pages are theirs to star like anyone else's.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller, type Caller } from '@/lib/auth/server-access'

const TABLE = 'lib_page_favourites'

/** Rows returned to the client, in the shape the sidebar reads. */
function toFavourite(row: {
	id: string
	page_path: string
	display_title: string
	module_name: string | null
	sort_order: number
	is_pinned: boolean
}) {
	return {
		id: row.id,
		path: row.page_path,
		title: row.display_title,
		module: row.module_name ?? '',
		sortOrder: row.sort_order,
		isPinned: row.is_pinned,
	}
}

const SELECT = 'id, page_path, display_title, module_name, sort_order, is_pinned'

/**
 * Identifies the caller, and refuses changes made while viewing as someone else.
 *
 * Reading their list is how a super admin sees the system as they see it. Adding
 * to it is not — these are personal shortcuts, and a star that appears in
 * somebody's sidebar without them putting it there is just confusing.
 */
async function requireCaller(
	request: Request,
	forWrite: boolean
): Promise<{ caller: Caller } | { response: NextResponse }> {
	const { caller, error, status } = await getCaller(request)
	if (!caller) {
		return { response: NextResponse.json({ error: error ?? 'Not signed in' }, { status: status ?? 401 }) }
	}
	if (forWrite && caller.impersonatedBy) {
		return {
			response: NextResponse.json(
				{ error: 'Not while viewing as someone else — these are their own shortcuts' },
				{ status: 403 }
			),
		}
	}
	return { caller }
}

/** GET — this person's list, pinned first, then in the order they arranged. */
export async function GET(request: Request) {
	const auth = await requireCaller(request, false)
	if ('response' in auth) return auth.response

	const supabase = getSupabaseServer()
	const { data, error } = await supabase
		.from(TABLE)
		.select(SELECT)
		.eq('user_id', auth.caller.userId)
		.order('is_pinned', { ascending: false })
		.order('sort_order', { ascending: true })

	if (error) {
		console.error('[favourites] Fetch failed:', error)
		return NextResponse.json({ error: 'Could not load your favourites' }, { status: 500 })
	}

	return NextResponse.json((data || []).map(toFavourite))
}

/** POST — star a page. Starring one that is already starred changes nothing. */
export async function POST(request: Request) {
	const auth = await requireCaller(request, true)
	if ('response' in auth) return auth.response

	const body = await request.json().catch(() => null)
	const path = typeof body?.path === 'string' ? body.path.trim() : ''
	const title = typeof body?.title === 'string' ? body.title.trim() : ''
	const module = typeof body?.module === 'string' ? body.module.trim() : ''

	if (!path.startsWith('/')) {
		return NextResponse.json({ error: 'A page path is required' }, { status: 400 })
	}
	if (!title) {
		return NextResponse.json({ error: 'A page title is required' }, { status: 400 })
	}

	const supabase = getSupabaseServer()

	// New rows go to the end of the list rather than the top, so starring
	// something never rearranges what is already there
	const { data: last } = await supabase
		.from(TABLE)
		.select('sort_order')
		.eq('user_id', auth.caller.userId)
		.order('sort_order', { ascending: false })
		.limit(1)

	const nextOrder = (last?.[0]?.sort_order ?? -1) + 1

	const { data, error } = await supabase
		.from(TABLE)
		.insert({
			user_id: auth.caller.userId,
			page_path: path,
			display_title: title,
			module_name: module || null,
			sort_order: nextOrder,
			is_pinned: false,
		})
		.select(SELECT)
		.single()

	if (error) {
		// Already starred — the star is a toggle, and a double-tap is not an error
		if (error.code === '23505') {
			const { data: existing } = await supabase
				.from(TABLE)
				.select(SELECT)
				.eq('user_id', auth.caller.userId)
				.eq('page_path', path)
				.maybeSingle()

			if (existing) return NextResponse.json(toFavourite(existing))
		}
		console.error('[favourites] Insert failed:', error)
		return NextResponse.json({ error: 'Could not add to favourites' }, { status: 500 })
	}

	return NextResponse.json(toFavourite(data), { status: 201 })
}

/**
 * PATCH — pin or unpin one page, or save a new order for the whole list.
 *
 * Body is either `{ path, isPinned }` or `{ order: ['/a', '/b', ...] }`.
 */
export async function PATCH(request: Request) {
	const auth = await requireCaller(request, true)
	if ('response' in auth) return auth.response

	const body = await request.json().catch(() => null)
	const supabase = getSupabaseServer()
	const userId = auth.caller.userId

	if (Array.isArray(body?.order)) {
		const paths: string[] = body.order.filter((p: unknown): p is string => typeof p === 'string')

		// Written one by one, each still filtered by user_id — a path that is not
		// theirs simply matches no row instead of moving someone else's shortcut
		const results = await Promise.all(
			paths.map((path, index) =>
				supabase
					.from(TABLE)
					.update({ sort_order: index, updated_at: new Date().toISOString() })
					.eq('user_id', userId)
					.eq('page_path', path)
			)
		)

		const failed = results.find(r => r.error)
		if (failed?.error) {
			console.error('[favourites] Reorder failed:', failed.error)
			return NextResponse.json({ error: 'Could not save the new order' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	}

	const path = typeof body?.path === 'string' ? body.path.trim() : ''
	if (!path || typeof body?.isPinned !== 'boolean') {
		return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
	}

	const { data, error } = await supabase
		.from(TABLE)
		.update({ is_pinned: body.isPinned, updated_at: new Date().toISOString() })
		.eq('user_id', userId)
		.eq('page_path', path)
		.select(SELECT)
		.maybeSingle()

	if (error) {
		console.error('[favourites] Pin failed:', error)
		return NextResponse.json({ error: 'Could not change the pin' }, { status: 500 })
	}
	if (!data) return NextResponse.json({ error: 'Not in your favourites' }, { status: 404 })

	return NextResponse.json(toFavourite(data))
}

/** DELETE — unstar a page. `?path=/registry` */
export async function DELETE(request: Request) {
	const auth = await requireCaller(request, true)
	if ('response' in auth) return auth.response

	const path = new URL(request.url).searchParams.get('path')?.trim()
	if (!path) return NextResponse.json({ error: 'A page path is required' }, { status: 400 })

	const supabase = getSupabaseServer()
	const { error } = await supabase
		.from(TABLE)
		.delete()
		.eq('user_id', auth.caller.userId)
		.eq('page_path', path)

	if (error) {
		console.error('[favourites] Delete failed:', error)
		return NextResponse.json({ error: 'Could not remove from favourites' }, { status: 500 })
	}

	return NextResponse.json({ success: true })
}
