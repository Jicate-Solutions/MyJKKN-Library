/**
 * Closing the register: POST /api/lib/visits/close-day
 *
 * People walk out without scanning. Left alone, those rows stay open for ever
 * and "inside now" climbs a little every day until the number means nothing.
 *
 * With `visit_id` this closes one row — the librarian saw that person leave.
 * Without it, it closes everyone still showing as inside for the day, stamped
 * with the library's closing time rather than the moment the button was
 * pressed, because closing time is the honest answer to "when did they leave?"
 * when nobody actually knows.
 *
 * With `before_date` it closes every row still open on any day before that
 * one — the days nobody pressed the button. The gate offers this the morning
 * after, so "inside now" starts each day meaning what it says.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardWrite } from '@/lib/auth/api-guard'
import { istToday, istTimeNow } from '@/lib/library/ist-clock'
import { getInstitutionSettings } from '@/lib/library/institution-settings'

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const guard = await guardWrite(request, body.institution_id)
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const visitDate = (body.visit_date ?? '').toString().trim() || istToday()

		// One person the librarian watched leave — the time is now
		if (body.visit_id) {
			const { data, error } = await supabase
				.from('lib_member_visits')
				.update({ exit_time: istTimeNow() })
				.eq('id', body.visit_id)
				.eq('institution_id', institutionId)
				.is('exit_time', null)
				.select('id')

			if (error) {
				console.error('Error marking exit:', error)
				return NextResponse.json({ error: 'Could not mark the exit' }, { status: 500 })
			}
			if (!data || data.length === 0) {
				return NextResponse.json({ error: 'That visit is already closed' }, { status: 400 })
			}

			return NextResponse.json({ closed: 1, exit_time: istTimeNow() })
		}

		// Everyone still inside, stamped with when the library shut
		const settings = await getInstitutionSettings(institutionId)
		const closingTime = /^\d{2}:\d{2}(:\d{2})?$/.test(settings.closing_time)
			? (settings.closing_time.length === 5 ? `${settings.closing_time}:00` : settings.closing_time)
			: istTimeNow()

		// Earlier days left open — never today's, which is still being written
		const beforeDate = (body.before_date ?? '').toString().trim()
		if (beforeDate) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate) || beforeDate > istToday()) {
				return NextResponse.json({ error: 'before_date must be a date no later than today' }, { status: 400 })
			}
			const { data, error } = await supabase
				.from('lib_member_visits')
				.update({ exit_time: closingTime })
				.eq('institution_id', institutionId)
				.lt('visit_date', beforeDate)
				.not('entry_time', 'is', null)
				.is('exit_time', null)
				.select('id')

			if (error) {
				console.error('Error closing earlier days:', error)
				return NextResponse.json({ error: 'Could not close the earlier days' }, { status: 500 })
			}

			return NextResponse.json({ closed: data?.length ?? 0, exit_time: closingTime })
		}

		const { data, error } = await supabase
			.from('lib_member_visits')
			.update({ exit_time: closingTime })
			.eq('institution_id', institutionId)
			.eq('visit_date', visitDate)
			.not('entry_time', 'is', null)
			.is('exit_time', null)
			.select('id')

		if (error) {
			console.error('Error closing the day:', error)
			return NextResponse.json({ error: 'Could not close the register' }, { status: 500 })
		}

		return NextResponse.json({ closed: data?.length ?? 0, exit_time: closingTime })
	} catch (error) {
		console.error('Unexpected error closing the register:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
