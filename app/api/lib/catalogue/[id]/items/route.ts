import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_catalogue_records', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('lib_items')
			.select(`
				*,
				location:lib_locations(id, location_code, location_name)
			`)
			.eq('catalogue_record_id', id)
			.order('accession_number', { ascending: true })

		if (error) {
			console.error('Error fetching items for catalogue record:', error)
			return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching catalogue items:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
