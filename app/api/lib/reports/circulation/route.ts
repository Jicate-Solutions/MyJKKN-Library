/**
 * Every report a librarian can draw from the circulation log.
 *
 * GET /api/lib/reports/circulation?report=<name>&from=&to=&…
 *
 * WHY ONE ROUTE AND NOT FOURTEEN
 *
 * The reports differ in how they group the same handful of rows, not in what
 * they are about. Fourteen routes would be fourteen copies of the same join,
 * the same institution guard and the same date parsing, drifting apart the
 * first time one of them was fixed. So there is one route, and `report` picks
 * the shape.
 *
 * The reply DESCRIBES the report rather than assuming the page knows it:
 *
 *   { columns: [{ key, label, type }], rows: [...], totals, meta }
 *
 * The page renders whatever columns come back and exports the same. That is
 * what makes "add another report" a change here and nowhere else — no new
 * table component, no new export code, no new column list in the browser.
 *
 * Three of the reports deliberately ignore the date range, because they are a
 * state and not a period: what is on loan right now, what is overdue right now,
 * and what has never been borrowed at all. Filtering those by date would answer
 * a question nobody asked.
 *
 * Institution scope comes from `guardCollection` like every other route, so one
 * college's report can never contain another's rows.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'
import { staffById } from '@/lib/auth/myjkkn-staff'

/** How a column should be drawn and exported. */
type ColumnType = 'text' | 'number' | 'money' | 'date' | 'datetime'

interface Column {
	key: string
	label: string
	type: ColumnType
}

interface ReportResult {
	columns: Column[]
	rows: Record<string, any>[]
	/** Headline figures for the cards above the table. */
	totals: { label: string; value: string | number; type?: ColumnType }[]
	/** True when the date range does not apply — a state, not a period. */
	ignoresDateRange?: boolean
	note?: string
}

/** Every report this route can produce, in the order the screen lists them. */
export const REPORTS = [
	'transactions',
	'daily',
	'monthly',
	'on_loan',
	'overdue',
	'by_member',
	'top_borrowers',
	'by_category',
	'most_borrowed',
	'never_borrowed',
	'fines',
	'desk_activity',
	'by_location',
	'by_format',
] as const

type ReportName = (typeof REPORTS)[number]

const isReport = (value: unknown): value is ReportName =>
	(REPORTS as readonly string[]).includes(String(value))

// ── Reading the rows every report is built from ─────────────────────────────

/**
 * The join used everywhere below.
 *
 * Written once because every report needs the same three things about a loan —
 * who took it, which copy, and what that copy is — and a report that quietly
 * selected less would show blank titles rather than fail.
 */
const LOAN_SELECT = `
	id, issued_at, due_date, returned_at, renewal_count, last_renewed_at,
	transaction_status, issued_by, returned_by, return_condition, member_id, item_id,
	member:lib_borrowers(id, member_number, display_name, member_category, person_kind, email),
	item:lib_items(
		id, accession_number, barcode, price, condition, status,
		location:lib_locations(location_code, location_name, section, floor),
		catalogue:lib_catalogue_records(id, title, resource_format, publisher_name, publication_year, call_number, classification_number)
	)
`

const text = (value: unknown): string => (value ?? '').toString().trim()

/** `fetchAllRows` types its error as unknown, so it is read rather than assumed. */
function reason(error: unknown): string {
	if (error && typeof error === 'object' && 'message' in error) return String((error as any).message)
	return String(error)
}

/** A loan row flattened into the fields the reports actually name. */
function flatten(row: any) {
	const member = row.member ?? {}
	const item = row.item ?? {}
	const catalogue = item.catalogue ?? {}
	const location = item.location ?? {}

	return {
		id: row.id,
		issued_at: row.issued_at,
		due_date: row.due_date,
		returned_at: row.returned_at,
		renewal_count: row.renewal_count ?? 0,
		last_renewed_at: row.last_renewed_at,
		transaction_status: row.transaction_status,
		issued_by: row.issued_by,
		returned_by: row.returned_by,
		member_id: row.member_id,
		member_number: text(member.member_number) || '—',
		member_name: text(member.display_name) || '—',
		member_category: text(member.member_category) || '—',
		person_kind: text(member.person_kind) || '—',
		item_id: row.item_id,
		accession_number: text(item.accession_number) || '—',
		price: item.price ?? null,
		catalogue_id: catalogue.id ?? null,
		title: text(catalogue.title) || '—',
		resource_format: text(catalogue.resource_format) || '—',
		publisher_name: text(catalogue.publisher_name) || '—',
		publication_year: catalogue.publication_year ?? null,
		call_number: text(catalogue.call_number) || '—',
		location_code: text(location.location_code) || '—',
		location_name: text(location.location_name) || '—',
		section: text(location.section) || '—',
	}
}

