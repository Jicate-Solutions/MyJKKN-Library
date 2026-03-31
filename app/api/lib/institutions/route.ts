import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
	try {
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('institutions')
			.select('id, institution_code, name, myjkkn_institution_ids')
			.eq('is_active', true)
			.order('name')

		if (error) {
			console.error('Error fetching institutions:', error)
			return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: 500 })
		}

		// Map 'name' to 'institution_name' for frontend compatibility
		const institutions = (data || []).map(inst => ({
			id: inst.id,
			institution_code: inst.institution_code,
			institution_name: inst.name,
			myjkkn_institution_ids: inst.myjkkn_institution_ids,
		}))

		return NextResponse.json(institutions)
	} catch (error) {
		console.error('Unexpected error fetching institutions:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
