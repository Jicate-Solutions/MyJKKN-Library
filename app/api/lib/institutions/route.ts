/**
 * Institutions the signed-in user may work in.
 *
 * This list drives the sidebar institution switcher, so it is the real limit on
 * what a librarian can reach: a super admin gets every institution, as does an
 * admin with no college of their own; everyone else gets exactly theirs.
 * Returning all of them here would let any user switch into another campus,
 * which is why the filter lives server-side.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCaller } from '@/lib/auth/server-access'

export async function GET(request: Request) {
	try {
		const { caller, error: callerError, status } = await getCaller(request)
		if (!caller) {
			return NextResponse.json({ error: callerError ?? 'Not signed in' }, { status: status ?? 401 })
		}

		const supabase = getSupabaseServer()

		let query = supabase
			.from('institutions')
			.select('id, institution_code, name, myjkkn_institution_ids')
			.eq('is_active', true)
			.order('name')

		// An admin with no college of their own oversees all of them, so the
		// switcher has to offer all of them — otherwise they sign in to an empty
		// list and can reach nothing.
		const spansAllInstitutions = caller.isSuperAdmin || caller.role === 'library_admin'

		if (!spansAllInstitutions) {
			if (!caller.institutionId) {
				// Nothing to switch between — better an empty list than everyone's
				return NextResponse.json([])
			}
			query = query.eq('id', caller.institutionId)
		} else if (caller.institutionId) {
			// An admin tied to one college still sees only that one
			query = query.eq('id', caller.institutionId)
		}

		const { data, error } = await query

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