type Loan = ReturnType<typeof flatten>

/** Days between two dates, floored, never negative. */
function daysBetween(later: Date, earlier: Date): number {
	const ms = later.getTime() - earlier.getTime()
	return ms <= 0 ? 0 : Math.floor(ms / 86_400_000)
}

/** How many days past its due date a loan is, as of now or as of its return. */
function overdueDays(loan: Loan): number {
	const due = new Date(`${loan.due_date}T23:59:59Z`)
	const end = loan.returned_at ? new Date(loan.returned_at) : new Date()
	return daysBetween(end, due)
}

/** Sorts a grouped report so the biggest number is on top. */
function byDesc<T extends Record<string, any>>(rows: T[], key: keyof T): T[] {
	return [...rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))
}

/**
 * The names behind `issued_by` and `returned_by`.
 *
 * These are MyJKKN staff ids. A desk has a handful of people, so the distinct
 * set is tiny — but it is capped anyway, because a report is not worth a
 * hundred round trips, and an unresolved id is still shown rather than hidden.
 */
const MAX_NAME_LOOKUPS = 25

async function staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
	const wanted = [...new Set(ids.filter((id): id is string => !!id))].slice(0, MAX_NAME_LOOKUPS)
	const names = new Map<string, string>()

	await Promise.all(wanted.map(async id => {
		const staff = await staffById(id).catch(() => null)
		if (staff) names.set(id, staff.fullName || staff.email || id)
	}))

	return names
}

// ── The reports ─────────────────────────────────────────────────────────────

function reportTransactions(loans: Loan[], names: Map<string, string>): ReportResult {
	const rows = loans.map(loan => ({
		issued_at: loan.issued_at,
		member_number: loan.member_number,
		member_name: loan.member_name,
		member_category: loan.member_category,
		accession_number: loan.accession_number,
		title: loan.title,
		due_date: loan.due_date,
		returned_at: loan.returned_at,
		renewal_count: loan.renewal_count,
		status: loan.returned_at
			? 'Returned'
			: overdueDays(loan) > 0
				? `Overdue ${overdueDays(loan)}d`
				: 'On loan',
		issued_by: loan.issued_by ? (names.get(loan.issued_by) ?? '—') : '—',
		returned_by: loan.returned_by ? (names.get(loan.returned_by) ?? '—') : '—',
	}))

	const returned = loans.filter(l => l.returned_at).length
	const renewed = loans.filter(l => l.renewal_count > 0).length

	return {
		columns: [
			{ key: 'issued_at', label: 'Issued', type: 'datetime' },
			{ key: 'member_number', label: 'Member #', type: 'text' },
			{ key: 'member_name', label: 'Member', type: 'text' },
			{ key: 'member_category', label: 'Category', type: 'text' },
			{ key: 'accession_number', label: 'Accession', type: 'text' },
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'due_date', label: 'Due', type: 'date' },
			{ key: 'returned_at', label: 'Returned', type: 'datetime' },
			{ key: 'renewal_count', label: 'Renewals', type: 'number' },
			{ key: 'status', label: 'Status', type: 'text' },
			{ key: 'issued_by', label: 'Issued by', type: 'text' },
			{ key: 'returned_by', label: 'Returned by', type: 'text' },
		],
		rows,
		totals: [
			{ label: 'Transactions', value: loans.length, type: 'number' },
			{ label: 'Returned', value: returned, type: 'number' },
			{ label: 'Still out', value: loans.length - returned, type: 'number' },
			{ label: 'Renewed at least once', value: renewed, type: 'number' },
		],
	}
}

