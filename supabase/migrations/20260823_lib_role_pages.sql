-- =============================================================================
-- Role Management: which pages each role may open
--
-- WHY THIS FILE EXISTS
--
-- MyJKKN decides what somebody is — librarian, library admin — and that stays
-- MyJKKN's. What a role is allowed to see *inside this library* is ours, and
-- until now it was hard-coded: every role that got in saw the whole menu apart
-- from the two screens the code held back. A super admin had no way to say
-- "an assistant librarian does not need Budget".
--
-- This table is that say. One row per role, holding the paths that role may
-- open. The three colleges' data is untouched by it — this is about which
-- SCREENS a role sees, never about which campus's rows; institution scoping is
-- decided somewhere else entirely and a tick here cannot widen it.
--
-- A role with NO ROW keeps exactly what it has today. That is the whole point
-- of leaving this table empty: running this migration changes nothing on its
-- own, and nothing changes until somebody opens Role Management and changes it.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists lib_role_pages (
	-- The role key as MyJKKN spells it, normalised. Primary key because a role
	-- has exactly one answer — there is no per-college variation here.
	role text primary key
		check (role in ('library_admin', 'librarian', 'assistant_librarian')),

	-- The paths this role may open, e.g. {'/registry','/circulation'}. Read
	-- against the page catalogue in lib/auth/role-pages.ts: a path no longer in
	-- the catalogue is ignored, and a page locked in code is applied on top, so
	-- a hand-edited row can never hand out a screen the code refuses to give.
	pages text[] not null default '{}',

	-- Who last changed it. Held as MyJKKN's staff id, deliberately without a
	-- foreign key: this project keeps no user table.
	updated_by text,
	updated_by_name text,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table lib_role_pages is
	'One row per role: the pages that role may open. No row means the code default — everything the role saw before this table existed. Set from the Role Management screen, super admin only.';

comment on column lib_role_pages.pages is
	'Paths from the catalogue in lib/auth/role-pages.ts. Locked pages are applied over this list, so it is a request rather than the final word.';

-- ── Deliberately NOT done ───────────────────────────────────────────────────
--
--   * No rows are inserted. An empty table means every role behaves exactly as
--     it did before, which is what makes this migration safe to run ahead of
--     the deploy or after it.
--   * `super_admin` cannot be stored at all — the check constraint refuses it.
--     A super admin is never restricted, and the one account that hands out
--     access must not be able to lock itself out of the screen that does it.
--   * No institution column. A librarian at Pharmacy and a librarian at Dental
--     do the same job; if the two ever need different menus, that is a new
--     column here and not a reason to hold this back now.
--
-- ── Check it worked ─────────────────────────────────────────────────────────
--
--   select role, cardinality(pages) as page_count, updated_at
--   from lib_role_pages order by role;
--
-- ── To undo ─────────────────────────────────────────────────────────────────
--
-- Dropping the table puts every role back on the code defaults. Nothing else
-- reads it, so nothing else breaks.
--
--   drop table if exists lib_role_pages;
