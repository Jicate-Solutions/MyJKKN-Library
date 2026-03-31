import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const isActive = searchParams.get('is_active')
		const search = searchParams.get('search')

		let query = supabase.from('lib_suppliers').select('*')

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (isActive !== null) query = query.eq('is_active', isActive === 'true')
		if (search) {
			query = query.or(
				`supplier_code.ilike.%${search}%,supplier_name.ilike.%${search}%,contact_person.ilike.%${search}%`
			)
		}

		const { data, error } = await query
			.order('supplier_name', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching suppliers:', error)
			return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching suppliers:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const body = await request.json()

		if (!body.institution_id) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}
		if (!body.supplier_code?.trim()) {
			return NextResponse.json({ error: 'supplier_code is required' }, { status: 400 })
		}
		if (!body.supplier_name?.trim()) {
			return NextResponse.json({ error: 'supplier_name is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_suppliers')
			.insert({
				institution_id: body.institution_id,
				supplier_code: body.supplier_code.trim().toUpperCase(),
				supplier_name: body.supplier_name.trim(),
				contact_person: body.contact_person ?? null,
				email: body.email ?? null,
				phone: body.phone ?? null,
				address: body.address ?? null,
				city: body.city ?? null,
				state: body.state ?? null,
				pincode: body.pincode ?? null,
				gst_number: body.gst_number ?? null,
				pan_number: body.pan_number ?? null,
				payment_terms: body.payment_terms ?? null,
				is_active: body.is_active ?? true,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating supplier:', error)
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Supplier code already exists for this institution' }, { status: 400 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating supplier:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
