/**
 * The SQL behind each report. Server only.
 *
 * Every query here runs through `lib_report_sql`, which points it at the
 * `report` schema — one view per library table, already narrowed to the one
 * college — and forbids writing. So no query below filters by institution,
 * and none could reach another college's rows if it tried.
 *
 * Filters arrive as strings from the address bar and are checked in
 * `buildReportSql` against the report's own list before any of them is put
 * into a query: a date must look like a date, a number like a number, a
 * choice must be one of the offered choices, and free text is quoted. A
 * column whose name begins with `_` is for sorting only; the page drops it.
 */

import { reportById, type ReportDef, type ReportParam } from './catalog'

export type Params = Record<string, string>

type Builder = (p: Params) => string

// ── Small pieces every query uses ───────────────────────────────────────────

/** A text value as a SQL string literal. */
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`

/** A checked YYYY-MM-DD as a date literal. */
const date = (value: string) => `${lit(value)}::date`

/** A timestamp read as a date in the librarian's day, not UTC's. */
const istDate = (column: string) => `(${column} at time zone 'Asia/Kolkata')::date`

/** Timestamps and dates as the desk prints them. */
const showTs = (column: string) => `to_char(${column} at time zone 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI')`
const showDate = (column: string) => `to_char(${column}, 'DD-MM-YYYY')`

/** A time-of-day column. Added to a fixed date first: to_char has no format for a bare time. */
const showTime = (column: string) => `to_char('2000-01-01'::date + ${column}, 'HH24:MI')`

/** `column` falls in the From–To window, inclusive of both days. */
const tsIn = (column: string, p: Params) => `${istDate(column)} between ${date(p.from)} and ${date(p.to)}`
const dateIn = (column: string, p: Params) => `${column} between ${date(p.from)} and ${date(p.to)}`

/** Case-insensitive "contains", or nothing when the box was left empty. */
const contains = (column: string, value: string | undefined) =>
	value ? ` and ${column} ilike ${lit('%' + value + '%')}` : ''

/** A status choice, or nothing for "all". */
const statusIs = (column: string, value: string | undefined) =>
	value && value !== 'all' ? ` and ${column} = ${lit(value)}` : ''

/** Accession numbers sort by their number, so 101 comes before 1001. */
const accessionOrder = (column: string) =>
	`nullif(regexp_replace(${column}, '\\D', '', 'g'), '')::bigint nulls last, ${column}`

const CATEGORY_WORD = `case b.member_category when 'learner' then 'Learner' when 'facilitator' then 'Staff' else initcap(b.member_category) end`

/** The columns that name a copy and its title, from `i` (item) and `c` (catalogue). */
const COPY_COLUMNS = `i.accession_number as "Accession #", c.title as "Title", c.author as "Author", c.book_type as "Book Type", c.department as "Department"`

/** The columns that name a borrower, from `b`. */
const MEMBER_COLUMNS = `b.member_number as "Member #", b.display_name as "Member", ${CATEGORY_WORD} as "Category"`

// ── The queries ─────────────────────────────────────────────────────────────

const SQL: Record<string, Builder> = {

	// ── Catalogue ──

	'cat-register': p => `
select ${COPY_COLUMNS},
       c.publisher_name as "Publisher", c.edition as "Edition", c.publication_year as "Year",
       coalesce(c.isbn, c.issn) as "ISBN / ISSN", c.call_number as "Call No.", c.classification_number as "Class No.",
       i.copy_number as "Copy", i.price as "Price (₹)", i.invoice_number as "Invoice", ${showDate('i.date_received')} as "Received",
       s.supplier_name as "Supplier", l.location_name as "Shelf", i.status as "Status",
       case when i.is_lendable and not c.is_reference_only then 'Yes' else 'Reference' end as "Lendable"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_suppliers s on s.id = i.supplier_id
  left join lib_locations l on l.id = i.location_id
 where i.is_active${contains('c.book_type', p.book_type)}${contains('c.department', p.department)}
 order by ${accessionOrder('i.accession_number')}`,

	'cat-added': p => `
select ${showDate('coalesce(i.date_received, i.accession_date)')} as "Received", ${COPY_COLUMNS},
       c.publisher_name as "Publisher", i.price as "Price (₹)", i.invoice_number as "Invoice", s.supplier_name as "Supplier"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_suppliers s on s.id = i.supplier_id
 where i.is_active and coalesce(i.date_received, i.accession_date) between ${date(p.from)} and ${date(p.to)}
 order by coalesce(i.date_received, i.accession_date), ${accessionOrder('i.accession_number')}`,

	'cat-by-type': () => `
select coalesce(c.book_type, '(not set)') as "Book Type",
       count(distinct c.id) as "Titles", count(i.id) as "Copies", coalesce(sum(i.price), 0) as "Value (₹)"
  from lib_catalogue_records c
  left join lib_items i on i.catalogue_record_id = c.id and i.is_active
 where c.is_active
 group by 1
 order by 3 desc, 1`,

	'cat-by-department': () => `
select coalesce(c.department, '(not set)') as "Department",
       count(distinct c.id) as "Titles", count(i.id) as "Copies", coalesce(sum(i.price), 0) as "Value (₹)"
  from lib_catalogue_records c
  left join lib_items i on i.catalogue_record_id = c.id and i.is_active
 where c.is_active
 group by 1
 order by 3 desc, 1`,

	'cat-by-supplier': () => `
select coalesce(s.supplier_name, '(no supplier)') as "Supplier", s.city as "City",
       count(distinct i.catalogue_record_id) as "Titles", count(i.id) as "Copies",
       coalesce(sum(coalesce(i.invoice_cost, i.price)), 0) as "Cost (₹)"
  from lib_items i
  left join lib_suppliers s on s.id = i.supplier_id
 where i.is_active
 group by 1, 2
 order by 4 desc, 1`,

	'cat-reference': () => `
select ${COPY_COLUMNS}, l.location_name as "Shelf",
       case when c.is_reference_only then 'Title' when not i.is_lendable then 'Copy' else 'Shelf' end as "Marked on"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_locations l on l.id = i.location_id
 where i.is_active and (c.is_reference_only or not i.is_lendable or l.is_lendable = false)
 order by ${accessionOrder('i.accession_number')}`,

	'cat-by-status': p => `
select i.status as "Status", ${COPY_COLUMNS}, l.location_name as "Shelf", i.condition as "Condition", ${showDate('i.updated_at::date')} as "Last changed"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_locations l on l.id = i.location_id
 where i.is_active${statusIs('i.status', p.status)}
 order by i.status, ${accessionOrder('i.accession_number')}`,

	'cat-duplicates': () => `
select min(c.title) as "Title", count(*) as "Records", coalesce(sum(copies.n), 0) as "Copies",
       string_agg(coalesce(c.author, ''), ' | ') as "Authors", string_agg(coalesce(c.book_type, ''), ' | ') as "Book Types"
  from lib_catalogue_records c
  left join lateral (select count(*) as n from lib_items i where i.catalogue_record_id = c.id and i.is_active) copies on true
 where c.is_active
 group by lower(regexp_replace(c.title, '\\s+', ' ', 'g'))
having count(*) > 1
 order by 2 desc, 1`,

	'cat-no-isbn': () => `
select c.title as "Title", c.author as "Author", c.book_type as "Book Type", c.department as "Department",
       c.publisher_name as "Publisher", c.publication_year as "Year", count(i.id) as "Copies"
  from lib_catalogue_records c
  left join lib_items i on i.catalogue_record_id = c.id and i.is_active
 where c.is_active and nullif(trim(coalesce(c.isbn, '')), '') is null and nullif(trim(coalesce(c.issn, '')), '') is null
 group by c.id, c.title, c.author, c.book_type, c.department, c.publisher_name, c.publication_year
 order by c.title`,

	'cat-stock-value': () => `
select case when grouping(c.book_type) = 1 then 'Total' else coalesce(c.book_type, '(not set)') end as "Book Type",
       count(i.id) as "Copies",
       coalesce(sum(i.price), 0) as "Price value (₹)",
       coalesce(sum(coalesce(i.invoice_cost, i.price)), 0) as "Invoice value (₹)",
       case when grouping(c.book_type) = 1 then 1 else 0 end as "_total"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where i.is_active
 group by rollup(c.book_type)
 order by "_total", 2 desc`,

	'cat-no-shelf': () => `
select ${COPY_COLUMNS}, i.status as "Status", c.book_location as "Written location"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where i.is_active and i.location_id is null
 order by ${accessionOrder('i.accession_number')}`,

	'cat-most-issued': p => `
select c.title as "Title", c.author as "Author", c.book_type as "Book Type", c.department as "Department",
       count(t.id) as "Times issued", count(distinct t.member_id) as "Different members", count(distinct i.id) as "Copies used"
  from lib_lending_transactions t
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where ${tsIn('t.issued_at', p)}
 group by c.id, c.title, c.author, c.book_type, c.department
 order by 5 desc, 1
 limit 50`,

	'cat-never-issued': () => `
select c.title as "Title", c.author as "Author", c.book_type as "Book Type", c.department as "Department",
       count(i.id) as "Copies", min(${showDate('i.accession_date')}) as "First accessioned"
  from lib_catalogue_records c
  join lib_items i on i.catalogue_record_id = c.id and i.is_active
 where c.is_active
   and not exists (select 1 from lib_lending_transactions t join lib_items i2 on i2.id = t.item_id where i2.catalogue_record_id = c.id)
 group by c.id, c.title, c.author, c.book_type, c.department
 order by c.title`,

	// ── Department libraries ──

	'dept-summary': () => `
select coalesce(l.department_name, l.location_name) as "Department", l.location_name as "Library", l.incharge_name as "In-charge",
       l.incharge_designation as "Designation", count(i.id) as "Copies",
       count(i.id) filter (where i.is_lendable) as "May be issued", count(i.id) filter (where not i.is_lendable) as "Reference only",
       count(i.id) filter (where i.status = 'on_loan') as "Out now"
  from lib_locations l
  left join lib_items i on i.location_id = l.id and i.is_active
 where l.location_kind = 'department'
 group by l.id, l.department_name, l.location_name, l.incharge_name, l.incharge_designation
 order by 1`,

	'dept-copies': p => `
select coalesce(l.department_name, l.location_name) as "Department", ${COPY_COLUMNS},
       case when i.is_lendable then 'Yes' else 'Reference' end as "May be issued", i.status as "Status"
  from lib_items i
  join lib_locations l on l.id = i.location_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where i.is_active and l.location_kind = 'department'${contains('coalesce(l.department_name, l.location_name)', p.department)}
 order by 1, ${accessionOrder('i.accession_number')}`,

	'dept-transfers': p => `
select ${showTs('d.moved_at')} as "Moved", case d.direction when 'to_department' then 'To department' else 'Back to main' end as "Direction",
       d.department_name as "Department", d.accession_number as "Accession #", d.title as "Title",
       case when d.reference_only then 'Reference' else 'May be issued' end as "Marked", d.incharge_name as "In-charge",
       d.moved_by_name as "Moved by", d.remarks as "Remarks"
  from lib_department_transfers d
 where ${tsIn('d.moved_at', p)}
 order by d.moved_at desc`,

	// ── Members ──

	'mem-borrowed': () => `
select ${MEMBER_COLUMNS}, b.email as "Email",
       ${showDate('b.first_borrowed_at::date')} as "First borrowed", ${showDate('b.last_seen_at::date')} as "Last at desk",
       (select count(*) from lib_lending_transactions t where t.member_id = b.id) as "Loans ever",
       (select count(*) from lib_lending_transactions t where t.member_id = b.id and t.transaction_status in ('active', 'overdue')) as "Out now",
       coalesce((select sum(lc.net_payable) from lib_late_charges lc where lc.member_id = b.id and lc.payment_status in ('unpaid', 'partial')), 0) as "Owing (₹)"
  from lib_borrowers b
 order by b.display_name`,

	'mem-owing': () => `
select ${MEMBER_COLUMNS}, b.email as "Email", b.phone as "Phone",
       count(lc.id) as "Charges", sum(lc.net_payable) as "Owing (₹)", ${showDate('min(lc.created_at)::date')} as "Oldest charge"
  from lib_late_charges lc
  join lib_borrowers b on b.id = lc.member_id
 where lc.payment_status in ('unpaid', 'partial') and lc.net_payable > 0
 group by b.id, b.member_number, b.display_name, b.member_category, b.email, b.phone
 order by 7 desc`,

	'mem-holding': () => `
select ${MEMBER_COLUMNS}, count(t.id) as "Books out",
       ${showDate('min(t.due_date)')} as "Earliest due", count(t.id) filter (where t.due_date < current_date) as "Overdue",
       string_agg(c.title, ' | ' order by t.due_date) as "Titles"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where t.transaction_status in ('active', 'overdue')
 group by b.id, b.member_number, b.display_name, b.member_category
 order by 4 desc, 2`,

	'mem-history': p => `
with who as (select * from lib_borrowers where lower(member_number) = lower(${lit(p.member)}))
select * from (
  select 'Issued' as "Event", ${showTs('t.issued_at')} as "When", c.title as "Title", i.accession_number as "Accession #",
         'Due ' || ${showDate('t.due_date')} as "Detail", null::numeric as "Amount (₹)", t.issued_at as "_at"
    from lib_lending_transactions t join who on who.id = t.member_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
  union all
  select 'Returned', ${showTs('t.returned_at')}, c.title, i.accession_number,
         case when t.returned_at::date > t.due_date then (t.returned_at::date - t.due_date) || ' days late' else 'On time' end, null, t.returned_at
    from lib_lending_transactions t join who on who.id = t.member_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
   where t.returned_at is not null
  union all
  select 'Renewed', ${showTs('t.last_renewed_at')}, c.title, i.accession_number,
         'Renewal ' || t.renewal_count || ', now due ' || ${showDate('t.due_date')}, null, t.last_renewed_at
    from lib_lending_transactions t join who on who.id = t.member_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
   where t.last_renewed_at is not null
  union all
  select 'Fine', ${showTs('lc.created_at')}, c.title, i.accession_number,
         lc.overdue_days || ' days late · ' || lc.payment_status || coalesce(' · ' || lc.payment_reference, ''), lc.net_payable, lc.created_at
    from lib_late_charges lc join who on who.id = lc.member_id
    join lib_lending_transactions t on t.id = lc.transaction_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
  union all
  select 'Visit', ${showDate('v.visit_date')} || coalesce(' ' || ${showTime('v.entry_time')}, ''), null, null,
         case when v.exit_time is null then 'In' else 'In ' || ${showTime('v.entry_time')} || ', out ' || ${showTime('v.exit_time')} end, null,
         (v.visit_date + coalesce(v.entry_time, '00:00'::time)) at time zone 'Asia/Kolkata'
    from lib_member_visits v
   where lower(v.member_number) = lower(${lit(p.member)})
) h
where ${istDate('h."_at"')} between ${date(p.from)} and ${date(p.to)}
order by h."_at" desc`,

	// ── Circulation ──

	'circ-issues': p => `
select ${showTs('t.issued_at')} as "Issued", ${MEMBER_COLUMNS}, ${COPY_COLUMNS}, ${showDate('t.due_date')} as "Due", u.full_name as "Issued by"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join users u on u.id = t.issued_by
 where ${tsIn('t.issued_at', p)}
 order by t.issued_at`,

	'circ-returns': p => `
select ${showTs('t.returned_at')} as "Returned", ${MEMBER_COLUMNS}, ${COPY_COLUMNS},
       ${showDate('t.issued_at::date')} as "Issued", ${showDate('t.due_date')} as "Was due",
       greatest(t.returned_at::date - t.due_date, 0) as "Days late",
       coalesce((select sum(lc.total_charge) from lib_late_charges lc where lc.transaction_id = t.id), 0) as "Fine (₹)",
       u.full_name as "Returned by"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join users u on u.id = t.returned_by
 where t.returned_at is not null and ${tsIn('t.returned_at', p)}
 order by t.returned_at`,

	'circ-renewals': p => `
select ${showTs('t.last_renewed_at')} as "Renewed", ${MEMBER_COLUMNS}, ${COPY_COLUMNS},
       t.renewal_count as "Renewals so far", ${showDate('t.due_date')} as "Now due", t.transaction_status as "Status"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where t.last_renewed_at is not null and ${tsIn('t.last_renewed_at', p)}
 order by t.last_renewed_at`,

	'circ-open': () => `
select ${MEMBER_COLUMNS}, ${COPY_COLUMNS}, ${showDate('t.issued_at::date')} as "Issued", ${showDate('t.due_date')} as "Due",
       greatest(current_date - t.due_date, 0) as "Days late", t.renewal_count as "Renewals", t.transaction_status as "Status"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where t.transaction_status in ('active', 'overdue')
 order by t.due_date, b.display_name`,

	'circ-per-day': p => `
with days as (select generate_series(${date(p.from)}, ${date(p.to)}, interval '1 day')::date as day)
select ${showDate('d.day')} as "Date", to_char(d.day, 'Dy') as "Day",
       (select count(*) from lib_lending_transactions t where ${istDate('t.issued_at')} = d.day) as "Issued",
       (select count(*) from lib_lending_transactions t where t.returned_at is not null and ${istDate('t.returned_at')} = d.day) as "Returned",
       (select count(*) from lib_lending_transactions t where t.last_renewed_at is not null and ${istDate('t.last_renewed_at')} = d.day) as "Renewed"
  from days d
 order by d.day`,

	'circ-no-dues': p => `
with who as (select * from lib_borrowers where lower(member_number) = lower(${lit(p.member)}))
select * from (
  select 'Book out' as "Item", c.title as "Title", i.accession_number as "Accession #", ${showDate('t.issued_at::date')} as "Issued",
         ${showDate('t.due_date')} as "Due", greatest(current_date - t.due_date, 0) as "Days late", null::numeric as "Owing (₹)", 1 as "_sort"
    from lib_lending_transactions t join who on who.id = t.member_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
   where t.transaction_status in ('active', 'overdue')
  union all
  select 'Fine owing', c.title, i.accession_number, ${showDate('lc.created_at::date')}, null, lc.overdue_days, lc.net_payable, 2
    from lib_late_charges lc join who on who.id = lc.member_id
    join lib_lending_transactions t on t.id = lc.transaction_id
    join lib_items i on i.id = t.item_id join lib_catalogue_records c on c.id = i.catalogue_record_id
   where lc.payment_status in ('unpaid', 'partial') and lc.net_payable > 0
) x
order by "_sort", "Title"`,

	'circ-by-librarian': p => `
select coalesce(u.full_name, u.email, '(unknown)') as "Librarian",
       count(*) filter (where a.action = 'create') as "Issued",
       count(*) filter (where (a.metadata->>'returned') = 'true') as "Returned",
       count(*) filter (where (a.metadata->>'renewed') = 'true') as "Renewed",
       count(*) filter (where (a.metadata->>'undo') is not null) as "Undone",
       ${showDate('min(a.created_at)::date')} as "First", ${showDate('max(a.created_at)::date')} as "Last"
  from lib_activity_log a
  left join users u on u.id = a.user_id
 where a.resource_type = 'loan' and ${tsIn('a.created_at', p)}
 group by u.id, u.full_name, u.email
 order by 2 desc, 1`,

	// ── Gate ──

	'gate-register': p => `
select ${showDate('v.visit_date')} as "Date", v.member_number as "Member #", v.display_name as "Member",
       case v.member_category when 'learner' then 'Learner' when 'facilitator' then 'Staff' else coalesce(initcap(v.member_category), '') end as "Category",
       ${showTime('v.entry_time')} as "In", ${showTime('v.exit_time')} as "Out",
       case when v.entry_time is not null and v.exit_time is not null
            then extract(epoch from (v.exit_time - v.entry_time))::int / 60 end as "Stayed (min)",
       case when v.entry_time is not null and v.exit_time is null then 'Inside' else 'Left' end as "Status"
  from lib_member_visits v
 where ${dateIn('v.visit_date', p)}${statusIs('v.member_category', p.category)}
 order by v.visit_date desc, v.entry_time desc`,

	'gate-per-day': p => p.by === 'month' ? `
select to_char(date_trunc('month', v.visit_date), 'Mon YYYY') as "Month", count(*) as "Visits",
       count(distinct coalesce(v.myjkkn_id, v.member_number)) as "Different people",
       count(*) filter (where v.member_category = 'learner') as "Learners", count(*) filter (where v.member_category = 'facilitator') as "Staff",
       count(distinct v.visit_date) as "Days open", round(count(*)::numeric / greatest(count(distinct v.visit_date), 1), 1) as "Per day"
  from lib_member_visits v
 where ${dateIn('v.visit_date', p)}
 group by date_trunc('month', v.visit_date)
 order by date_trunc('month', v.visit_date)` : `
select ${showDate('v.visit_date')} as "Date", to_char(v.visit_date, 'Dy') as "Day", count(*) as "Visits",
       count(distinct coalesce(v.myjkkn_id, v.member_number)) as "Different people",
       count(*) filter (where v.member_category = 'learner') as "Learners", count(*) filter (where v.member_category = 'facilitator') as "Staff"
  from lib_member_visits v
 where ${dateIn('v.visit_date', p)}
 group by v.visit_date
 order by v.visit_date`,

	'gate-by-hour': p => `
select to_char(make_timestamp(2000, 1, 1, h.hour, 0, 0), 'HH12 AM') || ' – ' || to_char(make_timestamp(2000, 1, 1, h.hour, 59, 0), 'HH12:MI AM') as "Hour",
       count(v.id) as "Entries", count(distinct v.visit_date) filter (where v.id is not null) as "Days with entries",
       round(count(v.id)::numeric / greatest((select count(distinct visit_date) from lib_member_visits where ${dateIn('visit_date', p)}), 1), 1) as "Per open day"
  from generate_series(0, 23) as h(hour)
  left join lib_member_visits v on extract(hour from v.entry_time) = h.hour and ${dateIn('v.visit_date', p)}
 group by h.hour
having count(v.id) > 0
 order by h.hour`,

	'gate-open': () => `
select ${showDate('v.visit_date')} as "Date", v.member_number as "Member #", v.display_name as "Member",
       case v.member_category when 'learner' then 'Learner' when 'facilitator' then 'Staff' else coalesce(initcap(v.member_category), '') end as "Category",
       ${showTime('v.entry_time')} as "In", current_date - v.visit_date as "Days ago"
  from lib_member_visits v
 where v.entry_time is not null and v.exit_time is null
 order by v.visit_date desc, v.entry_time desc`,

	'gate-person': p => `
select ${showDate('v.visit_date')} as "Date", to_char(v.visit_date, 'Dy') as "Day", v.display_name as "Member",
       ${showTime('v.entry_time')} as "In", ${showTime('v.exit_time')} as "Out",
       case when v.entry_time is not null and v.exit_time is not null
            then extract(epoch from (v.exit_time - v.entry_time))::int / 60 end as "Stayed (min)"
  from lib_member_visits v
 where lower(v.member_number) = lower(${lit(p.member)}) and ${dateIn('v.visit_date', p)}
 order by v.visit_date desc, v.entry_time desc`,

	// ── Holds ──

	'holds-waiting': () => `
select c.title as "Title", c.author as "Author",
       row_number() over (partition by h.catalogue_record_id order by h.hold_placed_at) as "Place in queue",
       ${MEMBER_COLUMNS}, ${showTs('h.hold_placed_at')} as "Placed", current_date - ${istDate('h.hold_placed_at')} as "Waiting (days)",
       ${showDate('h.hold_expires_at')} as "Expires",
       (select count(*) from lib_items i where i.catalogue_record_id = c.id and i.is_active) as "Copies",
       (select count(*) from lib_items i where i.catalogue_record_id = c.id and i.is_active and i.status = 'available') as "Available now"
  from lib_resource_holds h
  join lib_catalogue_records c on c.id = h.catalogue_record_id
  join lib_borrowers b on b.id = h.member_id
 where h.hold_status = 'pending'
 order by c.title, h.hold_placed_at`,

	'holds-ready': () => `
select c.title as "Title", i.accession_number as "Accession #", ${MEMBER_COLUMNS}, b.email as "Email", b.phone as "Phone",
       ${showTs('h.notified_at')} as "Ready since", current_date - ${istDate('coalesce(h.notified_at, h.updated_at)')} as "Waiting (days)",
       ${showDate('h.hold_expires_at')} as "Expires"
  from lib_resource_holds h
  join lib_catalogue_records c on c.id = h.catalogue_record_id
  join lib_borrowers b on b.id = h.member_id
  left join lib_items i on i.id = h.item_id
 where h.hold_status = 'available'
 order by h.notified_at nulls last`,

	'holds-history': p => `
select initcap(h.hold_status) as "Ended as", ${showTs('h.updated_at')} as "When", c.title as "Title", ${MEMBER_COLUMNS},
       ${showTs('h.hold_placed_at')} as "Placed", ${istDate('h.updated_at')} - ${istDate('h.hold_placed_at')} as "Waited (days)", h.cancellation_reason as "Reason"
  from lib_resource_holds h
  join lib_catalogue_records c on c.id = h.catalogue_record_id
  join lib_borrowers b on b.id = h.member_id
 where h.hold_status in ('fulfilled', 'cancelled', 'expired') and ${tsIn('h.updated_at', p)}${statusIs('h.hold_status', p.status)}
 order by h.updated_at desc`,

	'holds-most-requested': p => `
select c.title as "Title", c.author as "Author", c.book_type as "Book Type",
       count(h.id) as "Holds placed", count(h.id) filter (where h.hold_status = 'pending') as "Waiting now",
       count(h.id) filter (where h.hold_status = 'fulfilled') as "Fulfilled",
       (select count(*) from lib_items i where i.catalogue_record_id = c.id and i.is_active) as "Copies"
  from lib_resource_holds h
  join lib_catalogue_records c on c.id = h.catalogue_record_id
 where ${tsIn('h.hold_placed_at', p)}
 group by c.id, c.title, c.author, c.book_type
 order by 4 desc, 1
 limit 50`,

	// ── Overdue ──

	'od-today': () => `
select ${MEMBER_COLUMNS}, b.email as "Email", b.phone as "Phone", ${COPY_COLUMNS},
       ${showDate('t.issued_at::date')} as "Issued", ${showDate('t.due_date')} as "Due", current_date - t.due_date as "Days late",
       (current_date - t.due_date) * coalesce(mc.late_charge_per_day, 0) as "Fine so far (₹)", t.renewal_count as "Renewals"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_member_categories mc on mc.category_code = b.member_category
 where t.transaction_status in ('active', 'overdue') and t.due_date < current_date
 order by t.due_date, b.display_name`,

	'od-chronic': p => `
select ${MEMBER_COLUMNS}, b.email as "Email",
       count(*) filter (where t.returned_at is not null and t.returned_at::date > t.due_date) as "Returned late",
       count(*) filter (where t.returned_at is null and t.due_date < current_date) as "Overdue now",
       count(*) as "Loans ever", max(greatest(coalesce(t.returned_at::date, current_date) - t.due_date, 0)) as "Longest (days)"
  from lib_lending_transactions t
  join lib_borrowers b on b.id = t.member_id
 group by b.id, b.member_number, b.display_name, b.member_category, b.email
having count(*) filter (where (t.returned_at is not null and t.returned_at::date > t.due_date) or (t.returned_at is null and t.due_date < current_date)) >= ${Math.max(1, Number(p.times) || 3)}
 order by 5 desc, 6 desc`,

	// ── Late charges ──

	'ch-raised': p => `
select ${showTs('lc.created_at')} as "Raised", ${MEMBER_COLUMNS}, c.title as "Title", i.accession_number as "Accession #",
       ${showDate('t.due_date')} as "Was due", lc.overdue_days as "Days late", lc.charge_per_day as "Per day (₹)",
       lc.total_charge as "Total (₹)", lc.waiver_amount as "Waived (₹)", lc.net_payable as "Owing (₹)", lc.payment_status as "Status"
  from lib_late_charges lc
  join lib_borrowers b on b.id = lc.member_id
  join lib_lending_transactions t on t.id = lc.transaction_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where ${tsIn('lc.created_at', p)}
 order by lc.created_at`,

	'ch-collected': p => `
select ${showDate('lc.payment_date')} as "Paid on", lc.payment_reference as "Receipt", ${MEMBER_COLUMNS}, c.title as "Title", i.accession_number as "Accession #",
       lc.total_charge - lc.waiver_amount - lc.net_payable as "Collected (₹)", lc.payment_status as "Status", u.full_name as "Collected by"
  from lib_late_charges lc
  join lib_borrowers b on b.id = lc.member_id
  join lib_lending_transactions t on t.id = lc.transaction_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join users u on u.id = lc.collected_by
 where lc.payment_status in ('paid', 'partial') and lc.payment_date is not null and ${dateIn('lc.payment_date', p)}
 order by lc.payment_date, lc.payment_reference`,

	'ch-waived': p => `
select ${showTs('lc.updated_at')} as "Waived on", ${MEMBER_COLUMNS}, c.title as "Title", i.accession_number as "Accession #",
       lc.total_charge as "Total (₹)", lc.waiver_amount as "Waived (₹)", lc.waiver_reason as "Reason", u.full_name as "Waived by", lc.payment_status as "Status"
  from lib_late_charges lc
  join lib_borrowers b on b.id = lc.member_id
  join lib_lending_transactions t on t.id = lc.transaction_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join users u on u.id = lc.waiver_approved_by
 where lc.waiver_amount > 0 and ${tsIn('lc.updated_at', p)}
 order by lc.updated_at`,

	'ch-unpaid': () => `
select case when current_date - lc.created_at::date < 30 then 'Under 30 days'
            when current_date - lc.created_at::date <= 90 then '30 to 90 days'
            else 'Over 90 days' end as "Age",
       ${MEMBER_COLUMNS}, b.email as "Email", c.title as "Title", i.accession_number as "Accession #",
       ${showDate('lc.created_at::date')} as "Raised", current_date - lc.created_at::date as "Days open", lc.net_payable as "Owing (₹)", lc.payment_status as "Status"
  from lib_late_charges lc
  join lib_borrowers b on b.id = lc.member_id
  join lib_lending_transactions t on t.id = lc.transaction_id
  join lib_items i on i.id = t.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where lc.payment_status in ('unpaid', 'partial') and lc.net_payable > 0
 order by lc.created_at`,

	'ch-by-month': p => `
select to_char(date_trunc('month', ${istDate('lc.created_at')}), 'Mon YYYY') as "Month",
       count(*) as "Charges", sum(lc.total_charge) as "Raised (₹)",
       sum(lc.total_charge - lc.waiver_amount - lc.net_payable) as "Collected (₹)",
       sum(lc.waiver_amount) as "Waived (₹)", sum(lc.net_payable) as "Still owing (₹)"
  from lib_late_charges lc
 where ${tsIn('lc.created_at', p)}
 group by date_trunc('month', ${istDate('lc.created_at')})
 order by date_trunc('month', ${istDate('lc.created_at')})`,

	// ── Purchase requests ──

	'pr-period': p => `
select r.request_number as "Request #", ${showDate('r.created_at::date')} as "Raised", r.title as "Title", r.author as "Author", r.publisher as "Publisher",
       r.department as "Department", u.full_name as "Requested by", r.quantity as "Qty", r.estimated_price as "Estimated (₹)",
       r.priority as "Priority", r.request_status as "Status", ${showDate('r.approved_at::date')} as "Approved on", a.full_name as "Approved by", r.rejection_reason as "Rejection reason"
  from lib_procurement_requests r
  left join users u on u.id = r.requested_by
  left join users a on a.id = r.approved_by
 where ${tsIn('r.created_at', p)}${statusIs('r.request_status', p.status)}
 order by r.created_at desc`,

	'pr-by-department': p => `
select coalesce(r.department, '(not set)') as "Department", coalesce(u.full_name, u.email, '(unknown)') as "Requested by",
       count(*) as "Requests", sum(r.quantity) as "Copies asked", coalesce(sum(r.estimated_price * r.quantity), 0) as "Estimated (₹)",
       count(*) filter (where r.request_status = 'pending') as "Pending", count(*) filter (where r.request_status in ('approved', 'ordered', 'received')) as "Approved"
  from lib_procurement_requests r
  left join users u on u.id = r.requested_by
 where ${tsIn('r.created_at', p)}
 group by r.department, u.id, u.full_name, u.email
 order by 1, 3 desc`,

	'pr-pending': () => `
select r.request_number as "Request #", ${showDate('r.created_at::date')} as "Raised", current_date - ${istDate('r.created_at')} as "Waiting (days)",
       r.title as "Title", r.author as "Author", r.department as "Department", u.full_name as "Requested by",
       r.quantity as "Qty", r.estimated_price as "Estimated (₹)", r.priority as "Priority"
  from lib_procurement_requests r
  left join users u on u.id = r.requested_by
 where r.request_status = 'pending'
 order by r.created_at`,

	// ── Orders ──

	'po-period': p => `
select o.order_number as "Order #", ${showDate('o.order_date')} as "Ordered", s.supplier_name as "Supplier", o.order_type as "Type",
       o.total_amount as "Value (₹)", o.order_status as "Status", ${showDate('o.expected_delivery_date')} as "Expected",
       (select count(*) from lib_procurement_items pi where pi.order_id = o.id) as "Lines",
       (select coalesce(sum(pi.quantity_ordered), 0) from lib_procurement_items pi where pi.order_id = o.id) as "Copies ordered",
       (select coalesce(sum(pi.quantity_received), 0) from lib_procurement_items pi where pi.order_id = o.id) as "Copies received",
       bh.budget_head_name as "Budget head", o.notes as "Notes"
  from lib_procurement_orders o
  join lib_suppliers s on s.id = o.supplier_id
  left join lib_budget_heads bh on bh.id = o.budget_head_id
 where ${dateIn('o.order_date', p)}${statusIs('o.order_status', p.status)}
 order by o.order_date desc, o.order_number`,

	'po-items': p => `
select o.order_number as "Order #", ${showDate('o.order_date')} as "Ordered", s.supplier_name as "Supplier", o.order_status as "Order status",
       pi.title as "Title", pi.isbn as "ISBN", pi.quantity_ordered as "Ordered", pi.quantity_received as "Received",
       pi.quantity_ordered - pi.quantity_received as "Pending", pi.unit_price as "Unit (₹)", pi.total_price as "Line total (₹)", pi.item_status as "Line status"
  from lib_procurement_items pi
  join lib_procurement_orders o on o.id = pi.order_id
  join lib_suppliers s on s.id = o.supplier_id
 where o.order_status not in ('cancelled')${contains('o.order_number', p.order)}
 order by o.order_date desc, o.order_number, pi.title`,

	'po-overdue': () => `
select o.order_number as "Order #", ${showDate('o.order_date')} as "Ordered", s.supplier_name as "Supplier", s.phone as "Supplier phone", s.email as "Supplier email",
       ${showDate('o.expected_delivery_date')} as "Expected", current_date - o.expected_delivery_date as "Days overdue", o.order_status as "Status", o.total_amount as "Value (₹)",
       (select coalesce(sum(pi.quantity_ordered - pi.quantity_received), 0) from lib_procurement_items pi where pi.order_id = o.id) as "Copies pending"
  from lib_procurement_orders o
  join lib_suppliers s on s.id = o.supplier_id
 where o.expected_delivery_date < current_date and o.order_status in ('placed', 'acknowledged', 'partially_received', 'claimed')
 order by o.expected_delivery_date`,

	// ── Suppliers ──

	'sup-list': () => `
select s.supplier_name as "Supplier", s.supplier_code as "Code", s.city as "City", s.contact_person as "Contact", s.phone as "Phone", s.email as "Email",
       case when s.is_active then 'Active' else 'Inactive' end as "Status",
       (select count(*) from lib_procurement_orders o where o.supplier_id = s.id) as "Orders",
       (select coalesce(sum(o.total_amount), 0) from lib_procurement_orders o where o.supplier_id = s.id and o.order_status <> 'cancelled') as "Order value (₹)",
       (select count(*) from lib_items i where i.supplier_id = s.id and i.is_active) as "Copies supplied",
       (select count(*) from lib_periodical_subscriptions ps where ps.supplier_id = s.id) as "Subscriptions"
  from lib_suppliers s
 order by 10 desc, 1`,

	'sup-performance': () => `
select s.supplier_name as "Supplier",
       count(o.id) as "Orders", count(o.id) filter (where o.order_status = 'received') as "Received in full",
       count(o.id) filter (where o.order_status in ('placed', 'acknowledged', 'partially_received', 'claimed')) as "Still open",
       count(o.id) filter (where o.order_status in ('placed', 'acknowledged', 'partially_received', 'claimed') and o.expected_delivery_date < current_date) as "Open and late",
       round(avg(o.updated_at::date - o.order_date) filter (where o.order_status = 'received'), 1) as "Avg days to receive",
       ${showDate('max(o.order_date)')} as "Last order"
  from lib_suppliers s
  left join lib_procurement_orders o on o.supplier_id = s.id
 group by s.id, s.supplier_name
having count(o.id) > 0
 order by 2 desc, 1`,

	// ── Budget ──

	'bud-heads': p => `
select bh.fiscal_year as "Fiscal year", bh.budget_head_code as "Code", bh.budget_head_name as "Budget head", bh.resource_type as "Type",
       bh.allocated_amount as "Allocated (₹)", bh.spent_amount as "Spent (₹)", bh.committed_amount as "Committed (₹)",
       bh.allocated_amount - bh.spent_amount - bh.committed_amount as "Balance (₹)",
       case when bh.allocated_amount > 0 then round(bh.spent_amount * 100 / bh.allocated_amount, 1) end as "Spent %",
       case when bh.is_active then 'Active' else 'Closed' end as "Status"
  from lib_budget_heads bh
 where true${contains('bh.fiscal_year', p.fiscal_year)}
 order by bh.fiscal_year desc, bh.budget_head_name`,

	'bud-by-month': p => `
select to_char(date_trunc('month', o.order_date), 'Mon YYYY') as "Month", coalesce(bh.budget_head_name, '(no head)') as "Budget head",
       count(o.id) as "Orders", coalesce(sum(o.total_amount), 0) as "Ordered (₹)"
  from lib_procurement_orders o
  left join lib_budget_heads bh on bh.id = o.budget_head_id
 where o.order_status <> 'cancelled' and ${dateIn('o.order_date', p)}
 group by date_trunc('month', o.order_date), bh.budget_head_name
 order by date_trunc('month', o.order_date), 2`,

	'bud-by-type': p => `
select coalesce(bh.fiscal_year, '') as "Fiscal year", coalesce(bh.resource_type, 'other') as "Resource type",
       count(*) as "Heads", sum(bh.allocated_amount) as "Allocated (₹)", sum(bh.spent_amount) as "Spent (₹)",
       case when sum(bh.allocated_amount) > 0 then round(sum(bh.spent_amount) * 100 / sum(bh.allocated_amount), 1) end as "Spent %"
  from lib_budget_heads bh
 where bh.is_active${contains('bh.fiscal_year', p.fiscal_year)}
 group by bh.fiscal_year, bh.resource_type
 order by 1 desc, 2`,

	// ── Subscriptions ──

	'sub-list': p => `
select c.title as "Title", s.subscription_number as "Subscription #", sup.supplier_name as "Supplier", s.subscription_type as "Type",
       s.frequency as "Frequency", s.fiscal_year as "Fiscal year", ${showDate('s.start_date')} as "Starts", ${showDate('s.end_date')} as "Ends",
       case when s.is_gratis then 0 else s.subscription_cost end as "Cost (₹)", case when s.is_gratis then 'Yes' else '' end as "Gratis",
       s.expected_issues as "Expected", (select count(*) from lib_periodical_issues pi where pi.subscription_id = s.id and pi.receipt_status = 'received') as "Received",
       s.subscription_status as "Status"
  from lib_periodical_subscriptions s
  join lib_catalogue_records c on c.id = s.catalogue_record_id
  left join lib_suppliers sup on sup.id = s.supplier_id
 where true${statusIs('s.subscription_status', p.status)}
 order by c.title, s.fiscal_year desc`,

	'sub-received': p => `
select ${showDate('pi.received_date')} as "Received", c.title as "Title", pi.volume_number as "Volume", pi.issue_number as "Issue",
       ${showDate('pi.issue_date')} as "Issue date", pi.cover_date as "Cover date", pi.pages as "Pages", pi.receipt_status as "Status",
       case when pi.is_bound then 'Yes' else '' end as "Bound", pi.remarks as "Remarks"
  from lib_periodical_issues pi
  join lib_periodical_subscriptions s on s.id = pi.subscription_id
  join lib_catalogue_records c on c.id = s.catalogue_record_id
 where ${dateIn('pi.received_date', p)}
 order by pi.received_date desc, c.title`,

	'sub-missing': () => `
select c.title as "Title", s.fiscal_year as "Fiscal year", s.frequency as "Frequency", sup.supplier_name as "Supplier",
       s.expected_issues as "Expected",
       (select count(*) from lib_periodical_issues pi where pi.subscription_id = s.id and pi.receipt_status = 'received') as "Received",
       s.expected_issues - (select count(*) from lib_periodical_issues pi where pi.subscription_id = s.id and pi.receipt_status = 'received') as "Short by",
       (select string_agg(coalesce(pi.issue_number, pi.volume_number, '?'), ', ' order by pi.issue_date) from lib_periodical_issues pi
         where pi.subscription_id = s.id and pi.receipt_status in ('expected', 'missing', 'claimed')) as "Marked missing / claimed",
       s.subscription_status as "Status"
  from lib_periodical_subscriptions s
  join lib_catalogue_records c on c.id = s.catalogue_record_id
  left join lib_suppliers sup on sup.id = s.supplier_id
 where s.subscription_status in ('active', 'gratis', 'suspended')
   and s.expected_issues > (select count(*) from lib_periodical_issues pi where pi.subscription_id = s.id and pi.receipt_status = 'received')
 order by 7 desc, 1`,

	'sub-expiring': p => `
select c.title as "Title", sup.supplier_name as "Supplier", s.frequency as "Frequency", ${showDate('s.end_date')} as "Ends",
       s.end_date - current_date as "Days left", case when s.is_gratis then 0 else s.subscription_cost end as "Cost (₹)", s.subscription_status as "Status"
  from lib_periodical_subscriptions s
  join lib_catalogue_records c on c.id = s.catalogue_record_id
  left join lib_suppliers sup on sup.id = s.supplier_id
 where s.end_date is not null and s.end_date between current_date and current_date + ${Math.max(0, Number(p.days) || 30)}
   and s.subscription_status in ('active', 'gratis')
 order by s.end_date`,

	'sub-gratis': () => `
select c.title as "Title", sup.supplier_name as "From", s.frequency as "Frequency", s.fiscal_year as "Fiscal year",
       ${showDate('s.start_date')} as "Starts", ${showDate('s.end_date')} as "Ends", s.expected_issues as "Expected",
       (select count(*) from lib_periodical_issues pi where pi.subscription_id = s.id and pi.receipt_status = 'received') as "Received", s.subscription_status as "Status"
  from lib_periodical_subscriptions s
  join lib_catalogue_records c on c.id = s.catalogue_record_id
  left join lib_suppliers sup on sup.id = s.supplier_id
 where s.is_gratis or s.subscription_status = 'gratis'
 order by c.title`,

	'sub-by-year': () => `
select s.fiscal_year as "Fiscal year", count(*) as "Subscriptions", count(*) filter (where s.is_gratis) as "Gratis",
       coalesce(sum(s.subscription_cost) filter (where not s.is_gratis), 0) as "Cost (₹)",
       count(*) filter (where s.subscription_type in ('print', 'both')) as "Print", count(*) filter (where s.subscription_type in ('online', 'both')) as "Online"
  from lib_periodical_subscriptions s
 group by s.fiscal_year
 order by s.fiscal_year desc`,

	// ── Digital ──

	'dig-list': () => `
select d.resource_title as "Resource", d.resource_type as "Type", d.provider as "Provider", d.access_url as "URL", d.coverage_years as "Coverage",
       array_to_string(d.subject_areas, ', ') as "Subjects", ${showDate('d.subscription_start')} as "From", ${showDate('d.subscription_end')} as "To",
       d.annual_cost as "Annual cost (₹)", d.concurrent_users as "Users", case when d.is_open_access then 'Yes' else '' end as "Open access",
       case when d.is_active then 'Active' else 'Inactive' end as "Status"
  from lib_digital_resources d
 order by d.resource_title`,

	'dig-expiring': p => `
select d.resource_title as "Resource", d.resource_type as "Type", d.provider as "Provider", ${showDate('d.subscription_end')} as "Ends",
       d.subscription_end - current_date as "Days left", d.annual_cost as "Annual cost (₹)"
  from lib_digital_resources d
 where d.is_active and d.subscription_end is not null and d.subscription_end between current_date and current_date + ${Math.max(0, Number(p.days) || 60)}
 order by d.subscription_end`,

	// ── Retirement ──

	'ret-period': p => `
select ${showDate('r.created_at::date')} as "Raised", i.accession_number as "Accession #", c.title as "Title", c.author as "Author",
       r.reason as "Reason", r.condition_at_retirement as "Condition", i.price as "Price (₹)", r.retirement_status as "Status",
       ${showDate('r.approval_date')} as "Decided on", a.full_name as "Approved by", r.rejection_reason as "Rejection reason"
  from lib_retirement_requests r
  join lib_items i on i.id = r.item_id
  join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join users a on a.id = r.approved_by
 where ${tsIn('r.created_at', p)}${statusIs('r.retirement_status', p.status)}
 order by r.created_at desc`,

	'ret-withdrawn': () => `
select i.status as "Status", ${COPY_COLUMNS}, i.price as "Price (₹)", ${showDate('i.accession_date')} as "Accessioned", ${showDate('i.updated_at::date')} as "Changed on",
       (select r.reason from lib_retirement_requests r where r.item_id = i.id order by r.created_at desc limit 1) as "Reason"
  from lib_items i
  join lib_catalogue_records c on c.id = i.catalogue_record_id
 where i.status in ('retired', 'lost', 'missing') or not i.is_active
 order by i.updated_at desc`,

	// ── Inter-campus ──

	'ic-period': p => `
select ${showDate('r.request_date::date')} as "Requested", r.title as "Title", r.author as "Author", ${MEMBER_COLUMNS},
       coalesce(pc.institution_code, '') as "From college", r.request_status as "Status", ${showDate('r.due_date')} as "Due", ${showDate('r.returned_date')} as "Returned",
       r.request_note as "Note", r.approved_note as "Reply"
  from lib_intercampus_requests r
  join lib_borrowers b on b.id = r.member_id
  left join colleges pc on pc.id = r.providing_institution_id
 where ${tsIn('r.request_date', p)}${statusIs('r.request_status', p.status)}
 order by r.request_date desc`,

	'ic-out': () => `
select r.title as "Title", ${MEMBER_COLUMNS}, coalesce(pc.institution_code, '') as "From college", r.request_status as "Status",
       ${showDate('r.request_date::date')} as "Requested", ${showDate('r.due_date')} as "Due", greatest(current_date - r.due_date, 0) as "Days late"
  from lib_intercampus_requests r
  join lib_borrowers b on b.id = r.member_id
  left join colleges pc on pc.id = r.providing_institution_id
 where r.request_status in ('dispatched', 'received') and r.returned_date is null
 order by r.due_date nulls last`,

	// ── Conservation ──

	'con-period': p => `
select ${showDate('r.created_at::date')} as "Raised", r.conservation_type as "Type", i.accession_number as "Accession #",
       coalesce(c.title, sc.title) as "Title", r.binder_name as "Binder", ${showDate('r.sent_to_binder')} as "Sent", ${showDate('r.expected_return')} as "Expected back",
       ${showDate('r.actual_return')} as "Returned", r.binding_cost as "Cost (₹)", r.binder_invoice as "Invoice", r.conservation_status as "Status"
  from lib_conservation_requests r
  left join lib_items i on i.id = r.item_id
  left join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_periodical_subscriptions s on s.id = r.subscription_id
  left join lib_catalogue_records sc on sc.id = s.catalogue_record_id
 where ${tsIn('r.created_at', p)}${statusIs('r.conservation_status', p.status)}
 order by r.created_at desc`,

	'con-away': () => `
select r.conservation_type as "Type", i.accession_number as "Accession #", coalesce(c.title, sc.title) as "Title", r.binder_name as "Binder",
       ${showDate('r.sent_to_binder')} as "Sent", ${showDate('r.expected_return')} as "Expected back",
       case when r.expected_return < current_date then current_date - r.expected_return end as "Days late", r.binding_cost as "Cost (₹)"
  from lib_conservation_requests r
  left join lib_items i on i.id = r.item_id
  left join lib_catalogue_records c on c.id = i.catalogue_record_id
  left join lib_periodical_subscriptions s on s.id = r.subscription_id
  left join lib_catalogue_records sc on sc.id = s.catalogue_record_id
 where r.conservation_status = 'sent'
 order by r.expected_return nulls last`,

	// ── Activity ──

	'act-period': p => `
select coalesce(u.full_name, u.email, '(unknown)') as "User", a.action as "Action", coalesce(a.resource_type, '') as "Record type",
       count(*) as "Times", ${showTs('min(a.created_at)')} as "First", ${showTs('max(a.created_at)')} as "Last"
  from lib_activity_log a
  left join users u on u.id = a.user_id
 where ${tsIn('a.created_at', p)} and a.action not in ('page_view', 'navigation', 'click')
 group by u.id, u.full_name, u.email, a.action, a.resource_type
 order by 1, 4 desc`,

	'act-logins': p => `
select ${showDate(istDate('a.created_at'))} as "Date", coalesce(u.full_name, u.email, '(unknown)') as "User", u.email as "Email",
       count(*) as "Logins", to_char(min(a.created_at at time zone 'Asia/Kolkata'), 'HH24:MI') as "First", to_char(max(a.created_at at time zone 'Asia/Kolkata'), 'HH24:MI') as "Last"
  from lib_activity_log a
  left join users u on u.id = a.user_id
 where a.action = 'auth_login' and ${tsIn('a.created_at', p)}
 group by ${istDate('a.created_at')}, u.id, u.full_name, u.email
 order by ${istDate('a.created_at')} desc, 2`,
}

export const hasSql = (id: string): boolean => id in SQL

// ── Checking the filters and building the query ─────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkParam(param: ReportParam, raw: string | undefined): string {
	const value = (raw ?? '').trim()
	if (!value) {
		if (param.optional || param.type === 'text') return ''
		throw new Error(`${param.label} is required`)
	}
	switch (param.type) {
		case 'date':
			if (!DATE.test(value) || Number.isNaN(new Date(value).getTime())) throw new Error(`${param.label} must be a date`)
			return value
		case 'number':
			if (!/^\d{1,6}$/.test(value)) throw new Error(`${param.label} must be a whole number`)
			return value
		case 'select':
			if (!param.options?.some(o => o.value === value)) throw new Error(`${param.label}: "${value}" is not one of the choices`)
			return value
		case 'text':
			return value.slice(0, 200)
	}
}

