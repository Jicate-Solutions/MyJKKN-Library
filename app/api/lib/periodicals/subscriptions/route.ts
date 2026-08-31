import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { createExpectedIssues } from '@/lib/library/expected-issues'

/**
 * The columns this list and its edit sheet actually use.
 *
 * `*` also carried the subscription's credentials fields, which nothing on this
 * screen reads. The budget head used to be joined here too — many subscriptions
 * share one, so the database rebuilt that same parent row once per subscription
 * for a value no page under `app/(lib)/periodicals` ever renders.
 */
const LIST_COLUMNS = `
	id,
	institution_id,
	catalogue_record_id,
	supplier_id,
	subscription_number,
	subscription_type,
	frequency,
	fiscal_year,
	start_date,
	end_date,
	subscription_cost,
	currency_code,
	start_volume,
	start_issue,
	expected_issues,
	received_issues,
	access_url,
	subscription_status,
	is_gratis,
	created_at,
	updated_at,
	catalogue_record:lib_catalogue_records(id, title, issn, resource_format),
	supplier:lib_suppliers(id, supplier_code, supplier_name)
`

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const requestedInstitutionId = searchParams.get('institution_id')
		const guard = await guardCollection(request, requestedInstitutionId)
		if (!guard.ok) return guard.response
		const institutionId = guard.institutionId
		const subscriptionStatus = searchParams.get('subscription_status')
		const fiscalYear = searchParams.get('fiscal_year')
		const search = searchParams.get('search')

		const { data, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_periodical_subscriptions')
				.select(LIST_COLUMNS)

			if (institutionId) query = query.eq('institution_id', institutionId)
			if (subscriptionStatus) query = query.eq('subscription_status', subscriptionStatus)
			if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

			return query.order('created_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error fetching periodical subscriptions:', error)
			return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
		}

		let result = data || []

		if (search) {
			const term = search.toLowerCase()
			result = result.filter(
				(s) =>
					(s.catalogue_record?.title ?? '').toLowerCase().includes(term) ||
					(s.subscription_number ?? '').toLowerCase().includes(term)
			)
		}

		return NextResponse.json(result)
	} catch (error) {
		console.error('Unexpected error fetching subscriptions:', error)
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
		if (!body.fiscal_year?.trim()) {
			return NextResponse.json({ error: 'fiscal_year is required' }, { status: 400 })
		}

		const { data, error } = await supabase
			.from('lib_periodical_subscriptions')
			.insert({
				institution_id: body.institution_id,
				catalogue_record_id: body.catalogue_record_id,
				supplier_id: body.supplier_id ?? null,
				budget_head_id: body.budget_head_id ?? null,
				subscription_number: body.subscription_number ?? null,
				subscription_type: body.subscription_type ?? null,
				frequency: body.frequency ?? null,
				fiscal_year: body.fiscal_year.trim(),
				start_date: body.start_date ?? null,
				end_date: body.end_date ?? null,
				subscription_cost: body.subscription_cost ?? null,
				currency_code: body.currency_code ?? 'INR',
				start_volume: body.start_volume ?? null,
				start_issue: body.start_issue ?? null,
				expected_issues: body.expected_issues ?? null,
				received_issues: 0,
				access_url: body.access_url ?? null,
				login_id: body.login_id ?? null,
				password_hint: body.password_hint ?? null,
				subscription_status: body.subscription_status ?? 'active',
				is_gratis: body.is_gratis ?? false,
			})
			.select()
			.single()

		if (error) {
			console.error('Error creating subscription:', error)
			if (error.code === '23503') {
				return NextResponse.json({ error: 'Invalid reference — check catalogue_record_id or supplier_id' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
		}

		// The year's issues, laid out now rather than recorded one at a time as
		// they arrive. Until this, the register could only say what had come and
		// never what was owed — an issue that never turned up looked exactly like
		// one nobody had entered yet.
		//
		// A failure here does not fail the subscription: it is reported alongside
		// it, and the librarian can still enter issues by hand.
		const issues = await createExpectedIssues(supabase, {
			id: data.id,
			institution_id: data.institution_id,
			start_volume: data.start_volume ?? null,
			expected_issues: data.expected_issues ?? null,
		})

		return NextResponse.json(
			{ ...data, expected_issues_created: issues.created, issues_warning: issues.reason },
			{ status: 201 }
		)
	} catch (error) {
		console.error('Unexpected error creating subscription:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
