-- =============================================================================
-- Stock Check: what has actually been seen on the shelf
--
-- WHY THIS FILE EXISTS
--
-- A stock check (stock verification) is the one day a year the library finds
-- out whether the catalogue is true: somebody walks the shelves with a scanner
-- and every copy that answers is ticked off. What is left unticked at the end
-- is the list worth worrying about.
--
-- Five or six people do it at once, each with their own phone or scanner, all
-- scanning into the same round. So the design has exactly two jobs: be fast
-- enough that nobody waits between books, and never lose or double-count a scan
-- when two people reach for the same shelf.
--
-- HOW IT IS SHAPED, AND WHY
--
--   * lib_stock_sessions — one row per round of checking. The round is what
--     makes 'checked' mean something: last year's ticks must not count for this
--     year, and starting a new session resets the whole library to unchecked
--     without touching a single item row.
--
--   * lib_stock_scans — one row per accession number seen in that round, with
--     who saw it and when. UNIQUE (session_id, accession_number) is the heart
--     of it: two people scanning the same copy, or one person scanning twice,
--     writes once. That is also what makes a retried request safe on a weak
--     network — sending the same scan again cannot double-count.
--
--   * lib_items.stock_session_id / stock_checked_at — the answer the screens
--     actually ask for. "How many are still to find" has to be one indexed
--     count over the college's copies, not a difference worked out against a
--     list of 26,000 scans, or the progress bar would be slower than the
--     scanning.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
-- lib_items.status is left completely alone. A copy being seen on the shelf is
-- not a circulation event: 'available', 'on_loan' and 'missing' all still mean
-- what they meant, the desk and the OPAC behave exactly as before, and a stock
-- check can run in the middle of a working day without changing what can be
-- issued. Being 'checked' lives in the two new columns and nowhere else.
--
-- No fine, no missing marking, no status change happens here. The pending list
-- at the end of a round is a list to act on, by hand, on the Missing Books
-- page — the two screens stay separate on purpose.
--
-- Safe to run more than once.
-- =============================================================================

-- ── 1. The rounds ───────────────────────────────────────────────────────────

create table if not exists lib_stock_sessions (
	id uuid primary key default gen_random_uuid(),

	-- One college's round. Never shared: a check at Pharmacy says nothing about
	-- Dental's shelves, and every read below is filtered by this column.
	institution_id uuid not null references institutions(id) on delete cascade,

	-- What the library calls this round, e.g. 'Stock check Oct 2026'
	name text not null,

	status text not null default 'open' check (status in ('open', 'closed')),

	-- Who started it and who closed it. MyJKKN's id, held as text and without a
	-- foreign key, exactly as everywhere else here: this project keeps no user
	-- table of its own.
	started_by text,
	started_by_name text,
	started_at timestamptz not null default now(),
	closed_at timestamptz,
	closed_by_name text,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- ── 2. The scans ────────────────────────────────────────────────────────────
--
-- Inside EXECUTE because it points at the table above, which does not exist
-- yet while this script is being planned. See section 4.

do $$
begin
	execute $sql$
		create table if not exists lib_stock_scans (
			id uuid primary key default gen_random_uuid(),

			session_id uuid not null references lib_stock_sessions(id) on delete cascade,
			institution_id uuid not null references institutions(id) on delete cascade,

			-- Null when the number scanned is not a copy in this library. Those are
			-- kept rather than dropped: a number nobody can account for is exactly
			-- what the librarian wants to see at the end of the day.
			item_id uuid references lib_items(id) on delete set null,

			-- What was typed or scanned, as it was read
			accession_number text not null,

			outcome text not null check (outcome in ('checked', 'unknown')),

			-- What the copy was at the moment it was seen, for the record: a copy
			-- found on the shelf while the system says it is on loan is worth
			-- knowing about.
			item_status text,
			title text,

			scanned_by text,
			scanned_by_name text,
			scanned_at timestamptz not null default now(),

			-- The whole reason five people can scan at once without colliding: the
			-- second scan of a copy is refused by the database, not by the
			-- application, and comes back as 'already checked' instead of counting
			-- twice.
			unique (session_id, accession_number)
		)
	$sql$;
end $$;

-- ── 3. Checked, on the copy itself ──────────────────────────────────────────
--
-- Held on lib_items so "checked" and "still to find" are each one indexed
-- count. stock_session_id says WHICH round saw it, which is what makes a new
-- round start clean: every copy's id simply no longer matches the current one.

alter table lib_items add column if not exists stock_session_id uuid;
alter table lib_items add column if not exists stock_checked_at timestamptz;

-- ── 4. Everything that names what this script has just made ─────────────────
--
-- The SQL editor plans a whole script before running any of it, so a plain
-- CREATE INDEX or COMMENT here would be read against the tables as they were
-- before this file ran, and the script would fail on a column that exists by
-- then. EXECUTE defers the parse to runtime, by which point it all exists.

do $$
begin
	-- The page lists a college's rounds, newest first
	execute $sql$
		create index if not exists idx_lib_stock_sessions_college
		on lib_stock_sessions (institution_id, started_at desc)
	$sql$;

	-- The live list on the screen: this round's scans, newest first
	execute $sql$
		create index if not exists idx_lib_stock_scans_session
		on lib_stock_scans (session_id, scanned_at desc)
	$sql$;

	-- The counts, and the list of numbers that matched nothing
	execute $sql$
		create index if not exists idx_lib_stock_scans_outcome
		on lib_stock_scans (session_id, outcome)
	$sql$;

	-- Both counts the progress bar asks for, and the pending list, in one index
	execute $sql$
		create index if not exists idx_lib_items_stock_session
		on lib_items (institution_id, stock_session_id)
	$sql$;

	-- Read by the server with the service role, which bypasses RLS; on with no
	-- policies, exactly as every other lib_* table, so nothing can read these
	-- rows with an anon key.
	execute 'alter table lib_stock_sessions enable row level security';
	execute 'alter table lib_stock_scans enable row level security';

	execute $sql$
		comment on table lib_stock_sessions is
		'One round of stock checking for one college. Scans belong to a round, and a new round starts the whole library at unchecked again.'
	$sql$;
	execute $sql$
		comment on table lib_stock_scans is
		'One row per accession number seen in a round, with who saw it. Unique per round, so a repeat scan - or a retried request on a weak network - can never count twice.'
	$sql$;
	execute $sql$
		comment on column lib_stock_scans.item_id is
		'Null when the number is not a copy in this library; the row is kept so the number can be chased up.'
	$sql$;
	execute $sql$
		comment on column lib_items.stock_session_id is
		'The stock check round in which this copy was last seen on the shelf. Nothing to do with lib_items.status, which a stock check never changes.'
	$sql$;
	execute $sql$
		comment on column lib_items.stock_checked_at is
		'When this copy was last seen in a stock check round.'
	$sql$;
end $$;

-- ── Check it worked ─────────────────────────────────────────────────────────
--
--   select s.name, s.status,
--          (select count(*) from lib_stock_scans x where x.session_id = s.id) as scans
--   from lib_stock_sessions s
--   order by s.started_at desc;
--
-- ── After this runs ─────────────────────────────────────────────────────────
--
-- Re-run supabase/migrations/20260905_lib_report_sql.sql so the Reports screen
-- gets its scoped read-only views for the two new tables.
--
-- ── To undo ─────────────────────────────────────────────────────────────────
--
--   drop table if exists lib_stock_scans;
--   drop table if exists lib_stock_sessions;
--   alter table lib_items drop column if exists stock_session_id;
--   alter table lib_items drop column if exists stock_checked_at;
