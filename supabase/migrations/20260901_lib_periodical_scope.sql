-- ============================================================================
-- Journal/Magazine Type — National or International
-- ============================================================================
--
-- A library is asked, every year, how many of its journals are national and how
-- many international. Until now nobody could answer without going along the
-- shelf, because the register did not hold it.
--
-- It belongs to the TITLE, not to a copy or an issue: a journal is national or
-- international for its whole life, whatever arrives this month. So it sits on
-- lib_catalogue_records beside the other things a title carries.
--
-- Asked of magazines and journals alone. A textbook is not classed this way, so
-- for every book the column simply stays null — which is why it is nullable and
-- has no default. A blank on a book means "does not apply"; a blank on a
-- magazine means one entered before this field existed, and both read correctly
-- as empty.
--
-- Nothing here is destructive. The 12,000 books already in the register are
-- untouched, and no existing row changes.
--
-- Written 2026-09-01. Paste the whole file into the Supabase SQL editor.
-- ============================================================================

ALTER TABLE lib_catalogue_records
	ADD COLUMN IF NOT EXISTS periodical_scope TEXT;

-- Everything below names the column the statement above has just created. The
-- Supabase SQL editor plans a whole script before running any of it, so a plain
-- ALTER … ADD CONSTRAINT here would be planned against the old table and fail.
-- EXECUTE defers the parse to runtime, by which point the column exists.

DO $$
BEGIN
	-- Two values and no third. The form offers a dropdown, but a bulk upload or
	-- a hand-made request could otherwise write "Natl" or "intl" and the yearly
	-- count would quietly miss them.
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'lib_catalogue_records_periodical_scope_check'
	) THEN
		EXECUTE $sql$
			ALTER TABLE lib_catalogue_records
			ADD CONSTRAINT lib_catalogue_records_periodical_scope_check
			CHECK (periodical_scope IS NULL OR periodical_scope IN ('National', 'International'))
		$sql$;
	END IF;

	-- The question this column exists to answer is "how many of each, for this
	-- college" — so the index is on the pair, and only over the rows that have
	-- one, which is the periodicals and not the twelve thousand books.
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_catalogue_periodical_scope
		ON lib_catalogue_records (institution_id, periodical_scope)
		WHERE periodical_scope IS NOT NULL
	$sql$;

	EXECUTE $sql$
		COMMENT ON COLUMN lib_catalogue_records.periodical_scope IS
		'National or International, for magazines and journals only. Null on books, where it does not apply.'
	$sql$;
END $$;
