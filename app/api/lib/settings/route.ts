/**
 * One institution's library policy.
 *
 * GET  /api/lib/settings?institution_id=…   read the policy (defaults if unset)
 * PUT  /api/lib/settings                    save it
 *
 * The institution is taken from the caller's scope, never from the body, so a
 * librarian can only ever edit their own campus's rules.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite } from '@/lib/auth/api-guard'
import { logActivity, fetchOldValues } from '@/lib/library/activity-log'
import { hasAtLeast } from '@/lib/auth/server-access'
import { getInstitutionSettings, invalidateInstitutionSettings } from '@/lib/library/institution-settings'

const EDITABLE = [
	'fine_grace_days',
	'fine_max_per_item',
	'fine_working_days_only',
	'block_borrowing_when_fine_due',
	'lost_item_processing_percent',
	'member_number_source',
	'member_number_prefix',
	'opening_time',
	'closing_time',
	'requires_no_dues',
] as const

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const settings = await getInstitutionSettings(guard.institutionId)
		return NextResponse.json(settings)
	} catch (error) {
		console.error('Unexpected error reading library settings:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can change these rules' }, { status: 403 })
		}

		const update: Record<string, unknown> = { institution_id: guard.institutionId }
		for (const field of EDITABLE) {
			if (body[field] !== undefined) update[field] = body[field]
		}

		if (
			update.member_number_source !== undefined &&
			update.member_number_source !== 'auto' &&
			update.member_number_source !== 'college_id'
		) {
			return NextResponse.json(
				{ error: "member_number_source must be 'auto' or 'college_id'" },
				{ status: 400 }
			)
		}

		const supabase = getSupabaseServer()

		// The rules as they stand, so the log can show what a fine used to be
		const before = guard.institutionId
			? await fetchOldValues('lib_institution_settings', guard.institutionId, 'institution_id')
			: null

		const { data, error } = await supabase
			.from('lib_institution_settings')
			.upsert({ ...update, updated_at: new Date().toISOString() }, { onConflict: 'institution_id' })
			.select()
			.single()

		if (error) {
			console.error('Error saving library settings:', error)
			if (error.code === '42P01') {
				return NextResponse.json(
					{ error: 'Settings table not created yet — run the pending migration first' },
					{ status: 503 }
				)
			}
			return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
		}

		// The desk reads these rules from a short-lived copy; clear it so the
		// new grace period or fine cap applies to the very next issue.
		invalidateInstitutionSettings(guard.institutionId)

		await logActivity(request, {
			action: 'update',
			resource_type: 'setting',
			resource_id: '/settings',
			institution_id: guard.institutionId,
			old_values: before,
			new_values: data,
			metadata: { fields: Object.keys(update).filter(k => k !== 'institution_id') },
		})

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error saving library settings:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
