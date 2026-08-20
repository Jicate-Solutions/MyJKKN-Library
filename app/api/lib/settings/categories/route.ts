/**
 * Borrowing rules per member category, for one institution.
 *
 * GET    /api/lib/settings/categories?institution_id=…
 * POST   /api/lib/settings/categories          create or update one category
 * DELETE /api/lib/settings/categories?id=…
 *
 * These five numbers — books, days, renewals, fine per day, holds — are what
 * the circulation desk reads on every issue, renew and return. They are stored
 * per institution, so Pharmacy's 15 days and Rs.5 never reach another campus.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { logActivity, fetchOldValues } from '@/lib/library/activity-log'

/** The codes lib_members actually stores, so a lookup can never miss. */
const VALID_CODES = ['learner', 'facilitator', 'other', 'team_member', 'guest', 'alumni']

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const supabase = getSupabaseServer()
		let query = supabase
			.from('lib_member_categories')
			.select('*')
			.order('category_name', { ascending: true })

		if (guard.institutionId) query = query.eq('institution_id', guard.institutionId)

		const { data, error } = await query.range(0, 9999)
		if (error) {
			console.error('Error listing member categories:', error)
			return NextResponse.json({ error: 'Failed to load borrowing rules' }, { status: 500 })
		}

		return NextResponse.json(data || [])
	} catch (error) {
		console.error('Unexpected error listing member categories:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change borrowing rules' }, { status: 403 })
		}

		const code = String(body.category_code ?? '').trim()
		if (!VALID_CODES.includes(code)) {
			return NextResponse.json(
				{ error: `category_code must be one of: ${VALID_CODES.join(', ')}` },
				{ status: 400 }
			)
		}

		const row = {
			institution_id: guard.institutionId,
			category_code: code,
			category_name: String(body.category_name ?? '').trim() || code,
			max_items_allowed: Number(body.max_items_allowed ?? 3),
			loan_period_days: Number(body.loan_period_days ?? 14),
			renewal_limit: Number(body.renewal_limit ?? 0),
			renewal_period_days: Number(body.renewal_period_days ?? 7),
			late_charge_per_day: Number(body.late_charge_per_day ?? 0),
			reservation_limit: Number(body.reservation_limit ?? 0),
			can_access_digital: body.can_access_digital ?? true,
		}

		for (const [field, value] of Object.entries(row)) {
			if (typeof value === 'number' && (Number.isNaN(value) || value < 0)) {
				return NextResponse.json({ error: `${field} must be zero or more` }, { status: 400 })
			}
		}

		const supabase = getSupabaseServer()

		// One row per category per institution — update in place when it exists.
		// Read in full, so the log can show what the rule was before it changed.
		const { data: existing } = await supabase
			.from('lib_member_categories')
			.select('*')
			.eq('institution_id', guard.institutionId)
			.eq('category_code', code)
			.maybeSingle()

		const { data, error } = existing
			? await supabase.from('lib_member_categories').update(row).eq('id', existing.id).select().single()
			: await supabase.from('lib_member_categories').insert(row).select().single()

		if (error) {
			console.error('Error saving member category:', error)
			return NextResponse.json({ error: 'Failed to save borrowing rule' }, { status: 500 })
		}

		await logActivity(request, {
			action: existing ? 'update' : 'create',
			resource_type: 'borrowing_rule',
			resource_id: '/settings',
			institution_id: guard.institutionId,
			old_values: existing ?? null,
			new_values: data,
			metadata: { category_code: code },
		})

		return NextResponse.json(data, { status: existing ? 200 : 201 })
	} catch (error) {
		console.error('Unexpected error saving member category:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const id = searchParams.get('id')
		if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

		const guard = await guardRecord(request, 'lib_member_categories', id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change borrowing rules' }, { status: 403 })
		}

		const supabase = getSupabaseServer()
		const before = await fetchOldValues('lib_member_categories', id)
		const { error } = await supabase.from('lib_member_categories').delete().eq('id', id)

		if (error) {
			console.error('Error deleting member category:', error)
			return NextResponse.json({ error: 'Failed to delete borrowing rule' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'delete',
			resource_type: 'borrowing_rule',
			resource_id: '/settings',
			institution_id: guard.institutionId,
			old_values: before,
			metadata: { category_code: (before?.category_code as string) ?? null },
		})

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting member category:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
