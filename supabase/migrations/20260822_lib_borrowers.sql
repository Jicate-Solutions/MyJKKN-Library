-- =============================================================================
-- lib_borrowers — the people who have actually taken a book out
--
-- WHY THIS EXISTS
--
-- Until now the library kept its own roll of members in `lib_members`: a
-- librarian enrolled a learner by hand, and that row was the person as far as
-- this system was concerned. That is a second copy of something MyJKKN already
-- owns, and copies drift — a learner who leaves, a staff member who transfers,
-- a corrected name.
--
-- From now on there is no roll to keep. Everyone Active in MyJKKN — learner or
-- staff — is a member of their own college's library, read live from MyJKKN on
-- every request. Nobody is stored here in advance.
--
-- But a loan, a fine and a hold must point at someone, and they must keep
-- pointing at that someone for years, long after the person has left MyJKKN.
-- So the moment a person actually borrows, one row is written here: who they
-- are in MyJKKN, and what their name and number were on the day they borrowed.
-- That row is what circulation hangs off. Nobody who has never taken a book
-- appears in this table at all.
--
-- `lib_members` is NOT dropped. Rows already in it stay exactly as they are, and
-- every loan, fine, hold, visit and request already recorded keeps working —
-- see the backfill below.
--
-- Safe to run more than once.
-- =============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lib_borrowers (
	id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

	-- The college. Seven libraries; the same person borrowing at two of them is
	-- two rows, exactly as it was before, and neither college sees the other's.
	institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,

	-- Who they are in MyJKKN. TEXT rather than UUID because it also carries the
	-- 'legacy:<uuid>' marker written by the backfill for the handful of older
	-- members — guests, alumni — who were never MyJKKN people at all.
	myjkkn_id             TEXT NOT NULL,
	person_kind           TEXT NOT NULL CHECK (person_kind IN ('learner', 'facilitator', 'legacy')),

	-- What they were called and carried on the day they first borrowed. A
	-- snapshot on purpose: MyJKKN is asked for the live name everywhere it is
	-- shown, but a fine from 2024 must still say whose fine it was even if that
	-- person is no longer in MyJKKN at all.
	member_number         TEXT NOT NULL,
	member_category       TEXT NOT NULL,
	display_name          TEXT,
	email                 TEXT,
	phone                 TEXT,

	-- Owes money. Lives here and not in MyJKKN because it is the library's own
	-- fact about them, not the college's.
	is_delinquent         BOOLEAN NOT NULL DEFAULT false,

	first_borrowed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
	-- Refreshed whenever they come back to the desk, so the snapshot follows a
	-- change of name or email without anyone editing anything.
	last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

	created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

	-- One borrower row per MyJKKN person per college. This is what makes
	-- find-or-create at the desk safe under two librarians at once.
	UNIQUE(institution_id, myjkkn_id)
);

-- Deliberately no CHECK on member_category: it is matched against
-- lib_member_categories.category_code, which each college maintains itself. A
-- college adding a category must never make a book impossible to issue.
COMMENT ON COLUMN lib_borrowers.member_category IS
	'Matches lib_member_categories.category_code — learner, facilitator, and whatever else this college defines.';
COMMENT ON COLUMN lib_borrowers.myjkkn_id IS
	'MyJKKN learner or staff id. legacy:<uuid> for pre-MyJKKN members carried over by the 2026-08-22 backfill.';

-- The desk looks a borrower up by card number; the reports read a college's
-- whole list; the charges screen wants only those who owe.
CREATE INDEX IF NOT EXISTS idx_lib_borrowers_institution
	ON lib_borrowers(institution_id);
CREATE INDEX IF NOT EXISTS idx_lib_borrowers_number
	ON lib_borrowers(institution_id, member_number);
CREATE INDEX IF NOT EXISTS idx_lib_borrowers_delinquent
	ON lib_borrowers(institution_id, is_delinquent) WHERE is_delinquent = true;

ALTER TABLE lib_borrowers ENABLE ROW LEVEL SECURITY;

-- ── 2. Carry the existing history across ────────────────────────────────────
--
-- Every member id that any circulation table already points at gets a borrower
-- row with THE SAME id. That is the whole trick: once these exist, the foreign
-- keys below can be repointed without touching a single existing row, and no
-- loan, fine, hold, visit or inter-campus request loses who it belonged to.
--
-- Written as one dynamic statement because the notification log arrived in a
-- later migration and may not be applied on this database yet: naming a table
-- that does not exist would fail to parse even inside a branch that never runs.
DO $$
DECLARE
	referenced text :=
		'          SELECT member_id FROM lib_lending_transactions   WHERE member_id IS NOT NULL'
		' UNION ALL SELECT member_id FROM lib_resource_holds        WHERE member_id IS NOT NULL'
		' UNION ALL SELECT member_id FROM lib_late_charges          WHERE member_id IS NOT NULL'
		' UNION ALL SELECT member_id FROM lib_member_visits         WHERE member_id IS NOT NULL'
		' UNION ALL SELECT member_id FROM lib_intercampus_requests  WHERE member_id IS NOT NULL';
