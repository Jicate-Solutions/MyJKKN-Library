-- Reports that run as SQL: one college at a time, and unable to write.
--
-- The Reports page builds every one of its reports as a SELECT, and lets a
-- librarian type a SELECT of their own. Both come through the one function at
-- the foot of this file, and that function is what keeps two promises:
--
--   * Only this college. The query never touches a table directly. It runs
--     with `search_path` pointed at the `report` schema, which holds one VIEW
--     per library table, and each view is `select … where institution_id =
--     <the college the function was told>`. `lib_items` inside a report means
--     this college's copies and nothing else; `public.lib_items` is refused,
--     because the role the query runs as has no rights in `public` at all.
--
--   * Nothing is written. The query runs as a role that can only SELECT from
--     those views, inside a transaction switched to read-only — so even a
--     SECURITY DEFINER function it might call cannot insert, update or delete.
--
-- Views are built from the catalogue, not listed by hand: every `lib_*` table
-- with an `institution_id` column gets one, and any column whose name says
-- password, login or username is left out. Two extra views: `institutions` is
-- this college's own row, and `colleges` is every college's id, code and name
-- (needed to say where an inter-campus book went) — names, nothing more. And
-- `users` is id, email and full name only, so a report can say who did what.
--
-- Safe to run more than once. Re-run it after a migration adds a column or a
-- table: the views are dropped and rebuilt from the catalogue each time.

create schema if not exists report;

-- The role every report runs as. NOLOGIN: nobody signs in as it.
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'lib_report_reader') then
		create role lib_report_reader nologin;
	end if;
end $$;

-- SET ROLE is allowed to a role the *session* user belongs to. The server
-- reaches the database as `authenticator` (PostgREST) and the SQL editor as
-- `postgres`, so both must be members of the reader for the switch below.
-- (This is also why the function is SECURITY INVOKER: Postgres forbids SET
-- ROLE inside a SECURITY DEFINER function.)
grant lib_report_reader to postgres;
grant lib_report_reader to authenticator;

-- ── The views ────────────────────────────────────────────────────────────────

do $$
declare
	tbl record;
	cols text;
begin
	-- Rebuilt every run, so a column added since is picked up
	for tbl in select table_name from information_schema.views where table_schema = 'report' loop
		execute format('drop view if exists report.%I', tbl.table_name);
	end loop;

	for tbl in
		select c.table_name
		  from information_schema.columns c
		  join information_schema.tables t
		    on t.table_schema = c.table_schema and t.table_name = c.table_name
		 where c.table_schema = 'public'
		   and t.table_type = 'BASE TABLE'
		   and c.table_name like 'lib\_%'
		   and c.column_name = 'institution_id'
		   and c.table_name <> 'lib_impersonation_log'
		 order by c.table_name
	loop
		select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
		  into cols
		  from information_schema.columns
		 where table_schema = 'public'
		   and table_name = tbl.table_name
		   and column_name not ilike '%password%'
		   and column_name not in ('login_id', 'username');

		execute format(
			'create view report.%1$I as select %2$s from public.%1$I where institution_id = current_setting(''report.institution_id'', true)::uuid',
			tbl.table_name, cols
		);
	end loop;

	execute 'create view report.institutions as select id, institution_code, name from public.institutions where id = current_setting(''report.institution_id'', true)::uuid';
	execute 'create view report.colleges as select id, institution_code, name from public.institutions';
	execute 'create view report.users as select id, email, full_name from public.users';
end $$;

grant usage on schema report to lib_report_reader;
grant select on all tables in schema report to lib_report_reader;
alter default privileges in schema report grant select on tables to lib_report_reader;

-- ── The function ─────────────────────────────────────────────────────────────

create or replace function public.lib_report_sql(p_sql text, p_institution uuid, p_limit integer default 5000)
returns json
language plpgsql
-- Runs as whoever calls it (the server's service role, or postgres in the SQL
-- editor), not as its owner: Postgres refuses SET ROLE inside a SECURITY
-- DEFINER function, and the switch to the reader below is the whole point.
security invoker
set search_path = pg_catalog, public
as $$
declare
	v_sql text;
	v_limit integer;
	v_result json;
begin
	if p_institution is null then
		raise exception 'A college is required';
	end if;

	v_sql := btrim(coalesce(p_sql, ''));
	v_sql := regexp_replace(v_sql, ';\s*$', '');
	if v_sql = '' then
		raise exception 'The query is empty';
	end if;
	if v_sql !~* '^\s*(select|with)\M' then
		raise exception 'Only a SELECT can run here';
	end if;

	v_limit := greatest(1, least(coalesce(p_limit, 5000), 5000));

	-- This college, read-only, and as the reader — all for this transaction
	-- only. The query that follows can see one college's views and can change
	-- nothing, whatever it says. (The 60-second limit is kept by the server,
	-- which gives up waiting; a timeout set here would not arm until the next
	-- top-level statement, and this is not one.)
	perform set_config('report.institution_id', p_institution::text, true);
	perform set_config('transaction_read_only', 'on', true);
	perform set_config('search_path', 'report', true);
	execute 'set local role lib_report_reader';

	execute format(
		'select coalesce(json_agg(row_to_json(q)), ''[]''::json) from (select * from (%s) as report_query limit %s) as q',
		v_sql, v_limit
	) into v_result;

	return v_result;
end $$;

-- Only the server may call it; the server has already checked who is asking.
revoke all on function public.lib_report_sql(text, uuid, integer) from public;
revoke all on function public.lib_report_sql(text, uuid, integer) from anon;
revoke all on function public.lib_report_sql(text, uuid, integer) from authenticated;
grant execute on function public.lib_report_sql(text, uuid, integer) to service_role;

comment on function public.lib_report_sql(text, uuid, integer) is
	'Runs one read-only SELECT against the report views of one college. Used by the Reports page.';

-- Tell PostgREST the function exists, so the server can call it at once.
notify pgrst, 'reload schema';

-- Should print the number of copies in Pharmacy's register — proof that the
-- views can see the rows. A zero here (when Pharmacy has books) means the
-- views are being blocked and the report page would show nothing.
select public.lib_report_sql(
	'select count(*) as copies from lib_items',
	(select id from institutions where institution_code = 'COP')
) as pharmacy_check;
