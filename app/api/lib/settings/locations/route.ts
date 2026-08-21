/**
 * Shelf locations for one institution.
 *
 * GET    /api/lib/settings/locations?institution_id=…
 * POST   /api/lib/settings/locations        create one, or a whole rack range
 * PUT    /api/lib/settings/locations        edit one
 * DELETE /api/lib/settings/locations?id=…
 *
 * Pharmacy shelves by cupboard and rack — cupboard 28, racks A to D, written as
 * "28-B". Typing those one at a time is a waste, so POST also accepts a range
 * and creates every cupboard/rack pair in one call.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { fetchAllRows } from '@/lib/library/fetch-all'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()

		// Shelves are created a rack at a time, up to 500 in one go, so a college
		// that has laid out its cupboards over a few sittings can hold more than
		// the thousand a single request returns.
		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_locations')
				.select('*')
				.order('sort_order', { ascending: true })
				.order('location_code', { ascending: true })

			if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

			return query.range(range.from, range.to)
		})
		if (error) {
			console.error('Error listing locations:', error)
			return NextResponse.json({ error: 'Failed to load locations' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error listing locations:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change locations' }, { status: 403 })
		}

		const supabase = getSupabaseServer()

		// Bulk form: { cupboard_from, cupboard_to, racks: ['A','B','C','D'] }
		if (body.cupboard_from !== undefined && body.cupboard_to !== undefined) {
			const from = Number(body.cupboard_from)
			const to = Number(body.cupboard_to)
			const racks: string[] = Array.isArray(body.racks) && body.racks.length > 0
				? body.racks.map((r: unknown) => String(r).trim().toUpperCase()).filter(Boolean)
				: ['A', 'B', 'C', 'D']

			if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
				return NextResponse.json({ error: 'Give a valid cupboard range' }, { status: 400 })
			}
			if ((to - from + 1) * racks.length > 500) {
				return NextResponse.json({ error: 'That range would create more than 500 shelves' }, { status: 400 })
			}

			const rows = []
			for (let cupboard = from; cupboard <= to; cupboard++) {
				for (const rack of racks) {
					rows.push({
						institution_id: guard.institutionId,
						location_code: `${cupboard}-${rack}`,
						location_name: String(body.location_name ?? '').trim() || `Cupboard ${cupboard} rack ${rack}`,
						floor: body.floor ?? null,
						section: body.section ?? null,
						is_lendable: body.is_lendable ?? true,
						is_active: true,
						sort_order: cupboard * 10 + racks.indexOf(rack),
					})
				}
			}

			// Skip codes this institution already has rather than failing the batch.
			// Only the codes about to be created are asked about — at most 500 of
			// them — instead of reading the whole shelf list, which would stop at a
			// thousand rows and quietly call an existing shelf free.
			const { data: existing } = await supabase
				.from('lib_locations')
				.select('location_code')
				.eq('institution_id', guard.institutionId)
				.in('location_code', rows.map(r => r.location_code))

			const taken = new Set((existing || []).map(e => e.location_code))
			const fresh = rows.filter(r => !taken.has(r.location_code))

			if (fresh.length === 0) {
				return NextResponse.json({ created: 0, skipped: rows.length, data: [] })
			}

			const { data, error } = await supabase.from('lib_locations').insert(fresh).select()
			if (error) {
				console.error('Error creating shelf range:', error)
				return NextResponse.json({ error: 'Failed to create shelves' }, { status: 500 })
			}

			return NextResponse.json(
				{ created: data?.length ?? 0, skipped: rows.length - fresh.length, data },
				{ status: 201 }
			)
		}

		// Single location
		const code = String(body.location_code ?? '').trim()
		if (!code) return NextResponse.json({ error: 'Location code is required' }, { status: 400 })

		const { data, error } = await supabase
			.from('lib_locations')
			.insert({
				institution_id: guard.institutionId,
				location_code: code,
				location_name: String(body.location_name ?? '').trim() || code,
				floor: body.floor ?? null,
				section: body.section ?? null,
				is_lendable: body.is_lendable ?? true,
				is_active: body.is_active ?? true,
				sort_order: Number(body.sort_order ?? 0),
			})
			.select()
			.single()

		if (error) {
			if (error.code === '23505') {
				return NextResponse.json({ error: `Location "${code}" already exists` }, { status: 400 })
			}
			console.error('Error creating location:', error)
			return NextResponse.json({ error: 'Failed to create location' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating location:', error)
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
			return NextResponse.json({ error: 'Only library staff can change locations' }, { status: 403 })
		}

		const supabase = getSupabaseServer()
		const { data, error } = await supabase
			.from('lib_locations')
			.update({
				location_name: body.location_name,
				floor: body.floor ?? null,
				section: body.section ?? null,
				is_lendable: body.is_lendable,
				is_active: body.is_active,
				sort_order: body.sort_order,
			})
			.eq('id', body.id)
			.select()
			.single()

		if (error) {
			console.error('Error updating location:', error)
			return NextResponse.json({ error: 'Failed to update location' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating location:', error)
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

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change locations' }, { status: 403 })
		}

		const supabase = getSupabaseServer()
		const { error } = await supabase.from('lib_locations').delete().eq('id', id)

		if (error) {
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — books are shelved here. Mark it inactive instead.' },
					{ status: 400 }
				)
			}
			console.error('Error deleting location:', error)
			return NextResponse.json({ error: 'Failed to delete location' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting location:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
