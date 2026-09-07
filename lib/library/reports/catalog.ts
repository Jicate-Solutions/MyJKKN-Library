/**
 * Every report the Reports page offers, described — not run.
 *
 * This file is shared by the page and the server: the page draws the tabs,
 * the list and the filter boxes from it; the server checks a request against
 * it before building a query. What each report actually does lives in
 * `definitions.ts` (SQL) and `code-reports.ts` (the few that read MyJKKN),
 * which only the server loads.
 *
 * A report is picked from a tab, given its filters, run, and comes back as
 * columns and rows — the same shape whatever it is, so one table, one Excel
 * button and one Print button serve all of them.
 */

export type ParamType = 'date' | 'number' | 'text' | 'select'

export interface ParamOption {
	value: string
	label: string
}

export interface ReportParam {
	key: string
	label: string
	type: ParamType
	/** For `date`: 'today' | 'month_start' | 'year_start' | 'academic_year_start'. For others: the literal. */
	defaultValue?: string
	options?: ParamOption[]
	placeholder?: string
	/** Left empty, the filter is not applied. */
	optional?: boolean
	/** A hint under the box. */
	hint?: string
}

export interface ReportDef {
	id: string
	tab: TabId
	title: string
	/** One line under the title: what the report answers. */
	description: string
	params: ReportParam[]
	/** Columns holding money, so the table and the sheet can format them. */
	money?: string[]
}

export type TabId =
	| 'catalogue' | 'departments' | 'members' | 'circulation' | 'gate' | 'holds' | 'overdue' | 'charges'
	| 'requests' | 'orders' | 'suppliers' | 'budget' | 'subscriptions' | 'digital'
	| 'retirement' | 'intercampus' | 'conservation' | 'activity' | 'sql'

export interface ReportTab {
	id: TabId
	title: string
	/** The page the reports belong to, so the tab can say where the data is edited. */
	page: string
}

export const REPORT_TABS: ReportTab[] = [
	{ id: 'catalogue', title: 'Catalogue', page: '/registry' },
	{ id: 'departments', title: 'Department Libraries', page: '/departments' },
	{ id: 'members', title: 'Members', page: '/members' },
	{ id: 'circulation', title: 'Circulation Desk', page: '/circulation' },
	{ id: 'gate', title: 'Gate Entry', page: '/visits' },
	{ id: 'holds', title: 'Holds', page: '/circulation/holds' },
	{ id: 'overdue', title: 'Overdue', page: '/circulation/overdue' },
	{ id: 'charges', title: 'Late Charges', page: '/circulation/charges' },
	{ id: 'requests', title: 'Purchase Requests', page: '/acquisition/requests' },
	{ id: 'orders', title: 'Orders', page: '/acquisition/orders' },
	{ id: 'suppliers', title: 'Suppliers', page: '/acquisition/suppliers' },
	{ id: 'budget', title: 'Budget', page: '/acquisition/budget' },
	{ id: 'subscriptions', title: 'Subscriptions', page: '/periodicals' },
	{ id: 'digital', title: 'Digital Resources', page: '/digital' },
	{ id: 'retirement', title: 'Retirement', page: '/retirement' },
	{ id: 'intercampus', title: 'Inter-Campus', page: '/intercampus' },
	{ id: 'conservation', title: 'Conservation', page: '/conservation' },
	{ id: 'activity', title: 'Activity Log', page: '/activity-log' },
	{ id: 'sql', title: 'Run SQL', page: '/reports' },
]

// ── The filters most reports share ──────────────────────────────────────────

const FROM = (defaultValue = 'month_start'): ReportParam => ({ key: 'from', label: 'From', type: 'date', defaultValue })
const TO: ReportParam = { key: 'to', label: 'To', type: 'date', defaultValue: 'today' }
const PERIOD = (defaultValue = 'month_start'): ReportParam[] => [FROM(defaultValue), TO]

const STATUS = (options: string[], label = 'Status'): ReportParam => ({
	key: 'status',
	label,
	type: 'select',
	defaultValue: 'all',
	options: [{ value: 'all', label: 'All' }, ...options.map(value => ({ value, label: value.replace(/_/g, ' ') }))],
})

const MEMBER: ReportParam = {
	key: 'member',
	label: 'Member number',
	type: 'text',
	placeholder: 'e.g. PB23001',
	hint: 'The number on the card, as the desk scans it',
}

