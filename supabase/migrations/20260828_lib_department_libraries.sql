-- ============================================================================
-- Department libraries
-- ============================================================================
--
-- A college keeps small libraries inside its departments — Dental has ten in
-- MyJKKN today and will have fifteen once the rest are added there. Books go
-- out to them from the main library and are meant to stay for reference.
--
-- The decision this migration encodes: a department library is a LOCATION, not
-- a second library.
--
-- One catalogue, one accession series, one set of counts. A book sent to a
-- department is the same copy with a different `location_id` — so the shelf
-- report, the accession register, the desk lookup and every existing join show
-- the department by name without a line of their code changing. Had this been
-- built as a separate library, every one of those would have to learn about it,
-- and the same book would be counted twice in the annual return.
--
-- Reference-only rides on `lib_items.is_lendable`, which already exists and is
-- already what `/api/lib/circulation/issue` refuses on. That is why one or two
-- books in a department can be made issuable later without touching a line of
-- circulation code: the switch is on the copy, not on the department. Had the
-- rule lived on the department, letting two books out would have meant opening
-- all fifteen.
--
-- Nothing here is destructive. Every column is added with IF NOT EXISTS and a
-- default that leaves existing shelves exactly as they are.
-- ============================================================================

-- ── 1. A location can now be a department library ───────────────────────────
--
-- `location_kind` defaults to 'shelf', so every row that exists today keeps
-- behaving as it always has and the Shelf Locations screen is unchanged.

ALTER TABLE lib_locations
	ADD COLUMN IF NOT EXISTS location_kind          TEXT NOT NULL DEFAULT 'shelf',
	ADD COLUMN IF NOT EXISTS myjkkn_department_id   UUID,
	ADD COLUMN IF NOT EXISTS department_code        TEXT,
	ADD COLUMN IF NOT EXISTS department_name        TEXT,
	ADD COLUMN IF NOT EXISTS incharge_myjkkn_id     TEXT,
	ADD COLUMN IF NOT EXISTS incharge_name          TEXT,
	ADD COLUMN IF NOT EXISTS incharge_designation   TEXT,
	ADD COLUMN IF NOT EXISTS incharge_email         TEXT,
	ADD COLUMN IF NOT EXISTS incharge_assigned_at   TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS incharge_assigned_by   TEXT;

-- Everything below touches columns the statements above have just created.
-- The SQL editor plans a whole script before running any of it, so a plain
-- CREATE INDEX here would be planned against the old table and fail. EXECUTE
-- defers the parse to runtime, by which point the columns exist.

DO $$
BEGIN
	-- Only two kinds, and no third can be typed in by hand later
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'lib_locations_kind_check'
	) THEN
		EXECUTE $sql$
			ALTER TABLE lib_locations
			ADD CONSTRAINT lib_locations_kind_check
			CHECK (location_kind IN ('shelf', 'department'))
		$sql$;
	END IF;

	-- One department, one library. Setting the same department up twice would
	-- split its books across two rows and neither would show the true count.
	EXECUTE $sql$
		CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_locations_department
		ON lib_locations (institution_id, myjkkn_department_id)
		WHERE myjkkn_department_id IS NOT NULL
	$sql$;

	-- The department list page reads only department rows, every time
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_locations_kind
		ON lib_locations (institution_id, location_kind)
	$sql$;
END $$;

-- Same reason as above: these name columns this script has just added, so they
-- are deferred to runtime rather than left to be read while the script is
-- still being parsed.
DO $$
BEGIN
	EXECUTE $sql$
		COMMENT ON COLUMN lib_locations.location_kind IS
		'shelf = a rack in the main library. department = a department library, tied to a MyJKKN department.'
	$sql$;
	EXECUTE $sql$
		COMMENT ON COLUMN lib_locations.myjkkn_department_id IS
		'MyJKKN organizations/departments.id. MyJKKN owns which departments exist; this only records that one has a library.'
	$sql$;
	EXECUTE $sql$
		COMMENT ON COLUMN lib_locations.is_lendable IS
		'For a department library this is the DEFAULT for books sent there - off means they arrive reference-only. The copy''s own lib_items.is_lendable is what circulation actually enforces.'
	$sql$;
END $$;

-- ── 2. Where a book went, and when ──────────────────────────────────────────
--
-- `lib_items.location_id` says where a copy is now. It cannot say where it has
-- been, so on its own nobody could answer "when did this go to Prosthodontics,
-- and who sent it?" — the one question that matters when a book cannot be found.
--
-- The accession number, title, department and in-charge are written into the
-- row rather than joined at read time, on purpose: a transfer from two years
-- ago must still read correctly after the department has been renamed in
-- MyJKKN, the in-charge has left, or the copy has been retired.

CREATE TABLE IF NOT EXISTS lib_department_transfers (
	id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
	item_id               UUID NOT NULL REFERENCES lib_items(id) ON DELETE CASCADE,
	direction             TEXT NOT NULL CHECK (direction IN ('to_department', 'to_main')),
	from_location_id      UUID REFERENCES lib_locations(id) ON DELETE SET NULL,
	to_location_id        UUID REFERENCES lib_locations(id) ON DELETE SET NULL,
	-- Written at the time of the move, not looked up afterwards
	department_name       TEXT,
	incharge_name         TEXT,
	accession_number      TEXT,
	title                 TEXT,
	reference_only        BOOLEAN NOT NULL DEFAULT true,
	remarks               TEXT,
	moved_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
	moved_by              UUID,
	moved_by_name         TEXT
);

-- Deferred for the same reason: these name a table this same script creates.

DO $$
BEGIN
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_dept_transfers_college
		ON lib_department_transfers (institution_id, moved_at DESC)
	$sql$;
	-- Answers "where has this copy been?" — the question that comes up when a
	-- book cannot be found on either shelf.
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_dept_transfers_item
		ON lib_department_transfers (item_id, moved_at DESC)
	$sql$;
	EXECUTE $sql$
		CREATE INDEX IF NOT EXISTS idx_lib_dept_transfers_to
		ON lib_department_transfers (to_location_id, moved_at DESC)
	$sql$;
	EXECUTE $sql$
		COMMENT ON TABLE lib_department_transfers IS
		'Every movement of a copy between the main library and a department library. Names are snapshots so old lines stay readable after renames.'
	$sql$;
END $$;

-- ── 3. Books already sitting in departments ─────────────────────────────────
--
-- None. No department library exists until somebody sets one up on the
-- Department Libraries screen, and no book moves until it is sent. This
-- migration changes no existing row's behaviour.
