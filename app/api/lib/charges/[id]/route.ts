import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params
		const supabase = getSupabaseServer()
		const body = await request.json()

		// Validate payment_status
		const allowedStatuses = ['unpaid', 'paid', 'waived', 'partial']
		if (body.payment_status && !allowedStatuses.includes(body.payment_status)) {
			return NextResponse.json(
				{ error: `Invalid payment_status. Must be one of: ${allowedStatuses.join(', ')}` },
				{ status: 400 }
			)
		}

		// Fetch existing charge to check current state
		const { data: existing, error: fetchError } = await supabase
			.from('lib_late_charges')
			.select('*')
			.eq('id', id)
			.single()

		if (fetchError || !existing) {
			return NextResponse.json({ error: 'Charge not found' }, { status: 404 })
		}

		if (existing.payment_status === 'paid') {
			return NextResponse.json({ error: 'Charge has already been paid' }, { status: 400 })
		}

		let updateData: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		}

		if (body.payment_status === 'paid') {
			if (!body.payment_reference?.trim()) {
				return NextResponse.json({ error: 'payment_reference is required when collecting payment' }, { status: 400 })
			}
			updateData = {
				...updateData,
				payment_status: 'paid',
				payment_date: body.payment_date ?? new Date().toISOString().split('T')[0],
				payment_reference: body.payment_reference,
				collected_by: body.collected_by ?? null,
				net_payable: 0,
			}
		} else if (body.payment_status === 'waived') {
			if (!body.waiver_reason?.trim()) {
				return NextResponse.json({ error: 'waiver_reason is required when waiving a charge' }, { status: 400 })
			}
			updateData = {
				...updateData,
				payment_status: 'waived',
				waiver_amount: existing.total_charge,
				net_payable: 0,
				waiver_reason: body.waiver_reason,
				waiver_approved_by: body.waiver_approved_by ?? null,
			}
		} else if (body.payment_status === 'partial') {
			const partialAmount = Number(body.partial_payment_amount ?? 0)
			if (partialAmount <= 0) {
				return NextResponse.json({ error: 'partial_payment_amount must be > 0' }, { status: 400 })
			}
			const newNetPayable = Math.max(0, existing.net_payable - partialAmount)
			updateData = {
				...updateData,
				payment_status: newNetPayable === 0 ? 'paid' : 'partial',
				net_payable: newNetPayable,
				payment_date: body.payment_date ?? new Date().toISOString().split('T')[0],
				payment_reference: body.payment_reference ?? null,
				collected_by: body.collected_by ?? null,
			}
		}

		const { data, error } = await supabase
			.from('lib_late_charges')
			.update(updateData)
			.eq('id', id)
			.select()
			.single()

		if (error) {
			console.error('Error updating charge:', error)
			return NextResponse.json({ error: 'Failed to update charge' }, { status: 500 })
		}

		// If charge fully settled, check if member can be cleared of delinquent flag
		if (data.payment_status === 'paid' || data.payment_status === 'waived') {
			const { count: unpaidCount } = await supabase
				.from('lib_late_charges')
				.select('*', { count: 'exact', head: true })
				.eq('member_id', existing.member_id)
				.in('payment_status', ['unpaid', 'partial'])

			if ((unpaidCount ?? 0) === 0) {
				await supabase
					.from('lib_members')
					.update({ is_delinquent: false, updated_at: new Date().toISOString() })
					.eq('id', existing.member_id)
			}
		}

		return NextResponse.json(data)
	} catch (error) {
		console.error('Unexpected error updating charge:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
