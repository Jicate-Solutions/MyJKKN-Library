-- Four fields the Pharmacy (COP) accession register needs on the catalogue row
-- itself, so one book = one row and nothing has to be joined to read it.
--
-- All four are plain TEXT with no CHECK constraint on purpose:
--   * book_type must be able to hold whatever is typed into the "Others" box
--   * department lists are per-college, and this table is shared by all seven
--     institutions — a CHECK built from the Pharmacy list would reject the
--     other colleges' departments later.
-- The dropdown in the Add Title form is what limits the choices, per college.
--
-- author is duplicated here on purpose. lib_catalogue_authors stays exactly as
-- it is and keeps working for multi-author and editor/translator records; this
-- column is the single name the register and the bulk sheet deal in.
--
-- Safe to run more than once.

ALTER TABLE lib_catalogue_records
	ADD COLUMN IF NOT EXISTS author        TEXT,
	ADD COLUMN IF NOT EXISTS department    TEXT,
	ADD COLUMN IF NOT EXISTS book_type     TEXT,
	ADD COLUMN IF NOT EXISTS book_location TEXT;

COMMENT ON COLUMN lib_catalogue_records.author        IS 'Primary author as written in the book. lib_catalogue_authors still holds the full author list.';
COMMENT ON COLUMN lib_catalogue_records.department    IS 'Owning department. Choices come from the per-college dropdown, not from the database.';
COMMENT ON COLUMN lib_catalogue_records.book_type     IS 'Books / Magazine / Journals / Projects, or free text when Others is chosen.';
COMMENT ON COLUMN lib_catalogue_records.book_location IS 'Where the copy sits — beero, rack, shelf. Free text.';

-- Department-wise counts are the report the Pharmacy librarian asks for most,
-- and it is always read one institution at a time.
CREATE INDEX IF NOT EXISTS idx_lib_catalogue_department
	ON lib_catalogue_records (institution_id, department);

CREATE INDEX IF NOT EXISTS idx_lib_catalogue_book_type
	ON lib_catalogue_records (institution_id, book_type);
