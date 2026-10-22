-- =============================================================================
-- A stock check helper may come from any college, and may help at more than one.
--
-- The first version of this table assumed a helper was one of the college's own
-- learners, so it allowed one row per email address. The plan it has to serve is
-- different: Engineering's staff walk over and count Pharmacy's shelves, and the
-- same person may be asked to do the same at a third college next week.
--
-- So the rule becomes one row per person PER COLLEGE. Assigning somebody to a
-- second college now adds an assignment instead of silently moving the first —
-- which would have taken away access nobody asked to remove.
--
-- `member_college_code` is a label, not a permission. It records which college
-- the person themselves belongs to, as MyJKKN had it on the day they were
-- added, so the list can read "ANAND R · CET" and the super admin can see at a
-- glance who is a visitor. Access is still decided only by institution_id — the
-- college whose shelves they may scan.
--
-- Safe to run more than once.
-- =============================================================================

alter table lib_stock_check_helpers
	add column if not exists member_college_code text;

do $$
begin
	-- One row per person per college, replacing one row per person.
	execute 'drop index if exists idx_lib_stock_helpers_email';

	execute $sql$
		create unique index if not exists idx_lib_stock_helpers_email_college
			on lib_stock_check_helpers (email, institution_id)
	$sql$;

	-- Looking somebody up by address alone still happens on every sign-in, and
	-- there is no unique index to lean on for it any more.
	execute $sql$
		create index if not exists idx_lib_stock_helpers_email_lookup
			on lib_stock_check_helpers (email)
	$sql$;
end $$;
