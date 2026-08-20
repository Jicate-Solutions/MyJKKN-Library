import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection, guardWrite, guardRecord } from '@/lib/auth/api-guard'
import { logActivity, fetchOldValues } from '@/lib/library/activity-log'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_members', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()

		const { data, error } = await supabase
			.from('lib_members')
			.select('*')
			.eq('id', id)
			.single()

		if (error) {
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Member not found' }, { status: 404 })
			}
			console.error('Error fetching member:', error)
			return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error fetching member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_members', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()
		const body = await request.json()

		// Never allow changing institution after creation
		delete body.institution_id
		delete body.member_number
		delete body.id

		// Read before writing — once the row is overwritten the old values are gone
		const before = await fetchOldValues('lib_members', id)

		const { data, error } = await supabase
			.from('lib_members')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating member:', error)
			await logActivity(request, {
				action: 'update',
				resource_type: 'member',
				resource_id: '/members',
				institution_id: guard.institutionId,
				old_values: before,
				status: 'error',
				error_message: error.message,
				metadata: { record_id: id },
			})
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Member not found' }, { status: 404 })
			}
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Member number already exists' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'update',
			resource_type: 'member',
			resource_id: '/members',
			institution_id: guard.institutionId,
			old_values: before,
			new_values: data,
			metadata: { record_id: id, member_number: data?.member_number },
		})

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const guard = await guardRecord(request, 'lib_members', id)
		if (!guard.ok) return guard.response
		const supabase = getSupabaseServer()

		// The whole point of a deletion line is what was deleted
		const before = await fetchOldValues('lib_members', id)

		const { error } = await supabase.from('lib_members').delete().eq('id', id)

		if (error) {
			console.error('Error deleting member:', error)
			await logActivity(request, {
				action: 'delete',
				resource_type: 'member',
				resource_id: '/members',
				institution_id: guard.institutionId,
				old_values: before,
				status: 'error',
				error_message: error.message,
				metadata: { record_id: id },
			})
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — member has active lending records' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 })
		}

		await logActivity(request, {
			action: 'delete',
			resource_type: 'member',
			resource_id: '/members',
			institution_id: guard.institutionId,
			old_values: before,
			metadata: { record_id: id, member_number: (before?.member_number as string) ?? null },
		})

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