/** The filters as the report expects them, or a message saying which is wrong. */
export function checkParams(report: ReportDef, raw: Record<string, string | undefined>): Params {
	const values: Params = {}
	for (const param of report.params) values[param.key] = checkParam(param, raw[param.key])
	if (values.from && values.to && values.from > values.to) throw new Error('From is after To')
	return values
}

export function buildReportSql(id: string, raw: Record<string, string | undefined>): { report: ReportDef; params: Params; sql: string } {
	const report = reportById(id)
	if (!report) throw new Error('No such report')
	const builder = SQL[id]
	if (!builder) throw new Error('This report is not built from SQL')
	const params = checkParams(report, raw)
	return { report, params, sql: builder(params).trim() }
}

/** Every SQL report with sample filters filled in — for the syntax check script. */
export function everySqlWithSampleParams(): { id: string; sql: string }[] {
	return Object.keys(SQL).map(id => {
		const report = reportById(id)
		const sample: Params = {}
		for (const param of report?.params ?? []) {
			sample[param.key] = param.type === 'date' ? '2026-09-01' : param.type === 'number' ? (param.defaultValue ?? '3') : param.type === 'select' ? 'all' : 'PB23001'
		}
		if ('by' in sample) sample.by = 'month'
		return { id, sql: SQL[id](sample) }
	})
}
