-- ============================================================================
-- Departments List — the hub every department dropdown reads
-- ============================================================================
--
-- Until now a college's departments came from two places that never met:
--
--   * MyJKKN, read live, which the Department Libraries screen uses; and
--   * a list typed into lib/library/catalogue-options.ts, which the New Title
--     form uses — 65 names across the seven colleges, editable only by a
--     developer, and holding entries MyJKKN does not have at all
--     ("Main Library", "Miscellaneous", the twenty-one Dental subjects).
--
-- MyJKKN does not hold every department a library shelves by, so the library
-- has to be able to add its own. This table is that half. MyJKKN stays the
-- live source for the departments it does know — nothing from it is copied
-- here — and these rows sit beside them in one merged list that the Departments
-- List page, the New Title dropdown and the Department Libraries screen all
-- read.
--
-- Two kinds of row, told apart by `source`:
--
--   * 'local'  — a department this library added. Name, code and order are
--                ours, and it can be edited, deactivated or deleted.
--   * 'myjkkn' — not a department, but a switch against one of MyJKKN's. Only
--                `is_active` is read from it; the name and code always come
--                from MyJKKN live, so a rename there still reaches every
--                screen. It exists so a college can hide a MyJKKN department
--                its library does not shelve by.
--
-- Nothing here is destructive. The 65 names in the code are copied in as
-- 'local' rows so they appear on the new page and can be managed, and no
-- department already saved on a book is touched — a book keeps the department
-- written on it whether or not it is still on any list.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lib_departments (
	id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
	source                TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'myjkkn')),
	-- Set only on a 'myjkkn' switch row; null on a department of our own.
	myjkkn_department_id  UUID,
	department_code       TEXT,
	department_name       TEXT NOT NULL,
	display_name          TEXT,
	is_active             BOOLEAN NOT NULL DEFAULT true,
	sort_order            INTEGER NOT NULL DEFAULT 0,
	created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
	created_by            TEXT,
	updated_by            TEXT
);

-- Deferred: the SQL editor plans the whole script before running any of it, so
-- a plain CREATE INDEX here would be planned against a table that does not yet
-- exist. EXECUTE defers the parse to runtime.
DO $$
BEGIN
	-- One department of a given name per college. Case-insensitive, because
	-- "Anatomy" and "anatomy" are the same shelf.
	EXECUTE $sql$
		CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_departments_local_name
		ON lib_departments (institution_id, lower(department_name))
		WHERE source = 'local'
	$sql$;
	-- At most one switch row per MyJKKN department.
	EXECUTE $sql$
		CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_departments_myjkkn
		ON lib_departments (institution_id, myjkkn_department_id)
		WHERE myjkkn_department_id IS NOT NULL
	$sql$;
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_departments_college
		ON lib_departments (institution_id, is_active, sort_order)
	$sql$;
	EXECUTE $sql$
		COMMENT ON TABLE lib_departments IS
		'Departments the library added itself, plus active/inactive switches against MyJKKN departments. Merged with MyJKKN''s live list wherever departments are offered.'
	$sql$;
	EXECUTE $sql$
		COMMENT ON COLUMN lib_departments.source IS
		'local = a department of ours; myjkkn = a switch row whose only meaning is is_active against myjkkn_department_id'
	$sql$;
END $$;

-- ── The 65 departments that were written in the code ────────────────────────
--
-- Copied in once, per college, by institution_code. ON CONFLICT DO NOTHING
-- against the unique index above, so running this script a second time changes
-- nothing and a name the library has since edited is not put back.

DO $$
DECLARE
	college RECORD;
	names   TEXT[];
	nm      TEXT;
	position INTEGER;
BEGIN
	FOR college IN
		SELECT id, institution_code FROM institutions
		WHERE institution_code IN ('COP', 'AHS', 'CAS', 'COE', 'CET', 'CNR', 'DCH')
	LOOP
		names := CASE college.institution_code
			WHEN 'COP' THEN ARRAY[
				'Pharmaceutics', 'Pharmaceutical Chemistry', 'Pharmaceutical Analysis',
				'Pharmacology', 'Pharmacognosy', 'Pharmacy Practice', 'Regulatory Affairs', 'PHARMD']
			WHEN 'AHS' THEN ARRAY['Department of Allied (UG)']
			WHEN 'CAS' THEN ARRAY[
				'English', 'Miscellaneous', 'General', 'History', 'Zoology', 'Economics',
				'Commerce', 'Mathematics', 'Computer Science', 'Chemistry', 'Physics', 'Tamil',
				'Geography', 'Botany', 'Main Library', 'Nutrition and Dietetics',
				'Textile & Fashion Designing']
			WHEN 'COE' THEN ARRAY['Bachelor of Education', 'Pedagogy of History']
			WHEN 'CET' THEN ARRAY[
				'Computer Science and Engineering', 'Computer Science and Engineering (PG)',
				'Electrical and Electronics Engineering', 'Electronics and Communication Engineering',
				'Information Technology', 'Master of Business Administration (PG)',
				'Mechanical Engineering', 'Science and Humanities']
			WHEN 'CNR' THEN ARRAY[
				'Adult Health Nursing', 'Child Health Nursing', 'Community Health Nursing',
				'Department of Nursing (UG)', 'Medical Surgical Nursing', 'Mental Health Nursing',
				'Nutrition and Dietetics', 'Obstetrics and Gynaecological Nursing']
			WHEN 'DCH' THEN ARRAY[
				'Anatomy', 'Physiology', 'Biochemistry', 'Pharmacology', 'Microbiology',
				'Oral pathology', 'Oral histology', 'Preventive and community dentistry',
				'Dental Materials', 'General Dentistry', 'General medicine', 'General Surgery',
				'Implant Dentistry', 'Oral Surgery', 'General Pathology',
				'Conservative dentistry and Endodontics', 'Oral Medicine', 'Orthodontics',
				'Pedodontics', 'Periodontics', 'Prosthodontics']
		END;

		position := 0;
		FOREACH nm IN ARRAY names LOOP
			position := position + 1;
			EXECUTE $sql$
				INSERT INTO lib_departments (institution_id, source, department_name, sort_order, created_by)
				VALUES ($1, 'local', $2, $3, 'migration 20260923')
				ON CONFLICT DO NOTHING
			$sql$ USING college.id, nm, position;
		END LOOP;
	END LOOP;
END $$;