const DAYS = (key: string, label: string, defaultValue: string, hint?: string): ReportParam => ({
	key, label, type: 'number', defaultValue, hint,
})

const CONTAINS = (key: string, label: string, placeholder: string): ReportParam => ({
	key, label, type: 'text', placeholder, optional: true, hint: 'Any part of it; leave empty for all',
})

// ── The reports ─────────────────────────────────────────────────────────────

export const REPORTS: ReportDef[] = [
	// Catalogue
	{ id: 'cat-register', tab: 'catalogue', title: 'Accession register, full', description: 'Every copy on the shelf, every column, in accession order.', params: [CONTAINS('book_type', 'Book Type', 'e.g. Books'), CONTAINS('department', 'Department', 'e.g. Pharmaceutics')], money: ['Price (₹)'] },
	{ id: 'cat-added', tab: 'catalogue', title: 'Titles added in a period', description: 'Copies received between two dates, by date received.', params: PERIOD('year_start'), money: ['Price (₹)'] },
	{ id: 'cat-by-type', tab: 'catalogue', title: 'Titles by Book Type', description: 'How many titles and copies of each type, and what they are worth.', params: [], money: ['Value (₹)'] },
	{ id: 'cat-by-department', tab: 'catalogue', title: 'Titles by department', description: 'Titles, copies and value per owning department.', params: [], money: ['Value (₹)'] },
	{ id: 'cat-by-supplier', tab: 'catalogue', title: 'Titles by supplier', description: 'Copies and cost from each supplier.', params: [], money: ['Cost (₹)'] },
	{ id: 'cat-reference', tab: 'catalogue', title: 'Reference-only copies', description: 'Copies that never go out — marked on the copy, the title or the shelf.', params: [] },
	{ id: 'cat-by-status', tab: 'catalogue', title: 'Copies by status', description: 'Available, on loan, on hold, lost, damaged, retired, missing.', params: [STATUS(['available', 'on_loan', 'on_hold', 'on_order', 'in_conservation', 'lost', 'damaged', 'retired', 'missing'])] },
	{ id: 'cat-duplicates', tab: 'catalogue', title: 'Duplicate titles', description: 'The same title catalogued more than once.', params: [] },
	{ id: 'cat-no-isbn', tab: 'catalogue', title: 'Titles with no ISBN / ISSN', description: 'Records with neither number, for cleaning up.', params: [] },
	{ id: 'cat-stock-value', tab: 'catalogue', title: 'Stock value', description: 'Copies and their value by book type, with the total.', params: [], money: ['Price value (₹)', 'Invoice value (₹)'] },
	{ id: 'cat-no-shelf', tab: 'catalogue', title: 'Copies with no shelf location', description: 'Copies nobody has placed on a shelf yet.', params: [] },
	{ id: 'cat-most-issued', tab: 'catalogue', title: 'Most-issued titles', description: 'The fifty titles issued most often in a period.', params: PERIOD('year_start') },
	{ id: 'cat-never-issued', tab: 'catalogue', title: 'Never-issued titles', description: 'Titles no copy of which has ever gone out.', params: [] },

	// Department libraries
	{ id: 'dept-summary', tab: 'departments', title: 'Copies in each department library', description: 'Per department: copies held, how many may be issued, and the in-charge.', params: [] },
	{ id: 'dept-copies', tab: 'departments', title: 'Copies in a department library, listed', description: 'Every copy sitting in a department library.', params: [CONTAINS('department', 'Department', 'e.g. Oral Pathology')] },
	{ id: 'dept-transfers', tab: 'departments', title: 'Department transfers in a period', description: 'Copies moved to or from a department: which, where, who, when.', params: PERIOD() },

	// Members
	{ id: 'mem-roll', tab: 'members', title: 'Member roll', description: 'Every Active learner and staff member in MyJKKN, with programme or role.', params: [{ key: 'category', label: 'Category', type: 'select', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'learner', label: 'Learners' }, { value: 'facilitator', label: 'Staff' }] }] },
	{ id: 'mem-borrowed', tab: 'members', title: 'Members who have borrowed', description: 'Everyone who has ever taken a book, with what they hold and owe now.', params: [] , money: ['Owing (₹)'] },
	{ id: 'mem-owing', tab: 'members', title: 'Members owing a fine', description: 'Who owes money, and how much.', params: [], money: ['Owing (₹)'] },
	{ id: 'mem-holding', tab: 'members', title: 'Members holding a book right now', description: 'Who has what out, with the earliest due date.', params: [] },
	{ id: 'mem-nocard', tab: 'members', title: 'Members with no card number', description: 'People MyJKKN has given no number to — they cannot be scanned at the desk.', params: [] },
	{ id: 'mem-duplicate', tab: 'members', title: 'Duplicate card numbers', description: 'One number answering to more than one person.', params: [] },
	{ id: 'mem-history', tab: 'members', title: 'One member\'s history', description: 'Every issue, return, renewal, fine and visit for one person.', params: [MEMBER, ...PERIOD('year_start')], money: ['Amount (₹)'] },

	// Circulation
	{ id: 'circ-issues', tab: 'circulation', title: 'Issue register', description: 'Every book issued in a period, in time order.', params: PERIOD('today') },
	{ id: 'circ-returns', tab: 'circulation', title: 'Return register', description: 'Every book returned in a period, with how late it was.', params: PERIOD('today'), money: ['Fine (₹)'] },
	{ id: 'circ-renewals', tab: 'circulation', title: 'Renewals in a period', description: 'Loans renewed, with the due date now.', params: PERIOD() },
	{ id: 'circ-open', tab: 'circulation', title: 'Loans open right now', description: 'Everything out at this moment, with due dates and days late.', params: [] },
	{ id: 'circ-by-programme', tab: 'circulation', title: 'Loans by programme / role', description: 'Who borrows how much, by programme for learners and role for staff.', params: PERIOD('year_start') },
	{ id: 'circ-per-day', tab: 'circulation', title: 'Loans per day', description: 'Issues, returns and renewals counted by date.', params: PERIOD() },
	{ id: 'circ-no-dues', tab: 'circulation', title: 'No-dues check for one member', description: 'Books still out and fines still owed by one person.', params: [MEMBER], money: ['Owing (₹)'] },
	{ id: 'circ-by-librarian', tab: 'circulation', title: 'Desk activity by librarian', description: 'Who issued, returned and renewed how many, from the activity log.', params: PERIOD() },

	// Gate
	{ id: 'gate-register', tab: 'gate', title: 'Gate register', description: 'Every entry in a period: in, out, how long.', params: [...PERIOD('today'), { key: 'category', label: 'Category', type: 'select', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'learner', label: 'Learners' }, { value: 'facilitator', label: 'Staff' }] }] },
	{ id: 'gate-per-day', tab: 'gate', title: 'Footfall per day / month', description: 'Visits counted by day or by month.', params: [...PERIOD('year_start'), { key: 'by', label: 'Count by', type: 'select', defaultValue: 'day', options: [{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }] }] },
	{ id: 'gate-by-hour', tab: 'gate', title: 'Footfall by hour of the day', description: 'When the library is busiest.', params: PERIOD('month_start') },
	{ id: 'gate-by-programme', tab: 'gate', title: 'Footfall by programme / role', description: 'Visits by programme for learners and role for staff.', params: PERIOD('month_start') },
	{ id: 'gate-open', tab: 'gate', title: 'Still marked inside', description: 'Entries with no exit recorded, today and earlier.', params: [] },
	{ id: 'gate-person', tab: 'gate', title: 'One person\'s visits', description: 'Every visit by one member in a period.', params: [MEMBER, ...PERIOD('year_start')] },

	// Holds
	{ id: 'holds-waiting', tab: 'holds', title: 'Holds waiting', description: 'The queue for each title, in order.', params: [] },
	{ id: 'holds-ready', tab: 'holds', title: 'Holds ready for collection', description: 'Copies kept aside, and how long they have waited.', params: [] },
	{ id: 'holds-history', tab: 'holds', title: 'Holds fulfilled, cancelled or expired', description: 'How each hold ended in a period.', params: [...PERIOD(), STATUS(['fulfilled', 'cancelled', 'expired'], 'Ended as')] },
	{ id: 'holds-most-requested', tab: 'holds', title: 'Most-requested titles', description: 'Titles placed on hold most often in a period.', params: PERIOD('year_start') },

	// Overdue
	{ id: 'od-today', tab: 'overdue', title: 'Overdue today', description: 'Every loan past its due date, with days late and the fine so far.', params: [], money: ['Fine so far (₹)'] },
	{ id: 'od-by-programme', tab: 'overdue', title: 'Overdue by programme / role', description: 'Where the late books are, by programme and role.', params: [] },
	{ id: 'od-chronic', tab: 'overdue', title: 'Chronic late returners', description: 'Members late more often than a set number of times.', params: [DAYS('times', 'Late at least (times)', '3')] },

	// Late charges
	{ id: 'ch-raised', tab: 'charges', title: 'Fines raised in a period', description: 'Every charge created, with the book and the days.', params: PERIOD(), money: ['Total (₹)', 'Waived (₹)', 'Owing (₹)'] },
	{ id: 'ch-collected', tab: 'charges', title: 'Fines collected in a period', description: 'Money received, with receipt numbers — the cash book.', params: PERIOD(), money: ['Collected (₹)'] },
	{ id: 'ch-waived', tab: 'charges', title: 'Fines waived in a period', description: 'What was let off, why, and by whom.', params: PERIOD(), money: ['Total (₹)', 'Waived (₹)'] },
	{ id: 'ch-unpaid', tab: 'charges', title: 'Fines still unpaid, by age', description: 'Open charges bucketed under 30 days, 30 to 90, and over 90.', params: [], money: ['Owing (₹)'] },
	{ id: 'ch-by-month', tab: 'charges', title: 'Fine totals by month', description: 'Raised, collected and waived, month by month.', params: PERIOD('year_start'), money: ['Raised (₹)', 'Collected (₹)', 'Waived (₹)', 'Still owing (₹)'] },

	// Purchase requests
	{ id: 'pr-period', tab: 'requests', title: 'Requests in a period', description: 'Purchase requests raised, by status.', params: [...PERIOD('year_start'), STATUS(['pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled'])], money: ['Estimated (₹)'] },
	{ id: 'pr-by-department', tab: 'requests', title: 'Requests by department and requester', description: 'How many each department and person asked for.', params: PERIOD('year_start'), money: ['Estimated (₹)'] },
	{ id: 'pr-pending', tab: 'requests', title: 'Requests waiting for approval', description: 'Still pending, and for how many days.', params: [] , money: ['Estimated (₹)'] },

	// Orders
	{ id: 'po-period', tab: 'orders', title: 'Orders in a period', description: 'Orders placed, by status, with value and supplier.', params: [...PERIOD('year_start'), STATUS(['draft', 'placed', 'acknowledged', 'partially_received', 'received', 'cancelled', 'claimed'])], money: ['Value (₹)'] },
	{ id: 'po-items', tab: 'orders', title: 'Order items: received vs pending', description: 'Every line of every open order, ordered against received.', params: [CONTAINS('order', 'Order number', 'e.g. PO/2026/012')], money: ['Line total (₹)'] },
	{ id: 'po-overdue', tab: 'orders', title: 'Orders overdue from the supplier', description: 'Past the expected delivery date and not yet received.', params: [], money: ['Value (₹)'] },

	// Suppliers
	{ id: 'sup-list', tab: 'suppliers', title: 'Supplier list with totals', description: 'Orders placed, their value, and copies supplied, per supplier.', params: [], money: ['Order value (₹)'] },
	{ id: 'sup-performance', tab: 'suppliers', title: 'Supplier performance', description: 'Average days from order to receipt, and orders still open.', params: [] },

	// Budget
	{ id: 'bud-heads', tab: 'budget', title: 'Budget heads: allotted, spent, balance', description: 'Each head with what is left.', params: [CONTAINS('fiscal_year', 'Fiscal year', 'e.g. 2026')], money: ['Allocated (₹)', 'Spent (₹)', 'Committed (₹)', 'Balance (₹)'] },
	{ id: 'bud-by-month', tab: 'budget', title: 'Spend by month, by head', description: 'Order value month by month under each budget head.', params: PERIOD('year_start'), money: ['Ordered (₹)'] },
	{ id: 'bud-by-type', tab: 'budget', title: 'Spend by resource type', description: 'Books, periodicals, digital and the rest — the NAAC expenditure split.', params: [CONTAINS('fiscal_year', 'Fiscal year', 'e.g. 2026')], money: ['Allocated (₹)', 'Spent (₹)'] },

	// Subscriptions
	{ id: 'sub-list', tab: 'subscriptions', title: 'Subscription list', description: 'Every subscription with cost, supplier, frequency, expected and received issues.', params: [STATUS(['active', 'expired', 'cancelled', 'gratis', 'suspended'])], money: ['Cost (₹)'] },
	{ id: 'sub-received', tab: 'subscriptions', title: 'Issues received in a period', description: 'Each issue that arrived, by date received.', params: PERIOD() },
	{ id: 'sub-missing', tab: 'subscriptions', title: 'Issues missing', description: 'Expected and not received, per subscription.', params: [] },
	{ id: 'sub-expiring', tab: 'subscriptions', title: 'Subscriptions expiring soon', description: 'Ending within a number of days from today.', params: [DAYS('days', 'Within (days)', '30')], money: ['Cost (₹)'] },
	{ id: 'sub-gratis', tab: 'subscriptions', title: 'Gratis subscriptions', description: 'Received free of charge.', params: [] },
	{ id: 'sub-by-year', tab: 'subscriptions', title: 'Subscription cost by fiscal year', description: 'Paid subscriptions and their cost, year by year.', params: [], money: ['Cost (₹)'] },

	// Digital
	{ id: 'dig-list', tab: 'digital', title: 'Digital resource list', description: 'Type, provider, cost and access dates for each resource.', params: [], money: ['Annual cost (₹)'] },
	{ id: 'dig-expiring', tab: 'digital', title: 'Digital resources expiring soon', description: 'Access ending within a number of days from today.', params: [DAYS('days', 'Within (days)', '60')], money: ['Annual cost (₹)'] },

	// Retirement
	{ id: 'ret-period', tab: 'retirement', title: 'Retirement requests in a period', description: 'Copies put up for withdrawal, by status and reason.', params: [...PERIOD('year_start'), STATUS(['pending', 'approved', 'rejected', 'completed'])], money: ['Price (₹)'] },
	{ id: 'ret-withdrawn', tab: 'retirement', title: 'Withdrawn and lost copies', description: 'Copies no longer on the shelf, with the value written off.', params: [], money: ['Price (₹)'] },

	// Inter-campus
	{ id: 'ic-period', tab: 'intercampus', title: 'Inter-campus requests in a period', description: 'Books asked for from another campus, by status.', params: [...PERIOD('year_start'), STATUS(['pending', 'approved', 'dispatched', 'received', 'returned', 'rejected', 'lost'])] },
	{ id: 'ic-out', tab: 'intercampus', title: 'Books out at another campus right now', description: 'Dispatched or received and not yet returned.', params: [] },

	// Conservation
	{ id: 'con-period', tab: 'conservation', title: 'Conservation requests in a period', description: 'Binding, repair, lamination and digitisation, by status.', params: [...PERIOD('year_start'), STATUS(['identified', 'sent', 'returned', 'cancelled'])], money: ['Cost (₹)'] },
	{ id: 'con-away', tab: 'conservation', title: 'Copies away for binding or repair', description: 'Sent out and not yet back, with the expected return.', params: [], money: ['Cost (₹)'] },

	// Activity
	{ id: 'act-period', tab: 'activity', title: 'Actions in a period, by user and type', description: 'What each user did, counted by action and record type.', params: PERIOD() },
	{ id: 'act-logins', tab: 'activity', title: 'Logins per user per day', description: 'Who signed in on which day.', params: PERIOD() },
]

