import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const resourceType = searchParams.get('resource_type')
		const isActive = searchParams.get('is_active')
		const naacReportable = searchParams.get('naac_reportable')
		const search = searchParams.get('search')

		let query = supabase.from('lib_digital_resources').select('*')

		if (institutionId) query = query.eq('institution_id', institutionId)
		if (resourceType) query = query.eq('resource_type', resourceType)
		if (isActive !== null) query = query.eq('is_active', isActive === 'true')
		if (naacReportable !== null) query = query.eq('naac_reportable', naacReportable === 'true')
		if (search) {
			query = query.or(
				`resource_title.ilike.%${search}%,provider.ilike.%${search}%`
			)
		}

		const { data, error } = await query
			.order('resource_title', { ascending: true })
			.range(0, 9999)

		if (error) {
			console.error('Error fetching digital resources:', error)
			return NextResponse.json({ error: 'Failed to fetch digital resources' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching digital resources:', error)
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
		if (!body.resource_title?.trim()) {
			return NextResponse.json({ error: 'resource_title is required' }, { status: 400 })
		}
		if (!body.resource_type?.trim()) {
			return NextResponse.json({ error: 'resource_type is required' }, { status: 400 })
		}
		if (!body.access_url?.trim()) {
			return NextResponse.json({ error: 'access_url is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_digital_resources')
			.insert({
				institution_id: body.institution_id,
				resource_title: body.resource_title.trim(),
				resource_type: body.resource_type,
				provider: body.provider ?? null,
				access_url: body.access_url.trim(),
				username: body.username ?? null,
				password_hint: body.password_hint ?? null,
				coverage_years: body.coverage_years ?? null,
				subject_areas: body.subject_areas ?? null,
				subscription_start: body.subscription_start ?? null,
				subscription_end: body.subscription_end ?? null,
				annual_cost: body.annual_cost ?? null,
				concurrent_users: body.concurrent_users ?? null,
				is_active: body.is_active ?? true,
				is_open_access: body.is_open_access ?? false,
				naac_reportable: body.naac_reportable ?? true,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating digital resource:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create digital resource' }, { status: 500 })
		}

		return NextResponse.json(data, { status: 201 })
	} catch (error) {
		console.error('Unexpected error creating digital resource:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
