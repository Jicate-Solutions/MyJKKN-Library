-- ============================================================
-- Trigram indexes for the ILIKE searches — OPTIONAL, read this first
-- 21-08-2026 · MyJKKN Library
-- ============================================================
--
-- WHY THIS IS SEPARATE, AND WHY IT IS NOT RUN BY DEFAULT
--
-- The OPAC's word search and the activity log's free-text search both compare
-- what was typed against many columns at once, with a leading wildcard:
--
--     title ILIKE '%pharma%' OR subtitle ILIKE '%pharma%' OR author ILIKE ...
--
-- A leading % defeats an ordinary index, and the GIN indexes these tables
-- already carry are built with to_tsvector — they speed up full-text `@@`
-- matching, not ILIKE. pg_trgm is enabled, but no gin_trgm_ops index exists.
--
-- The catch is that an OR only avoids a scan when EVERY branch of it has an
-- index — one uncovered column and the planner reads the table anyway. So this
-- is all-or-nothing: sixteen indexes on the catalogue, five on the log.
--
-- What that buys, and what it costs, measured against this library's real size:
--
--   * A campus's catalogue is between 1,935 and 24,997 titles. Comparing that
--     many rows costs tens of milliseconds — real, but small next to the rest
--     of a request.
--   * Twenty-one GIN indexes cost disk, and they make every write slower —
--     including the bulk upload of a few thousand books, which is the one place
--     in this system where write speed is felt.
--
-- So: run this when a search actually feels slow, or when a catalogue has grown
-- well past today's size. Not before. Nothing else in the application depends
-- on it, and dropping the indexes again changes no behaviour.
--
-- Safe to run more than once. Adds no column, changes no data.
-- Every statement uses CONCURRENTLY so nothing is locked while it builds —
-- which means this file must be run STATEMENT BY STATEMENT, not inside a
-- transaction block. In the Supabase SQL editor, run it one line at a time.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- The catalogue: every column the OPAC's word search reads ----------

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_title          ON lib_catalogue_records USING gin(title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_subtitle       ON lib_catalogue_records USING gin(subtitle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_author         ON lib_catalogue_records USING gin(author gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_publisher      ON lib_catalogue_records USING gin(publisher_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_place          ON lib_catalogue_records USING gin(publisher_place gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_isbn           ON lib_catalogue_records USING gin(isbn gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_issn           ON lib_catalogue_records USING gin(issn gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_edition        ON lib_catalogue_records USING gin(edition gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_volume         ON lib_catalogue_records USING gin(volume_number gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_call_number    ON lib_catalogue_records USING gin(call_number gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_class_number   ON lib_catalogue_records USING gin(classification_number gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_series         ON lib_catalogue_records USING gin(series_title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_language       ON lib_catalogue_records USING gin(language gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_department     ON lib_catalogue_records USING gin(department gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_book_type      ON lib_catalogue_records USING gin(book_type gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_cat_trgm_book_location  ON lib_catalogue_records USING gin(book_location gin_trgm_ops);

-- ---------- The other two tables the same search reads ----------

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_authors_trgm_name       ON lib_catalogue_authors USING gin(author_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_items_trgm_accession    ON lib_items USING gin(accession_number gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_items_trgm_barcode      ON lib_items USING gin(barcode gin_trgm_ops);

-- ---------- The activity log's free-text search ----------
--
-- This one has the stronger case of the two: the log is never purged, so it is
-- the table that will grow past the point where a scan stops being cheap.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_log_trgm_action         ON lib_activity_log USING gin(action gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_log_trgm_resource_type  ON lib_activity_log USING gin(resource_type gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_log_trgm_resource_id    ON lib_activity_log USING gin(resource_id gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_log_trgm_error          ON lib_activity_log USING gin(error_message gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_log_trgm_user_email     ON lib_activity_log USING gin((metadata->>'user_email') gin_trgm_ops);
