-- "Other" as a member category, with the librarian's own word for it.
--
-- The Add Member form now offers three categories: Learner, Facilitator and
-- Other. Learner and Facilitator come from MyJKKN; Other is everyone else the
-- library lends to — a research scholar, a visiting doctor, a school teacher —
-- and the librarian types what to call them.
--
-- Two changes, both safe to run more than once:
--   1. member_category accepts 'other'. The three older codes stay allowed so
--      any row already saved under them keeps working; the form no longer
--      offers them.
--   2. category_label holds the typed word. NULL for Learner and Facilitator,
--      whose names are fixed.
--
-- The constraint is dropped by looking it up rather than by name — a database
-- created from a different migration file may have named it something else,
-- and dropping the wrong name would silently leave the old rule in force.

DO $$
DECLARE existing record;
BEGIN
	FOR existing IN
		SELECT conname
		FROM pg_constraint
		WHERE conrelid = 'lib_members'::regclass
			AND contype = 'c'
			AND pg_get_constraintdef(oid) ILIKE '%member_category%'
	LOOP
		EXECUTE format('ALTER TABLE lib_members DROP CONSTRAINT %I', existing.conname);
	END LOOP;
END $$;

ALTER TABLE lib_members
	ADD CONSTRAINT lib_members_member_category_check
	CHECK (member_category IN ('learner', 'facilitator', 'other', 'team_member', 'guest', 'alumni'));

ALTER TABLE lib_members
	ADD COLUMN IF NOT EXISTS category_label TEXT;

COMMENT ON COLUMN lib_members.category_label IS 'What the librarian calls this member when the category is Other. NULL for Learner and Facilitator.';
