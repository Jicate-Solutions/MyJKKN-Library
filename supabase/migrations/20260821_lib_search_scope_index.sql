-- ============================================================
-- Narrowing what a catalogue search has to look through
-- 20-08-2026 → 21-08-2026 · MyJKKN Library
-- ============================================================
--
-- The OPAC's word search compares what was typed against sixteen text columns
-- of lib_catalogue_records. Nothing can index that comparison itself (see the
-- optional trigram migration alongside this one), so what matters most is how
-- many rows it is made against.
--
-- The search always filters on the campus and on is_active first. There was no
-- index leading with that pair: the two that lead with institution_id carry a
-- second column the search does not use (classification_number, resource_format),
-- so the planner had a poorer starting point than it needed.
--
-- With this in place a reader at Pharmacy is only ever compared against
-- Pharmacy's active titles, never against all seven colleges' rows.
--
-- Safe to run more than once. Adds no column, changes no data.

CREATE INDEX IF NOT EXISTS idx_lib_cat_institution_active
  ON lib_catalogue_records(institution_id, is_active);

-- The same shape for the two tables the search reads alongside it: the author
-- name lookup and the accession/barcode lookup both filter by campus first.

CREATE INDEX IF NOT EXISTS idx_lib_authors_institution
  ON lib_catalogue_authors(institution_id);