BEGIN
	IF to_regclass('public.lib_notification_log') IS NOT NULL THEN
		referenced := referenced ||
			' UNION ALL SELECT member_id FROM lib_notification_log WHERE member_id IS NOT NULL';
	END IF;

	EXECUTE format($sql$
		INSERT INTO lib_borrowers (
			id, institution_id, myjkkn_id, person_kind, member_number, member_category,
			display_name, email, phone, is_delinquent, first_borrowed_at, last_seen_at,
			created_at, updated_at
		)
		SELECT
			m.id,
			m.institution_id,
			-- The MyJKKN id, unless another carried-over row in the same college
			-- already claimed it. Only one borrower row may hold a given MyJKKN
			-- id per college, and quietly merging two of them would merge two
			-- people's fines — so a second one keeps its own history under a
			-- legacy marker instead, and is simply never matched to a MyJKKN
			-- person again.
			CASE
				WHEN m.myjkkn_key IS NULL OR m.claim_order > 1
					THEN 'legacy:' || m.id::text
				ELSE m.myjkkn_key
			END,
			CASE
				WHEN m.myjkkn_key IS NULL OR m.claim_order > 1 THEN 'legacy'
				WHEN m.learner_id IS NOT NULL                  THEN 'learner'
				ELSE 'facilitator'
			END,
			m.member_number,
			m.member_category,
			m.display_name,
			m.email,
			m.phone,
			COALESCE(m.is_delinquent, false),
			COALESCE(m.created_at, now()),
			COALESCE(m.updated_at, m.created_at, now()),
			COALESCE(m.created_at, now()),
			COALESCE(m.updated_at, m.created_at, now())
		FROM (
			SELECT
				lm.*,
				COALESCE(lm.learner_id::text, lm.facilitator_id::text, lm.team_member_id::text) AS myjkkn_key,
				row_number() OVER (
					PARTITION BY lm.institution_id,
						COALESCE(lm.learner_id::text, lm.facilitator_id::text, lm.team_member_id::text)
					ORDER BY lm.created_at NULLS LAST, lm.id
				) AS claim_order
			FROM lib_members lm
			WHERE lm.id IN (SELECT DISTINCT member_id FROM (%s) AS referenced)
		) AS m
		ON CONFLICT DO NOTHING
	$sql$, referenced);
END $$;

-- Members who never borrowed and never walked through the gate are not copied.
-- They are not lost — they are still in lib_members — they simply are not
-- borrowers, which is what this table is for.

-- ── 3. Point the foreign keys at the new table ──────────────────────────────
--
-- The constraint is found rather than named: a database built from a different
-- file may have named it something else, and dropping a guessed name would
-- silently leave the old rule in force while appearing to have worked.

DO $$
DECLARE
	target   record;
	existing record;
BEGIN
	FOR target IN
		SELECT * FROM (VALUES
			('lib_lending_transactions',   'RESTRICT'),
			('lib_resource_holds',         'CASCADE'),
			('lib_late_charges',           'RESTRICT'),
			('lib_member_visits',          'SET NULL'),
			('lib_intercampus_requests',   'RESTRICT'),
			('lib_notification_log',       'CASCADE')
		) AS t(table_name, on_delete)
	LOOP
		CONTINUE WHEN to_regclass('public.' || target.table_name) IS NULL;

		-- Drop whatever currently ties this table's member_id to lib_members
		FOR existing IN
			SELECT con.conname
			FROM pg_constraint con
			JOIN pg_attribute att
				ON att.attrelid = con.conrelid
			 AND att.attnum = ANY (con.conkey)
			WHERE con.conrelid = ('public.' || target.table_name)::regclass
				AND con.contype = 'f'
				AND att.attname = 'member_id'
		LOOP
			EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.table_name, existing.conname);
		END LOOP;

		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (member_id) REFERENCES lib_borrowers(id) ON DELETE %s',
			target.table_name,
			target.table_name || '_member_id_borrower_fkey',
			target.on_delete
		);
	END LOOP;
END $$;

-- ── 4. The gate remembers who walked in, without making them a borrower ─────
--
-- Walking into the library is not borrowing, so a gate scan must not write a
-- borrower row — that is the rule this whole change turns on. The visit
-- therefore carries the person itself: who they were in MyJKKN, and what the
-- register needs to print. member_id stays for the visits already recorded and
-- is simply left NULL from now on.

ALTER TABLE lib_member_visits
	ADD COLUMN IF NOT EXISTS myjkkn_id       TEXT,
	ADD COLUMN IF NOT EXISTS person_kind     TEXT,
	ADD COLUMN IF NOT EXISTS member_number   TEXT,
	ADD COLUMN IF NOT EXISTS display_name    TEXT,
	ADD COLUMN IF NOT EXISTS member_category TEXT;

COMMENT ON COLUMN lib_member_visits.myjkkn_id IS
	'Who walked in, as MyJKKN knows them. NULL on visits recorded before 2026-08-22, which use member_id instead.';

-- Fill the snapshot for visits already recorded, so today's register and last
-- year's read the same way and nothing has to fall back to a join.
UPDATE lib_member_visits v
SET
	myjkkn_id       = COALESCE(m.learner_id::text, m.facilitator_id::text, m.team_member_id::text),
	person_kind     = CASE
		WHEN m.learner_id     IS NOT NULL THEN 'learner'
		WHEN m.facilitator_id IS NOT NULL THEN 'facilitator'
		ELSE 'legacy'
	END,
	member_number   = m.member_number,
	display_name    = m.display_name,
	member_category = m.member_category
FROM lib_members m
WHERE v.member_id = m.id
	AND v.member_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_visits_person
	ON lib_member_visits(institution_id, myjkkn_id, visit_date)
	WHERE myjkkn_id IS NOT NULL;

-- ── 5. What was NOT done, on purpose ────────────────────────────────────────
--
--   * lib_members is not dropped, not emptied and not altered. It is now a
--     historical roll: nothing writes to it any more, and the pages that used
--     to read it read MyJKKN instead.
--   * No row is deleted anywhere. Every loan, fine, hold, visit and request
--     that existed before this migration still points at the same person.
