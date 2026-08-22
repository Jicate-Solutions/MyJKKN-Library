/**
 * One member: /api/lib/members/[id]
 *
 * There is nothing here to read, change or delete any more. A member is an
 * Active learner or staff member in MyJKKN, and MyJKKN owns all three of those
 * verbs — a name is corrected there, and someone stops being a member by
 * ceasing to be Active there.
 *
 * Answered rather than deleted so a page left open from before the change is
 * told why, instead of getting a bare 405 that reads like a fault. What the
 * library itself knows about a person — books out, fines owing — is on the
 * circulation screens, against their card number.
 */

import { NextResponse } from 'next/server'

const GONE = {
	error:
		'Members are no longer kept in the library — everyone Active in MyJKKN is already a member of their college\'s library. Names and details are changed in MyJKKN.',
}

export async function GET() {
	return NextResponse.json(GONE, { status: 410 })
}

export async function PUT() {
	return NextResponse.json(GONE, { status: 410 })
}

export async function DELETE() {
	return NextResponse.json(GONE, { status: 410 })
}
