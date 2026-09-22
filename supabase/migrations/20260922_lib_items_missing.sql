-- Why a copy is missing, and who said so.
--
-- The Missing Books page (Knowledge Registry → Missing Books) marks a copy
-- 'missing' — a status lib_items.status already allows — and keeps the reason
-- the library gave, when, and who marked it. The catalogue shows the copy as
-- Missing; the OPAC and the Circulation Desk show it as Not Available.
--
-- Marked found again, the copy goes back to 'available' and these three are
-- cleared; the activity log keeps the history.
--
-- Safe to run more than once.

alter table lib_items add column if not exists missing_reason text;
alter table lib_items add column if not exists missing_marked_at timestamptz;
alter table lib_items add column if not exists missing_marked_by text;

comment on column lib_items.missing_reason is 'Why the copy is missing, as the library wrote it on the Missing Books page';
comment on column lib_items.missing_marked_at is 'When the copy was marked missing';
comment on column lib_items.missing_marked_by is 'Name of the staff member who marked it missing';