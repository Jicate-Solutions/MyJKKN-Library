-- =============================================================================
-- Stock check helpers, kept in the database instead of an environment variable.
--
-- A stock check is counted by a few learners for a week. Until now the only way
-- to let one in was to edit LIBRARY_ACCESS_GRANTS in Vercel, which meant a
-- redeploy, an engineer, and a librarian who could not add a helper on the
-- morning the counting started. This table is that list, so a super admin can
-- add and remove helpers from the Stock Check page itself.
--
-- WHAT THIS DOES NOT CHANGE
--
-- LIBRARY_ACCESS_GRANTS still works, and still holds everything else —
-- super_admin, library_admin, librarian, assistant_librarian. Those are not
-- moved here on purpose: the screen that would grant them can only be opened by
-- somebody who already has super_admin, so putting the last super_admin grant
-- behind it is how a library locks itself out. Only `stock_check` moves.
--
-- WHAT A ROW HERE BUYS
--
-- Nothing on its own. A helper still signs in through MyJKKN like everybody
-- else, with MyJKKN proving who they are and their MyJKKN account having to be
-- live. This only answers the question MyJKKN cannot: that this address is
-- expected, until this date, at this college, for this one job. No password is
-- stored here and none exists.
--
-- The email is the key, because that is what arrives from MyJKKN at sign-in.
-- One address can hold one helper grant at a time, at one college.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists lib_stock_check_helpers (
	id uuid primary key default gen_random_uuid(),

	-- The college whose shelves they may scan. Required, and the only one they
	-- can reach: a helper has no staff record behind them to say where they are.
	institution_id uuid not null references institutions(id) on delete cascade,

	-- What MyJKKN signs them in as. Lower-cased on the way in, and matched
	-- lower-cased by the unique index below.
	email text not null,

	-- Who this is, as MyJKKN had them on the day they were added. Kept as a
	-- plain copy so the list still reads after somebody leaves the roll — it is
	-- a label for the librarian, never the thing access is decided on.
	display_name text,
	member_number text,
	myjkkn_id text,

	-- The LAST DAY it works. After it the row stops being read and the person
	-- goes back to whatever MyJKKN says they are. Nothing has to be cleaned up,
	-- which is the point: a grant that needs remembering is one that gets
	-- forgotten.
	expires_on date not null,

	created_at timestamptz not null default now(),
	-- Who added them. MyJKKN's id, held as text and without a foreign key,
	-- exactly as everywhere else here: this project keeps no user table.
	created_by text,
	created_by_name text
);

-- ── Indexes and RLS ─────────────────────────────────────────────────────────
--
-- Inside EXECUTE because they point at the table above, which does not exist
-- yet while the SQL editor is planning this script as one statement.

do $$
begin
	-- One grant per address. The route lower-cases every address before writing
	-- and before matching, so a plain unique index is the whole rule — and it is
	-- plain rather than on lower(email) because adding the same helper twice
	-- updates their date through this index, which a functional one cannot do.
	execute $sql$
		create unique index if not exists idx_lib_stock_helpers_email
			on lib_stock_check_helpers (email)
	$sql$;

	-- The Stock Check page lists one college's helpers, soonest to lapse last.
	execute $sql$
		create index if not exists idx_lib_stock_helpers_college
			on lib_stock_check_helpers (institution_id, expires_on desc)
	$sql$;

	execute 'alter table lib_stock_check_helpers enable row level security';
end $$;
