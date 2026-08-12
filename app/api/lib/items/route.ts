import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const catalogueRecordId = searchParams.get('catalogue_record_id')
		const status = searchParams.get('status')
		const search = searchParams.get('search')

		let query = supabase
			.from('lib_items')
			.select(`
				*,
				catalogue_record:lib_catalogue_records(id, title, isbn, call_number, resource_format),
				location:lib_locations(id, location_code, location_name)
			`)

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (catalogueRecordId) query = query.eq('catalogue_record_id', catalogueRecordId)
		if (status) query = query.eq('status', status)
		if (search) {
			query = query.or(
				`accession_number.ilike.%${search}%,barcode.ilike.%${search}%`
			)
		}

		const { data, error } = await query
			.order('accession_number', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching items:', error)
			return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching items:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response
		body.institution_id = guard.institutionId

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!body.catalogue_record_id) {
			return NextResponse.json({ error: 'catalogue_record_id is required' }, { status: 400 })
		}

		// Every copy carries its own number, written inside the book itself — the
		// library's equivalent of a member number. It is always typed by the
		// librarian, never invented here: a generated number would not match what
		// is physically on the shelf, and the mismatch would only surface later
		// at the desk when a scan found nothing.
		const accessionNumber: string = (body.accession_number ?? '').toString().trim()

		if (!accessionNumber) {
			return NextResponse.json(
				{ error: 'Accession number is required — enter the number written in the book' },
				{ status: 400 }
			)
		}

		// Two copies cannot share a number within one library. Checked case
		// insensitively, so "pd101" cannot slip past an existing "PD101".
		const { data: clash } = await supabase
			.from('lib_items')
			.select('id, accession_number')
			.eq('institution_id', body.institution_id)
			.ilike('accession_number', accessionNumber)
			.maybeSingle()

		if (clash) {
			return NextResponse.json(
				{ error: `Accession number ${clash.accession_number} is already used by another copy` },
				{ status: 409 }
			)
		}

		const { data, error } = await supabase
			.from('lib_items')
			.insert({
				institution_id: body.institution_id,
				catalogue_record_id: body.catalogue_record_id,
				location_id: body.location_id ?? null,
				accession_number: accessionNumber,
				barcode: body.barcode ?? null,
				copy_number: body.copy_number ?? 1,
				condition: body.condition ?? 'new',
				price: body.price ?? null,
				invoice_cost: body.invoice_cost ?? null,
				mrp_value: body.mrp_value ?? null,
				discount: body.discount ?? null,
				currency_code: body.currency_code ?? 'INR',
				procurement_item_id: body.procurement_item_id ?? null,
				supplier_id: body.supplier_id ?? null,
				date_received: body.date_received ?? null,
				invoice_number: body.invoice_number ?? null,
				status: body.status ?? 'available',
				is_lendable: body.is_lendable ?? true,
				is_active: body.is_active ?? true,
				accession_date: body.accession_date ?? new Date().toISOString().split('T')[0],
				created_by: body.created_by ?? null,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating item:', error)
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Accession number or barcode already exists' }, { status: 400 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check catalogue_record_id or location_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating item:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