export const reportById = (id: string): ReportDef | undefined => REPORTS.find(r => r.id === id)

export const reportsInTab = (tab: TabId): ReportDef[] => REPORTS.filter(r => r.tab === tab)

// ── Filling in a filter's default ───────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The academic year runs June to May. */
export function defaultParamValue(param: ReportParam, now = new Date()): string {
	if (param.type !== 'date') return param.defaultValue ?? ''
	switch (param.defaultValue) {
		case 'month_start': return iso(new Date(now.getFullYear(), now.getMonth(), 1))
		case 'year_start': return iso(new Date(now.getFullYear(), 0, 1))
		case 'academic_year_start': {
			const start = now.getMonth() + 1 >= 6 ? now.getFullYear() : now.getFullYear() - 1
			return `${start}-06-01`
		}
		case 'today':
		default:
			return iso(now)
	}
}

export function defaultParams(report: ReportDef, now = new Date()): Record<string, string> {
	const values: Record<string, string> = {}
	for (const param of report.params) values[param.key] = defaultParamValue(param, now)
	return values
}

// ── Sample queries for the SQL tab ──────────────────────────────────────────

export interface SqlSample {
	title: string
	sql: string
}

export const SQL_SAMPLES: SqlSample[] = [
	{
		title: 'Copies by status',
		sql: `select status, count(*) as copies
from lib_items
where is_active
group by status
order by copies desc`,
	},
	{
		title: 'Titles per department',
		sql: `select coalesce(department, '(not set)') as department, count(*) as titles
from lib_catalogue_records
where is_active
group by 1
order by titles desc`,
	},
	{
		title: 'Books out right now',
		sql: `select b.member_number, b.display_name, c.title, i.accession_number, t.due_date
from lib_lending_transactions t
join lib_borrowers b on b.id = t.member_id
join lib_items i on i.id = t.item_id
join lib_catalogue_records c on c.id = i.catalogue_record_id
where t.transaction_status in ('active', 'overdue')
order by t.due_date`,
	},
	{
		title: 'Fines owing per member',
		sql: `select b.member_number, b.display_name, sum(lc.net_payable) as owing
from lib_late_charges lc
join lib_borrowers b on b.id = lc.member_id
where lc.payment_status in ('unpaid', 'partial')
group by 1, 2
order by owing desc`,
	},
	{
		title: 'Footfall this month',
		sql: `select visit_date, count(*) as visits
from lib_member_visits
where visit_date >= date_trunc('month', current_date)
group by visit_date
order by visit_date`,
	},
	{
		title: 'Subscriptions and issues received',
		sql: `select c.title, s.frequency, s.expected_issues, s.received_issues, s.subscription_cost
from lib_periodical_subscriptions s
join lib_catalogue_records c on c.id = s.catalogue_record_id
order by c.title`,
	},
]