/** Activity per day or per month. Both are the same count, keyed differently. */
function reportActivity(loans: Loan[], mode: 'daily' | 'monthly'): ReportResult {
	const width = mode === 'daily' ? 10 : 7
	const buckets = new Map<string, { issues: number; returns: number; renewals: number; members: Set<string> }>()

	const bucket = (key: string) => {
		if (!buckets.has(key)) {
			buckets.set(key, { issues: 0, returns: 0, renewals: 0, members: new Set() })
		}
		return buckets.get(key)!
	}

	for (const loan of loans) {
		const issued = bucket(loan.issued_at.substring(0, width))
		issued.issues++
		issued.members.add(loan.member_id)
		if (loan.renewal_count > 0) issued.renewals += loan.renewal_count

		// A return belongs to the day it happened, not the day the book went out
		if (loan.returned_at) bucket(loan.returned_at.substring(0, width)).returns++
	}

	const rows = [...buckets.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([period, stats]) => ({
			period,
			issues: stats.issues,
			returns: stats.returns,
			renewals: stats.renewals,
			unique_members: stats.members.size,
		}))

	return {
		columns: [
			{ key: 'period', label: mode === 'daily' ? 'Date' : 'Month', type: 'text' },
			{ key: 'issues', label: 'Issued', type: 'number' },
			{ key: 'returns', label: 'Returned', type: 'number' },
			{ key: 'renewals', label: 'Renewals', type: 'number' },
			{ key: 'unique_members', label: 'Members', type: 'number' },
		],
		rows,
		totals: [
			{ label: mode === 'daily' ? 'Days with activity' : 'Months with activity', value: rows.length, type: 'number' },
			{ label: 'Issued', value: loans.length, type: 'number' },
			{ label: 'Returned', value: loans.filter(l => l.returned_at).length, type: 'number' },
			{
				label: mode === 'daily' ? 'Busiest day' : 'Busiest month',
				value: rows.length ? byDesc(rows, 'issues')[0].period : '—',
			},
		],
	}
}

function reportOnLoan(loans: Loan[]): ReportResult {
	const rows = loans.map(loan => {
		const late = overdueDays(loan)
		return {
			member_number: loan.member_number,
			member_name: loan.member_name,
			member_category: loan.member_category,
			accession_number: loan.accession_number,
			title: loan.title,
			issued_at: loan.issued_at,
			due_date: loan.due_date,
			days_out: daysBetween(new Date(), new Date(loan.issued_at)),
			overdue_days: late,
			renewal_count: loan.renewal_count,
			location_name: loan.location_name,
		}
	})

	const late = rows.filter(r => r.overdue_days > 0).length

	return {
		columns: [
			{ key: 'member_number', label: 'Member #', type: 'text' },
			{ key: 'member_name', label: 'Member', type: 'text' },
			{ key: 'member_category', label: 'Category', type: 'text' },
			{ key: 'accession_number', label: 'Accession', type: 'text' },
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'issued_at', label: 'Issued', type: 'datetime' },
			{ key: 'due_date', label: 'Due', type: 'date' },
			{ key: 'days_out', label: 'Days out', type: 'number' },
			{ key: 'overdue_days', label: 'Overdue by', type: 'number' },
			{ key: 'renewal_count', label: 'Renewals', type: 'number' },
			{ key: 'location_name', label: 'Shelf', type: 'text' },
		],
		rows: byDesc(rows, 'days_out'),
		totals: [
			{ label: 'Books out now', value: rows.length, type: 'number' },
			{ label: 'Of those, overdue', value: late, type: 'number' },
			{ label: 'Members holding them', value: new Set(rows.map(r => r.member_number)).size, type: 'number' },
		],
		ignoresDateRange: true,
		note: 'What is out right now, whatever the date range says — this is a state, not a period.',
	}
}

