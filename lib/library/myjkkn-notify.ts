/**
 * Library notices, delivered through MyJKKN: the bell, and the phone push.
 *
 * A learner does not open this app — they open MyJKKN. So when a book is
 * issued, returned or renewed, or is about to fall due, the message is put
 * where they already look: the MyJKKN bell, and a push on the phone or desktop
 * they have MyJKKN installed on. Built from MyJKKN's own guide for a child app
 * (`MyJKKN-child-app-push-notifications.md`), checked against the live tables
 * on 22 Sep 2026.
 *
 * Two deliveries, and one never causes the other:
 *
 *   * Bell — one `notifications` row and one `user_notifications` row per
 *     person. Nothing in MyJKKN turns these into a push.
 *   * Push — signed here with MyJKKN's own VAPID key pair and sent to every
 *     device in `push_subscriptions`. Devices subscribed to that pair, so no
 *     other pair is accepted (403).
 *
 * What this writes in MyJKKN, and nothing else:
 *
 *   * a new `notifications` row, and its `user_notifications` link — inserted,
 *     never updated; the link is `ON CONFLICT DO NOTHING`, so a row already
 *     there is left exactly as it was;
 *   * the deletion of one `push_subscriptions` row, only when the push service
 *     answers 410 or 404 — the device has uninstalled MyJKKN or turned
 *     notifications off, and that address will never work again.
 *
 * Every other read (`profiles` via `learners_profiles`/`staff`, the opt-out
 * register, the devices) is a read.
 *
 * The sender is the principal of the borrower's own college, fixed below —
 * never another college's, and a college with no principal here sends nothing.
 *
 * Never throws. A notice that cannot be delivered is logged and skipped: a
 * book is issued whether or not the phone buzzes.
 */

import webpush from 'web-push'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase-server'
import { istToday } from '@/lib/library/ist-clock'

const MYJKKN_URL = process.env.NEXT_PUBLIC_SUPABASE_URL1 ?? ''
/** Server-only. RLS shows a user only their own notifications and devices. */
const MYJKKN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY1 ?? ''

/** `metadata.source` on every row this app writes, and the idempotency prefix. */
const SOURCE = 'child-app:myjkkn-library'

/**
 * Who each college's notices come from: its principal's MyJKKN profile id.
 *
 * Confirmed with the library on 22 Sep 2026. Dental's principal also signs for
 * Allied Health Sciences; the College of Education's notices come from its CAO.
 */
const COLLEGE_SENDER: Record<string, string> = {
	COP: '4f2d28c1-bffe-4da6-b099-8fb0d01cf648', // DR.K.L.SENTHIL KUMAR
	CET: 'ce564f06-6e81-496e-a553-21150b3688ea', // DR. KATHIRVEL C
	CNR: '17f4d7e3-4d4d-484e-be8e-fd9a87f95656', // MRS VIMALA V
	DCH: '93547504-3029-453e-9342-5e0804d5765c', // DR DHANASEKAR BALAKRISHNAN
	AHS: '93547504-3029-453e-9342-5e0804d5765c', // DR DHANASEKAR BALAKRISHNAN
	CAS: '6a3ee559-a9ed-498e-82ea-82d56ddac884', // DR. M. NALINI
	COE: 'a196f963-8a45-415e-8fe7-f210d147a286', // DR. RAJENDIRAN K M
}

/** One message to one borrower. */
export interface LibraryNotice {
	/** The college the loan belongs to — decides the sender. */
	institutionId: string
	/** The borrower as `lib_borrowers` holds them. */
	myjkknId: string
	personKind: string
	title: string
	body: string
	/**
	 * What makes this message this message, e.g. `issued:<loan id>`. The same
	 * key is never delivered twice, so a retry, a double click or a cron that
	 * runs twice sends nothing new.
	 */
	key: string
	metadata?: Record<string, unknown>
}

export interface NoticeResult {
	bell: number
	pushed: number
	skipped: number
}

const EMPTY: NoticeResult = { bell: 0, pushed: 0, skipped: 0 }
const CHUNK = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function chunk<T>(items: T[], size = CHUNK): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

let client: SupabaseClient | null = null

