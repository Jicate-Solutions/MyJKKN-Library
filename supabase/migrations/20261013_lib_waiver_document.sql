-- ─────────────────────────────────────────────────────────────────────────────
-- The letter behind a waived fine.
--
-- Letting a fine off is the one thing at this desk that nobody can reconstruct
-- afterwards. The reason has been compulsory since 2026-10-08, but a reason is
-- only a sentence a librarian typed. In practice the college asks for more: the
-- learner writes a letter, the principal signs it, and that paper is the real
-- authority for the money being let go.
--
-- So a waiver can now carry that letter. It stays OPTIONAL — a small fine let
-- off at the counter does not need a signature, and making it compulsory would
-- only teach people to upload anything to get past the button. Where a letter
-- exists, it is kept; where it does not, the reason still stands alone.
--
--   waiver_document_path   where the file sits in the `library-waivers`
--                          bucket. Scoped by institution in the path itself,
--                          so one college's letters can never be listed by
--                          another's.
--
--   waiver_document_name   what the librarian called it, so the link can show
--                          "Principal approval.pdf" rather than a uuid.
--
-- The bucket is PRIVATE. Nothing in it is reachable by URL; the server signs a
-- short-lived link each time somebody asks to see a letter. A waiver letter
-- names a learner and their circumstances, and those do not belong on a public
-- URL that outlives the person who opened it.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The two columns ──────────────────────────────────────────────────────────

alter table lib_late_charges add column if not exists waiver_document_path text;
alter table lib_late_charges add column if not exists waiver_document_name text;

comment on column lib_late_charges.waiver_document_path is
	'Object path in the private library-waivers bucket, or null. Written only when a waiver carried a signed letter.';

comment on column lib_late_charges.waiver_document_name is
	'The file name the librarian uploaded, shown on the link. Display only.';

-- Finding the waivers that have a letter, without reading every charge
create index if not exists lib_late_charges_waiver_doc_idx
	on lib_late_charges (institution_id)
	where waiver_document_path is not null;

-- ── The bucket ───────────────────────────────────────────────────────────────
--
-- Private, and created only if it is not already there. The file size limit is
-- kept here as well as in the upload route: the route is the polite refusal,
-- this is the one that cannot be talked around.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'library-waivers',
	'library-waivers',
	false,
	1048576,	-- 1 MB
	array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
	set public = false,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;

-- No policies on storage.objects are needed or wanted. Every read and write
-- goes through this application's API routes on the service role, which has
-- already resolved who is asking and which college they belong to. Adding a
-- policy for `authenticated` would open the bucket to anyone holding a browser
-- token, which is exactly what the institution scoping is there to prevent.

-- ── Check ────────────────────────────────────────────────────────────────────

select
	(select count(*) from information_schema.columns
	  where table_name = 'lib_late_charges'
	    and column_name in ('waiver_document_path', 'waiver_document_name')) as columns_added,
	(select count(*) from storage.buckets where id = 'library-waivers') as bucket_ready;