function reportOverdue(loans: Loan[], rates: Map<string, number>): ReportResult {
	// Each member category sets its own rate, so a facilitator and a learner
	// overdue by the same week do not owe the same amount
	const rateFor = (category: string) => rates.get(category) ?? rates.get('learner') ?? 1

	const rows = loans
		.map(loan => {
			const late = overdueDays(loan)
			const finePerDay = rateFor(loan.member_category)
			return {
				member_number: loan.member_number,
				member_name: loan.member_name,
				member_category: loan.member_category,
				accession_number: loan.accession_number,
				title: loan.title,
				due_date: loan.due_date,
				overdue_days: late,
				estimated_charge: Number((late * finePerDay).toFixed(2)),
				renewal_count: loan.renewal_count,
			}
		})
		.filter(row => row.overdue_days > 0)

	const owed = rows.reduce((sum, r) => sum + r.estimated_charge, 0)

	return {
		columns: [
			{ key: 'member_number', label: 'Member #', type: 'text' },
			{ key: 'member_name', label: 'Member', type: 'text' },
			{ key: 'member_category', label: 'Category', type: 'text' },
			{ key: 'accession_number', label: 'Accession', type: 'text' },
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'due_date', label: 'Due', type: 'date' },
			{ key: 'overdue_days', label: 'Overdue by', type: 'number' },
			{ key: 'estimated_charge', label: 'Estimated charge', type: 'money' },
			{ key: 'renewal_count', label: 'Renewals', type: 'number' },
		],
		rows: byDesc(rows, 'overdue_days'),
		totals: [
			{ label: 'Overdue books', value: rows.length, type: 'number' },
			{ label: 'Members', value: new Set(rows.map(r => r.member_number)).size, type: 'number' },
			{ label: 'Estimated charges', value: Number(owed.toFixed(2)), type: 'money' },
			{ label: 'Longest overdue', value: rows.length ? `${rows[0].overdue_days} days` : '—' },
		],
		ignoresDateRange: true,
		note: 'Overdue as of today. The charge is an estimate at the current rate — the Late Charges screen holds what was actually raised.',
	}
}

function reportByMember(loans: Loan[]): ReportResult {
	const map = new Map<string, any>()

	for (const loan of loans) {
		const key = loan.member_id
		if (!map.has(key)) {
			map.set(key, {
				member_number: loan.member_number,
				member_name: loan.member_name,
				member_category: loan.member_category,
				issues: 0,
				returns: 0,
				renewals: 0,
				still_out: 0,
				overdue_now: 0,
				last_issued: loan.issued_at,
			})
		}
		const row = map.get(key)
		row.issues++
		row.renewals += loan.renewal_count
		if (loan.returned_at) row.returns++
		else {
			row.still_out++
			if (overdueDays(loan) > 0) row.overdue_now++
		}
		if (loan.issued_at > row.last_issued) row.last_issued = loan.issued_at
	}

	const rows = byDesc([...map.values()], 'issues')

	return {
		columns: [
			{ key: 'member_number', label: 'Member #', type: 'text' },
			{ key: 'member_name', label: 'Member', type: 'text' },
			{ key: 'member_category', label: 'Category', type: 'text' },
			{ key: 'issues', label: 'Borrowed', type: 'number' },
			{ key: 'returns', label: 'Returned', type: 'number' },
			{ key: 'renewals', label: 'Renewals', type: 'number' },
			{ key: 'still_out', label: 'Still out', type: 'number' },
			{ key: 'overdue_now', label: 'Overdue now', type: 'number' },
			{ key: 'last_issued', label: 'Last borrowed', type: 'datetime' },
		],
		rows,
		totals: [
			{ label: 'Members who borrowed', value: rows.length, type: 'number' },
			{ label: 'Total loans', value: loans.length, type: 'number' },
			{
				label: 'Average per member',
				value: rows.length ? Number((loans.length / rows.length).toFixed(1)) : 0,
				type: 'number',
			},
		],
	}
}

function reportTopBorrowers(loans: Loan[]): ReportResult {
	const full = reportByMember(loans)
	return {
		...full,
		rows: full.rows.slice(0, 50),
		totals: [
			...full.totals,
			{ label: 'Shown', value: Math.min(50, full.rows.length), type: 'number' },
		],
		note: 'The fifty most active members over the chosen dates.',
	}
}

