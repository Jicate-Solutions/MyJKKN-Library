import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { getInstitutionSettings } from '@/lib/library/institution-settings'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { logActivity } from '@/lib/library/activity-log'

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const memberCategory = searchParams.get('member_category')
		const isActive = searchParams.get('is_active')
		const search = searchParams.get('search')

		// A member roll can pass a thousand on the larger campuses, and a single
		// request stops at exactly that without saying so.
		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase.from('lib_members').select('*')

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (memberCategory) query = query.eq('member_category', memberCategory)
			if (isActive !== null) query = query.eq('is_active', isActive === 'true')
			if (search) {
				query = query.or(
					`member_number.ilike.%${search}%,display_name.ilike.%${search}%,email.ilike.%${search}%`
				)
			}

			return query.order('created_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching members:', error)
			return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error fetching members:', error)
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
		if (!body.member_category?.trim()) {
			return NextResponse.json({ error: 'member_category is required' }, { status: 400 })
		}
		if (!body.membership_start_date) {
			return NextResponse.json({ error: 'membership_start_date is required' }, { status: 400 })
		}
		// "Other" without a name is a member nobody can describe later
		if (body.member_category === 'other' && !body.category_label?.toString().trim()) {
			return NextResponse.json({ error: 'Type what this member is called' }, { status: 400 })
		}

		// One MyJKKN person may hold only one membership per institution. The UI hides
		// people who are already enrolled, but this is the guard that actually enforces
		// it — a stale page or a direct API call must not create a second membership.
		const linkedColumn = body.learner_id
			? 'learner_id'
			: body.facilitator_id
				? 'facilitator_id'
				: body.team_member_id
					? 'team_member_id'
					: null
		const linkedId = body.learner_id ?? body.facilitator_id ?? body.team_member_id ?? null

		if (linkedColumn && linkedId) {
			const { data: existing } = await supabase
				.from('lib_members')
				.select('id, member_number, display_name')
				.eq('institution_id', body.institution_id)
				.eq(linkedColumn, linkedId)
				.maybeSingle()

			if (existing) {
				return NextResponse.json(
					{
						error: `${existing.display_name ?? 'This person'} is already a member (${existing.member_number})`,
						existing_member_id: existing.id,
						existing_member_number: existing.member_number,
					},
					{ status: 409 }
				)
			}
		}

		// member_number is always assigned here — any value sent by the client is ignored.
		// Derived from the highest existing number for this institution and year, so
		// deleting a member can never cause the next enrolment to reuse a taken number.
		const settings = await getInstitutionSettings(body.institution_id)
		const year = new Date().getFullYear()
		const prefix = `${settings.member_number_prefix}-${year}-`

		// A learner's member number is their MyJKKN roll number — the number
		// already printed on the card the desk will scan. This is required for
		// learners and does not apply to staff, guests or alumni, who have no
		// roll number to use.
		const rollNumber: string | null =
			(body.roll_number ?? body.college_id ?? '').toString().trim() || null

		if (body.member_category === 'learner' && !rollNumber) {
			return NextResponse.json(
				{ error: 'This learner has no roll number in MyJKKN — a learner cannot be enrolled without one' },
				{ status: 400 }
			)
		}

		if (rollNumber) {
			const { data: taken } = await supabase
				.from('lib_members')
				.select('id, display_name')
				.eq('institution_id', body.institution_id)
				.eq('member_number', rollNumber)
				.maybeSingle()

			if (taken) {
				return NextResponse.json(
					{ error: `Roll number ${rollNumber} is already used by ${taken.display_name ?? 'another member'}` },
					{ status: 409 }
				)
			}
		}

		const nextMemberNumber = async (): Promise<string> => {
			// Learners always get their roll number; other categories use it only
			// when this campus has asked for college IDs.
			if (rollNumber && (body.member_category === 'learner' || settings.member_number_source === 'college_id')) {
				return rollNumber
			}

			const { data: last } = await supabase
				.from('lib_members')
				.select('member_number')
				.eq('institution_id', body.institution_id)
				.like('member_number', `${prefix}%`)
				.order('member_number', { ascending: false })
				.limit(1)
				.maybeSingle()

			const lastSeq = last?.member_number
				? parseInt(last.member_number.slice(prefix.length), 10)
				: 0
			const nextSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1
			return `${prefix}${String(nextSeq).padStart(4, '0')}`
		}

		const buildRow = (memberNumber: string) => ({
			institution_id: body.institution_id,
			member_number: memberNumber,
			member_category: body.member_category,
			// Only "Other" is named by the librarian; the rest name themselves.
			// Written only for "Other", so enrolling a learner still works on a
			// database that has not had the category_label column added yet.
			...(body.member_category === 'other'
				? { category_label: body.category_label?.toString().trim() || null }
				: {}),
			learner_id: body.learner_id ?? null,
			facilitator_id: body.facilitator_id ?? null,
			team_member_id: body.team_member_id ?? null,
			display_name: body.display_name ?? null,
			email: body.email ?? null,
			phone: body.phone ?? null,
			membership_start_date: body.membership_start_date,
			membership_end_date: body.membership_end_date ?? null,
			is_active: body.is_active ?? true,
			is_delinquent: body.is_delinquent ?? false,
			created_by: body.created_by ?? null,
		})

		// Retry on 23505 so two librarians enrolling at the same moment don't collide
		const MAX_ATTEMPTS = 5
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const memberNumber = await nextMemberNumber()
			const { data, error } = await supabase
				.from('lib_members')
				.insert(buildRow(memberNumber))
				.select()
				.single()

			if (!error) {
				await logActivity(request, {
					action: 'create',
					resource_type: 'member',
					resource_id: '/members',
					institution_id: body.institution_id,
					new_values: data,
					metadata: { member_number: data.member_number, member_category: data.member_category },
				})
				return NextResponse.json(data, { status: 201 })
			}

			if (error.code === '23505' && attempt < MAX_ATTEMPTS) {
				console.warn(`Member number ${memberNumber} taken, retrying (${attempt}/${MAX_ATTEMPTS})`)
				continue
			}

			console.error('Error creating member:', error)
			await logActivity(request, {
				action: 'create',
				resource_type: 'member',
				resource_id: '/members',
				institution_id: body.institution_id,
				status: 'error',
				error_message: error.message,
				metadata: { display_name: body.display_name ?? null },
			})
			// The Other category needs one database update to have been run
			if (error.code === '42703' || error.code === '23514') {
				return NextResponse.json(
					{ error: 'This library\'s database has not been updated for the Other category yet — please run the pending database update' },
					{ status: 400 }
				)
			}
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Could not assign a member number — please try again' }, { status: 409 })
			}
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check institution_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
		}

		return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
	} catch (error) {
		console.error('Unexpected error creating member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