function myjkknDb(): SupabaseClient | null {
	if (!MYJKKN_URL || !MYJKKN_KEY) return null
	if (!client) {
		client = createClient(MYJKKN_URL, MYJKKN_KEY, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	}
	return client
}

let vapidReady: boolean | null = null

/** MyJKKN's one VAPID pair. Missing → the bell still works, no push is sent. */
function ensureVapid(): boolean {
	if (vapidReady !== null) return vapidReady
	const pub = process.env.VAPID_PUBLIC_KEY
	const priv = process.env.VAPID_PRIVATE_KEY
	if (!pub || !priv) {
		console.warn('[myjkkn-notify] VAPID keys missing — bell only, no push')
		vapidReady = false
		return false
	}
	webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@myjkkn.com', pub, priv)
	vapidReady = true
	return true
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-25' → '25 Sep 2026' (the locale formatter says "Sept"). */
export function readableDate(dateKey: string): string {
	const date = new Date(`${dateKey.slice(0, 10)}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return dateKey
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** The same HTML-to-text MyJKKN uses for a push body. */
function plainText(body: string): string {
	return body
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

const collegeCodes = new Map<string, string | null>()

/** Our institution id → its code, read once per server. */
async function senderFor(institutionId: string): Promise<string | null> {
	if (!collegeCodes.has(institutionId)) {
		const { data } = await getSupabaseServer()
			.from('institutions')
			.select('institution_code')
			.eq('id', institutionId)
			.maybeSingle()
		collegeCodes.set(institutionId, (data?.institution_code as string | undefined) ?? null)
	}
	const code = collegeCodes.get(institutionId)
	return code ? COLLEGE_SENDER[code] ?? null : null
}

/**
 * MyJKKN `profiles.id` for each borrower, keyed `kind:myjkkn id`.
 *
 * A learner's MyJKKN id is a `learners_profiles.id` and a facilitator's a
 * `staff.id`; each carries `profile_id`. Someone who has never signed in to
 * MyJKKN has none, and cannot be sent anything.
 */
async function profileIds(db: SupabaseClient, notices: LibraryNotice[]): Promise<Map<string, string>> {
	const found = new Map<string, string>()
	// Both ids are uuids; anything else would fail the whole chunk it sits in
	const ids = (kind: string) => [...new Set(notices
		.filter(n => n.personKind === kind && UUID.test(n.myjkknId))
		.map(n => n.myjkknId))]
	const learners = ids('learner')
	const staff = ids('facilitator')

	const read = async (table: string, kind: string, ids: string[]) => {
		for (const part of chunk(ids)) {
			const { data, error } = await db.from(table).select('id, profile_id').in('id', part)
			if (error) {
				console.error(`[myjkkn-notify] reading ${table} failed`, error.message)
				continue
			}
			for (const row of (data ?? []) as { id: string; profile_id: string | null }[]) {
				if (row.profile_id) found.set(`${kind}:${row.id}`, row.profile_id)
			}
		}
	}

	await Promise.all([read('learners_profiles', 'learner', learners), read('staff', 'facilitator', staff)])
	return found
}

/** The bell link, added only if missing — an existing one is never touched. */
async function link(db: SupabaseClient, rows: { notification_id: string; user_id: string }[]) {
	for (const part of chunk(rows)) {
		const { error } = await db
			.from('user_notifications')
			.upsert(part, { onConflict: 'notification_id,user_id', ignoreDuplicates: true })
		if (error) console.error('[myjkkn-notify] bell link failed', error.message)
	}
}

interface Prepared {
	key: string
	userId: string
	row: Record<string, unknown>
}

/** Insert the notifications rows; a key someone else inserted first is skipped. */
async function insertRows(db: SupabaseClient, items: Prepared[]) {
	const made: { id: string; created_at: string; idempotency_key: string }[] = []

	for (const part of chunk(items)) {
		const { data, error } = await db
			.from('notifications')
			.insert(part.map(p => p.row))
			.select('id, created_at, idempotency_key')

		if (!error) {
			made.push(...((data ?? []) as typeof made))
			continue
		}
		if (error.code !== '23505') {
			console.error('[myjkkn-notify] notifications insert failed', error.message)
			continue
		}
		// One of the batch was sent meanwhile — the rest go one at a time
		for (const one of part) {
			const single = await db
				.from('notifications')
				.insert(one.row)
				.select('id, created_at, idempotency_key')
				.single()
			if (single.data) made.push(single.data as (typeof made)[number])
			else if (single.error?.code !== '23505') {
				console.error('[myjkkn-notify] notifications insert failed', single.error?.message)
			}
		}
	}
	return made
}

/** People who switched push off. Fails closed: a failed read sends no push. */
async function optedOut(db: SupabaseClient, userIds: string[]): Promise<Set<string> | null> {
	const out = new Set<string>()
	for (const part of chunk(userIds)) {
		const { data, error } = await db
			.from('push_notification_preferences')
			.select('user_id')
			.in('user_id', part)
			.eq('push_enabled', false)
		if (error) {
			if (error.code === '42P01' || error.code === 'PGRST205') return out
			console.error('[myjkkn-notify] opt-out read failed — no push this time', error.message)
			return null
		}
		for (const row of (data ?? []) as { user_id: string }[]) out.add(row.user_id)
	}
	return out
}

interface PushJob {
	userId: string
	payload: string
}

async function push(db: SupabaseClient, jobs: PushJob[]): Promise<number> {
	if (jobs.length === 0 || !ensureVapid()) return 0

	const users = [...new Set(jobs.map(j => j.userId))]
	const off = await optedOut(db, users)
	if (!off) return 0
	const allowed = users.filter(u => !off.has(u))
	if (allowed.length === 0) return 0

	const devices = new Map<string, { id: string; subscription: webpush.PushSubscription }[]>()
	for (const part of chunk(allowed)) {
		const { data, error } = await db
			.from('push_subscriptions')
			.select('id, user_id, subscription')
			.in('user_id', part)
			.eq('is_active', true)
		if (error) {
			console.error('[myjkkn-notify] reading devices failed', error.message)
			return 0
		}
		for (const row of (data ?? []) as { id: string; user_id: string; subscription: webpush.PushSubscription }[]) {
			const list = devices.get(row.user_id) ?? []
			list.push({ id: row.id, subscription: row.subscription })
			devices.set(row.user_id, list)
		}
	}

	let sent = 0
	const gone: string[] = []
	await Promise.allSettled(
		jobs.filter(j => !off.has(j.userId)).flatMap(job =>
			(devices.get(job.userId) ?? []).map(async device => {
				try {
					await webpush.sendNotification(device.subscription, job.payload, { TTL: 86400 })
					sent++
				} catch (err) {
					const status = (err as { statusCode?: number }).statusCode
					if (status === 410 || status === 404) gone.push(device.id)
					else console.error(`[myjkkn-notify] push failed status=${status ?? 'n/a'}`, (err as Error).message)
				}
			})
		)
	)

	// Only the addresses the push service says no longer exist
	for (const part of chunk(gone)) {
		const { error } = await db.from('push_subscriptions').delete().in('id', part)
		if (error) console.error('[myjkkn-notify] removing dead devices failed', error.message)
	}
	return sent
}

/**
 * Deliver notices to the MyJKKN bell, then to phones. Bell first: if the push
 * fails, the message is still waiting in the bell.
 */
export async function sendLibraryNotices(notices: LibraryNotice[]): Promise<NoticeResult> {
	try {
		const db = myjkknDb()
		if (!db || notices.length === 0) return { ...EMPTY, skipped: notices.length }

		const [profiles, senders] = await Promise.all([
			profileIds(db, notices),
			Promise.all([...new Set(notices.map(n => n.institutionId))].map(async id => [id, await senderFor(id)] as const)),
		])
		const senderOf = new Map(senders)

		const prepared: Prepared[] = []
		const seen = new Set<string>()
		for (const n of notices) {
			const userId = profiles.get(`${n.personKind}:${n.myjkknId}`)
			const sender = senderOf.get(n.institutionId)
			const key = `${SOURCE}:${n.key}`
			if (!userId || !sender || seen.has(key)) continue
			seen.add(key)
			prepared.push({
				key,
				userId,
				row: {
					title: n.title,
					body: n.body,
					created_by: sender,
					targeting: { user_ids: [userId] },
					kind: 'announcement',
					priority: 'normal',
					category: 'general',
					url: '/notifications',
					metadata: { source: SOURCE, ...(n.metadata ?? {}) },
					idempotency_key: key,
				},
			})
		}

		// Already delivered → only make sure the bell link is there
		const existing = new Map<string, string>()
		for (const part of chunk(prepared.map(p => p.key))) {
			const { data } = await db.from('notifications').select('id, idempotency_key').in('idempotency_key', part)
			for (const row of (data ?? []) as { id: string; idempotency_key: string }[]) existing.set(row.idempotency_key, row.id)
		}

		const fresh = prepared.filter(p => !existing.has(p.key))
		const made = await insertRows(db, fresh)
		const byKey = new Map(prepared.map(p => [p.key, p]))

		await link(db, [
			...[...existing].map(([key, id]) => ({ notification_id: id, user_id: byKey.get(key)!.userId })),
			...made.map(m => ({ notification_id: m.id, user_id: byKey.get(m.idempotency_key)!.userId })),
		])

		let pushed = 0
		try {
			pushed = await push(db, made.map(m => {
				const p = byKey.get(m.idempotency_key)!
				return {
					userId: p.userId,
					payload: JSON.stringify({
						title: p.row.title,
						body: plainText(String(p.row.body)),
						icon: '/icons/icon-192x192.png',
						url: '/notifications',
						requireInteraction: false,
						data: {
							notification_id: m.id,
							priority: 'normal',
							requires_acknowledgment: false,
							created_at: m.created_at,
						},
					}),
				}
			}))
		} catch (error) {
			console.error('[myjkkn-notify] push step failed — bell already written', error)
		}

		return { bell: made.length, pushed, skipped: notices.length - made.length }
	} catch (error) {
		console.error('[myjkkn-notify] notices not sent', error)
		return { ...EMPTY, skipped: notices.length }
	}
}

// ---------------------------------------------------------------------------
// The library's own events
// ---------------------------------------------------------------------------

interface LoanRow {
	id: string
	institution_id: string
	member_id: string
	due_date: string
	member: { myjkkn_id: string | null; person_kind: string | null } | null
	item: { accession_number: string | null; catalogue: { title: string | null } | null } | null
}

const LOAN_COLUMNS =
	'id, institution_id, member_id, due_date, member:lib_borrowers(myjkkn_id, person_kind), item:lib_items(accession_number, catalogue:lib_catalogue_records(title))'

function titleOf(loan: LoanRow): string {
	return loan.item?.catalogue?.title?.trim() || `Accession ${loan.item?.accession_number ?? ''}`.trim()
}

/**
 * The borrower's notice for one desk act: issued, returned or renewed.
 *
 * Read from the saved loan rather than passed in, so what the phone says is
 * what the library recorded. Called after the reply has gone, so the desk
 * never waits on it.
 */
export async function notifyLoan(event: 'issued' | 'returned' | 'renewed', loanId: string): Promise<void> {
	try {
		const { data } = await getSupabaseServer()
			.from('lib_lending_transactions')
			.select(LOAN_COLUMNS)
			.eq('id', loanId)
			.maybeSingle()
		const loan = data as unknown as LoanRow | null
		if (!loan?.member?.myjkkn_id || !loan.member.person_kind) return

		const title = titleOf(loan)
		const due = readableDate(loan.due_date)
		const message = {
			issued: { title: 'Book issued', body: `"${title}" is due back on ${due}.`, key: `issued:${loan.id}` },
			returned: { title: 'Book returned', body: `"${title}" has been returned. Thank you.`, key: `returned:${loan.id}` },
			// The due date is part of the key: each renewal is its own message
			renewed: { title: 'Book renewed', body: `"${title}" is now due back on ${due}.`, key: `renewed:${loan.id}:${loan.due_date.slice(0, 10)}` },
		}[event]

		await sendLibraryNotices([{
			institutionId: loan.institution_id,
			myjkknId: loan.member.myjkkn_id,
			personKind: loan.member.person_kind,
			...message,
			metadata: { event, loan_id: loan.id },
		}])
	} catch (error) {
		console.error(`[myjkkn-notify] ${event} notice not sent`, error)
	}
}

type Stage = 'due-3d' | 'due-1d' | 'due-today' | 'overdue'

function addDays(dateKey: string, days: number): string {
	const date = new Date(`${dateKey}T00:00:00Z`)
	date.setUTCDate(date.getUTCDate() + days)
	return date.toISOString().slice(0, 10)
}

/** Titles as a short list; a long one ends "and N more" to stay inside a push. */
function titleList(titles: string[]): string {
	const shown = titles.slice(0, 5).map(t => `"${t}"`)
	const rest = titles.length - shown.length
	return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
}

function reminder(stage: Stage, loans: LoanRow[], today: string): { title: string; body: string } {
	const many = loans.length > 1
	const books = many ? `${loans.length} books` : 'Book'
	const due = readableDate(loans[0].due_date)
	const titles = titleList(loans.map(titleOf))

	if (stage === 'overdue') {
		const late = loans.map(l => `"${titleOf(l)}" (due ${readableDate(l.due_date)})`)
		const listed = late.slice(0, 5).join(', ') + (late.length > 5 ? ` and ${late.length - 5} more` : '')
		return {
			title: many ? `${books} overdue` : 'Book overdue',
			body: many
				? `Please return these books to the library: ${listed}.`
				: `"${titleOf(loans[0])}" was due on ${due}. Please return it to the library.`,
		}
	}

	const when = { 'due-3d': 'in 3 days', 'due-1d': 'tomorrow', 'due-today': 'today' }[stage]
	const on = stage === 'due-today' ? `today, ${due}` : `on ${due}`
	return {
		title: `${books} due ${when}`,
		body: many ? `These books are due back ${on}: ${titles}.` : `"${titleOf(loans[0])}" is due back ${on}.`,
	}
}

/**
 * The daily reminders, run once a morning by the cron.
 *
 * Three before the due date — three days before, the day before, and on the
 * day — and one every day after it until the book comes back. One message per
 * borrower per stage, listing their books, rather than one per book.
 *
 * Every college at once, but each borrower is written to by their own
 * college's principal, and a loan is only ever grouped with loans of the same
 * college.
 */
export async function sendDailyReminders(now: Date = new Date()): Promise<NoticeResult & { loans: number }> {
	const today = istToday(now)
	const in1 = addDays(today, 1)
	const in3 = addDays(today, 3)

	const loans: LoanRow[] = []
	const supabase = getSupabaseServer()
	for (let from = 0; ; from += 1000) {
		const { data, error } = await supabase
			.from('lib_lending_transactions')
			.select(LOAN_COLUMNS)
			.in('transaction_status', ['active', 'overdue'])
			.is('returned_at', null)
			.lte('due_date', in3)
			.order('id')
			.range(from, from + 999)
		if (error) {
			console.error('[myjkkn-notify] reading loans for reminders failed', error.message)
			break
		}
		loans.push(...((data ?? []) as unknown as LoanRow[]))
		if (!data || data.length < 1000) break
	}

	const groups = new Map<string, { stage: Stage; loans: LoanRow[] }>()
	for (const loan of loans) {
		if (!loan.member?.myjkkn_id || !loan.member.person_kind) continue
		const due = loan.due_date.slice(0, 10)
		const stage: Stage | null =
			due < today ? 'overdue'
				: due === today ? 'due-today'
					: due === in1 ? 'due-1d'
						: due === in3 ? 'due-3d'
							: null
		if (!stage) continue

		// Overdue is once a day, whatever the due dates; the others once per date
		const when = stage === 'overdue' ? today : due
		const key = `${stage}:${loan.institution_id}:${loan.member_id}:${when}`
		const group = groups.get(key) ?? { stage, loans: [] }
		group.loans.push(loan)
		groups.set(key, group)
	}

	const notices: LibraryNotice[] = [...groups].map(([key, group]) => {
		const first = group.loans[0]
		return {
			institutionId: first.institution_id,
			myjkknId: first.member!.myjkkn_id!,
			personKind: first.member!.person_kind!,
			...reminder(group.stage, group.loans, today),
			key,
			metadata: { event: group.stage, loan_ids: group.loans.map(l => l.id) },
		}
	})

	const result = await sendLibraryNotices(notices)
	return { ...result, loans: loans.length }
}