function reportByCategory(loans: Loan[]): ReportResult {
	const map = new Map<string, any>()

	for (const loan of loans) {
		const key = loan.member_category
		if (!map.has(key)) {
			map.set(key, { member_category: key, issues: 0, returns: 0, still_out: 0, members: new Set<string>() })
		}
		const row = map.get(key)
		row.issues++
		row.members.add(loan.member_id)
		if (loan.returned_at) row.returns++
		else row.still_out++
	}

	const rows = byDesc(
		[...map.values()].map(row => ({
			member_category: row.member_category,
			members: row.members.size,
			issues: row.issues,
			returns: row.returns,
			still_out: row.still_out,
			per_member: row.members.size ? Number((row.issues / row.members.size).toFixed(1)) : 0,
		})),
		'issues'
	)

	return {
		columns: [
			{ key: 'member_category', label: 'Category', type: 'text' },
			{ key: 'members', label: 'Members', type: 'number' },
			{ key: 'issues', label: 'Borrowed', type: 'number' },
			{ key: 'returns', label: 'Returned', type: 'number' },
			{ key: 'still_out', label: 'Still out', type: 'number' },
			{ key: 'per_member', label: 'Per member', type: 'number' },
		],
		rows,
		totals: [
			{ label: 'Categories', value: rows.length, type: 'number' },
			{ label: 'Total loans', value: loans.length, type: 'number' },
		],
	}
}

function reportMostBorrowed(loans: Loan[]): ReportResult {
	const map = new Map<string, any>()

	for (const loan of loans) {
		const key = loan.catalogue_id ?? loan.title
		if (!map.has(key)) {
			map.set(key, {
				title: loan.title,
				resource_format: loan.resource_format,
				publisher_name: loan.publisher_name,
				publication_year: loan.publication_year,
				call_number: loan.call_number,
				issues: 0,
				copies: new Set<string>(),
				members: new Set<string>(),
			})
		}
		const row = map.get(key)
		row.issues++
		row.copies.add(loan.item_id)
		row.members.add(loan.member_id)
	}

	const rows = byDesc(
		[...map.values()].map(row => ({
			title: row.title,
			resource_format: row.resource_format,
			publisher_name: row.publisher_name,
			publication_year: row.publication_year,
			call_number: row.call_number,
			issues: row.issues,
			copies_used: row.copies.size,
			distinct_members: row.members.size,
		})),
		'issues'
	)

	return {
		columns: [
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'resource_format', label: 'Type', type: 'text' },
			{ key: 'publisher_name', label: 'Publisher', type: 'text' },
			{ key: 'publication_year', label: 'Year', type: 'number' },
			{ key: 'call_number', label: 'Call no.', type: 'text' },
			{ key: 'issues', label: 'Times borrowed', type: 'number' },
			{ key: 'copies_used', label: 'Copies used', type: 'number' },
			{ key: 'distinct_members', label: 'Different members', type: 'number' },
		],
		rows,
		totals: [
			{ label: 'Titles borrowed', value: rows.length, type: 'number' },
			{ label: 'Total loans', value: loans.length, type: 'number' },
			{ label: 'Most borrowed', value: rows.length ? rows[0].title : '—' },
		],
		note: 'Counted by title, so all copies of one book add up together.',
	}
}

function reportFines(charges: any[]): ReportResult {
	const rows = charges.map(charge => {
		const member = charge.member ?? {}
		return {
			member_number: text(member.member_number) || '—',
			member_name: text(member.display_name) || '—',
			overdue_days: charge.overdue_days ?? 0,
			charge_per_day: Number(charge.charge_per_day ?? 0),
			total_charge: Number(charge.total_charge ?? 0),
			waiver_amount: Number(charge.waiver_amount ?? 0),
			net_payable: Number(charge.net_payable ?? 0),
			payment_status: text(charge.payment_status) || '—',
			payment_date: charge.payment_date,
			created_at: charge.created_at,
		}
	})

	const sum = (key: keyof (typeof rows)[number]) =>
		Number(rows.reduce((total, row) => total + Number(row[key] ?? 0), 0).toFixed(2))

	const collected = Number(
		rows.filter(r => r.payment_status === 'paid').reduce((t, r) => t + r.net_payable, 0).toFixed(2)
	)
	const outstanding = Number(
		rows.filter(r => r.payment_status === 'unpaid' || r.payment_status === 'partial')
			.reduce((t, r) => t + r.net_payable, 0).toFixed(2)
	)

	return {
		columns: [
			{ key: 'member_number', label: 'Member #', type: 'text' },
			{ key: 'member_name', label: 'Member', type: 'text' },
			{ key: 'overdue_days', label: 'Overdue days', type: 'number' },
			{ key: 'charge_per_day', label: 'Per day', type: 'money' },
			{ key: 'total_charge', label: 'Charged', type: 'money' },
			{ key: 'waiver_amount', label: 'Waived', type: 'money' },
			{ key: 'net_payable', label: 'Payable', type: 'money' },
			{ key: 'payment_status', label: 'Status', type: 'text' },
			{ key: 'payment_date', label: 'Paid on', type: 'date' },
			{ key: 'created_at', label: 'Raised', type: 'datetime' },
		],
		rows,
		totals: [
			{ label: 'Charges raised', value: rows.length, type: 'number' },
			{ label: 'Charged', value: sum('total_charge'), type: 'money' },
			{ label: 'Collected', value: collected, type: 'money' },
			{ label: 'Waived', value: sum('waiver_amount'), type: 'money' },
			{ label: 'Still outstanding', value: outstanding, type: 'money' },
		],
	}
}

