/**
 * Who could be enrolled in bulk: GET /api/lib/members/bulk-candidates
 *
 * Gone with bulk enrolment itself. The question this answered — "which of this
 * programme's learners are not yet members" — has no answer any more, because
 * all of them are, the moment MyJKKN has them as Active.
 *
 * Answered rather than deleted so a page left open from before the change says
 * why, instead of failing with a bare 405.
 */

import { NextResponse } from 'next/server'

export async function GET() {
	return NextResponse.json(
		{
			error:
				'There is nobody left to enrol — every Active learner and staff member in MyJKKN is already a member of their college\'s library.',
		},
		{ status: 410 }
	)
}
