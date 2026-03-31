import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
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
		const supabase = getSupabaseServer()
		const body = await request.json()

		// Never allow changing institution after creation
		delete body.institution_id
		delete body.member_number
		delete body.id

		const { data, error } = await supabase
			.from('lib_members')
			.update({ ...body, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating member:', error)
			if (error.code === 'PGRST116') {
				return NextResponse.json({ error: 'Member not found' }, { status: 404 })
			}
			if (error.code === '23505') {
				return NextResponse.json({ error: 'Member number already exists' }, { status: 400 })
			}
			return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()

		const { error } = await supabase.from('lib_members').delete().eq('id', id)

		if (error) {
			console.error('Error deleting member:', error)
			if (error.code === '23503') {
				return NextResponse.json(
					{ error: 'Cannot delete — member has active lending records' },
					{ status: 400 }
				)
			}
			return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 })
		}

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Unexpected error deleting member:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