function reportDeskActivity(loans: Loan[], names: Map<string, string>): ReportResult {
	const map = new Map<string, any>()

	const bucket = (id: string | null) => {
		const key = id ?? 'unknown'
		if (!map.has(key)) {
			map.set(key, {
				staff: id ? (names.get(id) ?? id) : 'Not recorded',
				issued: 0,
				returned: 0,
			})
		}
		return map.get(key)
	}

	for (const loan of loans) {
		bucket(loan.issued_by).issued++
		if (loan.returned_at) bucket(loan.returned_by).returned++
	}

	const rows = [...map.values()]
		.map(row => ({ ...row, handled: row.issued + row.returned }))
		.sort((a, b) => b.handled - a.handled)

	return {
		columns: [
			{ key: 'staff', label: 'Staff member', type: 'text' },
			{ key: 'issued', label: 'Issued', type: 'number' },
			{ key: 'returned', label: 'Returned', type: 'number' },
			{ key: 'handled', label: 'Total handled', type: 'number' },
		],
		rows,
		totals: [
			{ label: 'People at the desk', value: rows.length, type: 'number' },
			{ label: 'Issued', value: loans.length, type: 'number' },
			{ label: 'Returned', value: loans.filter(l => l.returned_at).length, type: 'number' },
		],
		note: 'Names come from MyJKKN. A loan recorded before this system tracked the operator shows as "Not recorded".',
	}
}

function reportGroupedBy(
	loans: Loan[],
	key: 'location_name' | 'resource_format',
	label: string
): ReportResult {
	const map = new Map<string, any>()

	for (const loan of loans) {
		const group = loan[key]
		if (!map.has(group)) {
			map.set(group, { group, issues: 0, returns: 0, still_out: 0, titles: new Set<string>(), members: new Set<string>() })
		}
		const row = map.get(group)
		row.issues++
		row.titles.add(loan.catalogue_id ?? loan.title)
		row.members.add(loan.member_id)
		if (loan.returned_at) row.returns++
		else row.still_out++
	}

	const rows = byDesc(
		[...map.values()].map(row => ({
			group: row.group,
			issues: row.issues,
			returns: row.returns,
			still_out: row.still_out,
			distinct_titles: row.titles.size,
			distinct_members: row.members.size,
		})),
		'issues'
	)

	return {
		columns: [
			{ key: 'group', label, type: 'text' },
			{ key: 'issues', label: 'Borrowed', type: 'number' },
			{ key: 'returns', label: 'Returned', type: 'number' },
			{ key: 'still_out', label: 'Still out', type: 'number' },
			{ key: 'distinct_titles', label: 'Titles', type: 'number' },
			{ key: 'distinct_members', label: 'Members', type: 'number' },
		],
		rows,
		totals: [
			{ label: label + 's', value: rows.length, type: 'number' },
			{ label: 'Total loans', value: loans.length, type: 'number' },
			{ label: 'Busiest', value: rows.length ? rows[0].group : '—' },
		],
	}
}

