/**
 * Bulk enrolment: POST /api/lib/members/bulk
 *
 * Gone, and for the best reason: there is nothing left to enrol. Every Active
 * learner and staff member of a college is already a member of its library the
 * moment MyJKKN has them, so enrolling a programme's learners together is work
 * that no longer needs doing.
 *
 * Answered rather than deleted so a page left open from before the change says
 * why, instead of failing with a bare 405.
 */

import { NextResponse } from 'next/server'

export async function POST() {
	return NextResponse.json(
		{
			error:
				'Nobody needs enrolling any more — every Active learner and staff member in MyJKKN is already a member of their college\'s library.',
		},
		{ status: 410 }
	)
}
