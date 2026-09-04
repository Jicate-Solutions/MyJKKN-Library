/**
 * Getting the college's roll into memory before the first card is scanned:
 * GET /api/lib/members/warm?institution_id=…
 *
 * The desk page calls this as it opens, and does not wait for the answer.
 * The first card scanned after a quiet spell used to pay the whole walk of
 * MyJKKN — a few seconds with a learner standing at the counter — because
 * nothing had asked for the roll since it went stale. Asked for here, while
 * the librarian is still reaching for the first book, it is normally in hand
 * by the time the card arrives.
 *
 * Reads only. Nothing is written anywhere; a roll already in hand costs
 * nothing at all.
 */

import { NextResponse } from 'next/server'
import { guardCollection } from '@/lib/auth/api-guard'
import { collegeDirectory, myjkknConfigured } from '@/lib/library/myjkkn-directory'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!guard.institutionId) {
			return NextResponse.json({ ok: false, reason: 'Choose a college first' }, { status: 400 })
		}
		if (!myjkknConfigured()) {
			return NextResponse.json({ ok: false, reason: 'MyJKKN is not configured' }, { status: 503 })
		}

		const people = await collegeDirectory(guard.institutionId)
		return NextResponse.json({ ok: true, members: people.length })
	} catch (error) {
		console.error('Unexpected error warming the college roll:', error)
		return NextResponse.json({ ok: false, reason: 'Internal server error' }, { status: 500 })
	}
}