function reportNeverBorrowed(items: any[]): ReportResult {
	const rows = items.map(item => {
		const catalogue = item.catalogue ?? {}
		const location = item.location ?? {}
		return {
			accession_number: text(item.accession_number) || '—',
			title: text(catalogue.title) || '—',
			resource_format: text(catalogue.resource_format) || '—',
			publisher_name: text(catalogue.publisher_name) || '—',
			publication_year: catalogue.publication_year ?? null,
			accession_date: item.accession_date,
			price: item.price ?? null,
			location_name: text(location.location_name) || '—',
			status: text(item.status) || '—',
		}
	})

	const value = rows.reduce((total, row) => total + Number(row.price ?? 0), 0)

	return {
		columns: [
			{ key: 'accession_number', label: 'Accession', type: 'text' },
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'resource_format', label: 'Type', type: 'text' },
			{ key: 'publisher_name', label: 'Publisher', type: 'text' },
			{ key: 'publication_year', label: 'Year', type: 'number' },
			{ key: 'accession_date', label: 'Accessioned', type: 'date' },
			{ key: 'price', label: 'Price', type: 'money' },
			{ key: 'location_name', label: 'Shelf', type: 'text' },
			{ key: 'status', label: 'Status', type: 'text' },
		],
		rows,
		totals: [
			{ label: 'Copies never borrowed', value: rows.length, type: 'number' },
			{ label: 'Money sitting on the shelf', value: Number(value.toFixed(2)), type: 'money' },
		],
		ignoresDateRange: true,
		note: 'Copies that have never been issued even once, at any time — not just within the chosen dates.',
	}
}

// ── The route ───────────────────────────────────────────────────────────────

