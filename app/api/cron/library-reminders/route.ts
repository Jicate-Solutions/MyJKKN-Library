/**
 * The morning reminders: GET /api/cron/library-reminders
 *
 * Run by Vercel Cron at 10:00 IST (04:30 UTC, `vercel.json`). Sends every
 * college's due-soon and overdue reminders to the MyJKKN bell and phones —
 * see `sendDailyReminders` in `lib/library/myjkkn-notify.ts`.
 *
 * Nobody signs in to call it: Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`, and anything else is refused. Running it twice in a day
 * sends nothing new — every reminder carries its day in its key.
 */

import { NextResponse } from 'next/server'
import { sendDailyReminders } from '@/lib/library/myjkkn-notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
	const secret = process.env.CRON_SECRET
	if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
	}

	const result = await sendDailyReminders()
	console.log(`[library-reminders] loans=${result.loans} bell=${result.bell} pushed=${result.pushed} skipped=${result.skipped}`)
	return NextResponse.json(result)
}
