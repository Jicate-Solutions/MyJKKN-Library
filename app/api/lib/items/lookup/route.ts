/**
 * Desk lookup for a book: GET /api/lib/items/lookup?barcode=…
 *
 * Matches the accession number or the barcode, whichever the librarian scans
 * or types, and says plainly whether this copy can go out — a reference-only
 * copy is refused here rather than at the end of the issue.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const barcode = (searchParams.get('barcode') ?? '').trim()

		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!barcode) {
			return NextResponse.json({ error: 'Scan a book or type its accession number' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		let query = supabase
			.from('lib_items')
			.select(`
				*,
				catalogue:lib_catalogue_records(id, title, subtitle, isbn, call_number, resource_format),
				location:lib_locations(id, location_code, location_name, is_lendable)
			`)
			.or(`accession_number.eq.${barcode},barcode.eq.${barcode}`)
			.limit(1)

		if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

		const { data: item, error } = await query.maybeSingle()

		if (error) {
			console.error('Error looking up item:', error)
			return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
		}
		if (!item) {
			return NextResponse.json({ error: `No book found for "${barcode}"`, reason: 'no_item' }, { status: 404 })
		}

		// A copy on a reference-only shelf is reference-only even if nobody
		// remembered to tick the flag on the copy itself.
		const shelfIsReference = item.location && item.location.is_lendable === false
		const lendable = item.is_lendable && !shelfIsReference

		let refusal: string | null = null
		if (!lendable) refusal = 'This copy is reference only and cannot be issued'
		else if (item.status !== 'available') refusal = `This copy is ${item.status}`

		return NextResponse.json({
			...item,
			can_issue: refusal === null,
			refusal,
		})
	} catch (error) {
		console.error('Unexpected error looking up item:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