/** Default window when the screen has not asked for one: the last 30 days. */
function defaultRange(): { from: string; to: string } {
	const today = new Date()
	const from = new Date(today)
	from.setDate(today.getDate() - 29)
	return {
		from: from.toISOString().substring(0, 10),
		to: today.toISOString().substring(0, 10),
	}
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		if (!institutionId) {
			return NextResponse.json(
				{ error: 'Select a college first — a circulation report is per library' },
				{ status: 400 }
			)
		}

		const report = searchParams.get('report') ?? 'transactions'
		if (!isReport(report)) {
			return NextResponse.json(
				{ error: `Unknown report. Expected one of: ${REPORTS.join(', ')}` },
				{ status: 400 }
			)
		}

		const fallback = defaultRange()
		const from = DATE.test(searchParams.get('from') ?? '') ? searchParams.get('from')! : fallback.from
		const to = DATE.test(searchParams.get('to') ?? '') ? searchParams.get('to')! : fallback.to

		const category = text(searchParams.get('category'))
		const search = text(searchParams.get('search')).toLowerCase()

		const supabase = getSupabaseServer()

		// Never-borrowed is about the shelf, not the log, so it never touches the
		// transaction table beyond asking which item ids have ever appeared in it
		if (report === 'never_borrowed') {
			const [{ data: everLent }, { data: items, error }] = await Promise.all([
				fetchAllRows<{ item_id: string }>(range => supabase
					.from('lib_lending_transactions')
					.select('item_id')
					.eq('institution_id', institutionId)
					.range(range.from, range.to)),
				fetchAllRows<Record<string, any>>(range => supabase
					.from('lib_items')
					.select(`
						id, accession_number, accession_date, price, status,
						location:lib_locations(location_name),
						catalogue:lib_catalogue_records(title, resource_format, publisher_name, publication_year)
					`)
					.eq('institution_id', institutionId)
					.eq('is_active', true)
					.order('accession_number', { ascending: true })
					.range(range.from, range.to)),
			])

			if (error) {
				console.error('Error reading items for the never-borrowed report:', reason(error))
				return NextResponse.json({ error: 'Failed to build the report' }, { status: 500 })
			}

			const lent = new Set((everLent ?? []).map(row => row.item_id))
			const idle = (items ?? []).filter(item => !lent.has(item.id))

			return NextResponse.json({
				report,
				from,
				to,
				institution_id: institutionId,
				generated_at: new Date().toISOString(),
				...reportNeverBorrowed(idle),
			})
		}

		// Fines read their own table
		if (report === 'fines') {
			const { data: charges, error } = await fetchAllRows<Record<string, any>>(range => supabase
				.from('lib_late_charges')
				.select(`
					id, overdue_days, charge_per_day, total_charge, waiver_amount, net_payable,
					payment_status, payment_date, created_at,
					member:lib_borrowers(member_number, display_name, member_category)
				`)
				.eq('institution_id', institutionId)
				.gte('created_at', `${from}T00:00:00Z`)
				.lte('created_at', `${to}T23:59:59Z`)
				.order('created_at', { ascending: false })
				.range(range.from, range.to))

			if (error) {
				console.error('Error reading late charges:', reason(error))
				return NextResponse.json({ error: 'Failed to build the report' }, { status: 500 })
			}

			const filtered = (charges ?? []).filter(charge => {
				if (category && text(charge.member?.member_category) !== category) return false
				if (!search) return true
				return [charge.member?.member_number, charge.member?.display_name]
					.some(value => text(value).toLowerCase().includes(search))
			})

			return NextResponse.json({
				report,
				from,
				to,
				institution_id: institutionId,
				generated_at: new Date().toISOString(),
				...reportFines(filtered),
			})
		}

		// Everything else is built from the loans themselves. Two of the reports
		// are a state rather than a period, so they read every open loan instead
		// of the chosen window.
		const stateOnly = report === 'on_loan' || report === 'overdue'

		const { data: raw, error } = await fetchAllRows<Record<string, any>>(range => {
			let query = supabase
				.from('lib_lending_transactions')
				.select(LOAN_SELECT)
				.eq('institution_id', institutionId)

			if (stateOnly) query = query.is('returned_at', null)
			else query = query
				.gte('issued_at', `${from}T00:00:00Z`)
				.lte('issued_at', `${to}T23:59:59Z`)

			return query.order('issued_at', { ascending: false }).range(range.from, range.to)
		})

		if (error) {
			console.error('Error reading the circulation log:', reason(error))
			return NextResponse.json({ error: 'Failed to build the report' }, { status: 500 })
		}

		let loans = (raw ?? []).map(flatten)

		if (category) loans = loans.filter(loan => loan.member_category === category)
		if (search) {
			loans = loans.filter(loan =>
				[loan.member_number, loan.member_name, loan.accession_number, loan.title]
					.some(value => value.toLowerCase().includes(search))
			)
		}

		// Only the two reports that name a person need the lookup
		const names = report === 'transactions' || report === 'desk_activity'
			? await staffNames(loans.flatMap(loan => [loan.issued_by, loan.returned_by]))
			: new Map<string, string>()

		// The overdue estimate uses this college's own rates, one per member
		// category — every library sets its own, and they are not the same
		const rates = new Map<string, number>()
		if (report === 'overdue') {
			const { data: rules } = await supabase
				.from('lib_member_categories')
				.select('category_code, late_charge_per_day')
				.eq('institution_id', institutionId)

			for (const rule of rules ?? []) {
				const rate = Number(rule.late_charge_per_day)
				if (Number.isFinite(rate) && rate >= 0) rates.set(text(rule.category_code), rate)
			}
		}

		const built: ReportResult =
			report === 'transactions' ? reportTransactions(loans, names)
			: report === 'daily' ? reportActivity(loans, 'daily')
			: report === 'monthly' ? reportActivity(loans, 'monthly')
			: report === 'on_loan' ? reportOnLoan(loans)
			: report === 'overdue' ? reportOverdue(loans, rates)
			: report === 'by_member' ? reportByMember(loans)
			: report === 'top_borrowers' ? reportTopBorrowers(loans)
			: report === 'by_category' ? reportByCategory(loans)
			: report === 'most_borrowed' ? reportMostBorrowed(loans)
			: report === 'desk_activity' ? reportDeskActivity(loans, names)
			: report === 'by_location' ? reportGroupedBy(loans, 'location_name', 'Shelf')
			: reportGroupedBy(loans, 'resource_format', 'Type')

		return NextResponse.json({
			report,
			from,
			to,
			institution_id: institutionId,
			generated_at: new Date().toISOString(),
			...built,
		})
	} catch (error) {
		console.error('Unexpected error building a circulation report:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