/** The tables a typed query may use — shown beside the box. */
export const SQL_TABLES: { name: string; note: string }[] = [
	{ name: 'lib_catalogue_records', note: 'titles: title, author, book_type, department, isbn, issn, call_number' },
	{ name: 'lib_items', note: 'copies: accession_number, status, price, catalogue_record_id, location_id, supplier_id' },
	{ name: 'lib_locations', note: 'shelves and department libraries: location_name, location_kind, department_name' },
	{ name: 'lib_borrowers', note: 'people who have borrowed: member_number, display_name, member_category, is_delinquent' },
	{ name: 'lib_lending_transactions', note: 'loans: item_id, member_id, issued_at, due_date, returned_at, renewal_count, transaction_status' },
	{ name: 'lib_late_charges', note: 'fines: transaction_id, member_id, total_charge, waiver_amount, net_payable, payment_status' },
	{ name: 'lib_resource_holds', note: 'holds: catalogue_record_id, member_id, hold_status, hold_placed_at' },
	{ name: 'lib_member_visits', note: 'gate: member_number, display_name, visit_date, entry_time, exit_time' },
	{ name: 'lib_procurement_requests', note: 'purchase requests: title, department, request_status, estimated_price' },
	{ name: 'lib_procurement_orders', note: 'orders: order_number, supplier_id, order_date, total_amount, order_status' },
	{ name: 'lib_procurement_items', note: 'order lines: order_id, title, quantity_ordered, quantity_received' },
	{ name: 'lib_suppliers', note: 'supplier_name, city, is_active' },
	{ name: 'lib_budget_heads', note: 'fiscal_year, budget_head_name, resource_type, allocated_amount, spent_amount' },
	{ name: 'lib_periodical_subscriptions', note: 'catalogue_record_id, frequency, fiscal_year, subscription_cost, expected_issues, received_issues, is_gratis' },
	{ name: 'lib_periodical_issues', note: 'subscription_id, volume_number, issue_number, received_date, receipt_status' },
	{ name: 'lib_digital_resources', note: 'resource_title, resource_type, provider, annual_cost, subscription_end' },
	{ name: 'lib_retirement_requests', note: 'item_id, reason, retirement_status' },
	{ name: 'lib_intercampus_requests', note: 'title, providing_institution_id, request_status, request_date' },
	{ name: 'lib_conservation_requests', note: 'item_id, conservation_type, conservation_status, binding_cost' },
	{ name: 'lib_department_transfers', note: 'item_id, direction, department_name, moved_at' },
	{ name: 'lib_activity_log', note: 'user_id, action, resource_type, created_at' },
	{ name: 'colleges', note: 'every college: id, institution_code, name' },
	{ name: 'users', note: 'id, email, full_name' },
]
