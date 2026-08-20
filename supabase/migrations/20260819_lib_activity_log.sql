-- The activity log: who did what in the library, and when.
--
-- One append-only stream for every college. It answers the questions a
-- principal or an auditor actually asks — who deleted that book, who changed
-- the fine rate, who was at the desk when this member was enrolled — without
-- anyone having to read seven separate tables.
--
-- Three rules this table lives by:
--   * Append-only. Nothing updates a row, nothing deletes one except the
--     retention job below. An editable log is not a log.
--   * Best-effort. Writing it must never fail the work it describes, so every
--     insert is swallowed on error by the code that writes it.
--   * Scoped. institution_id says whose library the action belongs to, so a
--     college's staff read their own trail and nobody else's. NULL means the
--     action was not about one college (a super admin acting across all).
--
-- Deliberately no foreign keys on user_id / session_id: the log must survive a
-- user being deleted, and names are resolved when the console reads it.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS lib_activity_log (
	id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	institution_id UUID,
	user_id        UUID,
	session_id     UUID,
	action         TEXT NOT NULL,
	resource_type  TEXT,
	resource_id    TEXT,
	old_values     JSONB,
	new_values     JSONB,
	ip_address     TEXT,
	user_agent     TEXT,
	status         TEXT NOT NULL DEFAULT 'success'
	               CHECK (status IN ('success', 'error', 'pending')),
	error_message  TEXT,
	metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  lib_activity_log                IS 'Append-only record of what people did in the library system. Operational, not legal — best-effort and lossy under failure.';
COMMENT ON COLUMN lib_activity_log.institution_id IS 'Whose library this action belongs to. NULL when it is not about one college.';
COMMENT ON COLUMN lib_activity_log.user_id        IS 'Resolved server-side from the session token, never taken from the request.';
COMMENT ON COLUMN lib_activity_log.resource_id    IS 'The page path for screen events, the business key for record changes.';
COMMENT ON COLUMN lib_activity_log.old_values     IS 'The record as it was, read before the change. Secrets are stripped before writing.';
COMMENT ON COLUMN lib_activity_log.new_values     IS 'The record as it was written — the saved row, not the request body.';

-- The console reads newest-first, always inside one college
CREATE INDEX IF NOT EXISTS idx_lib_activity_created
	ON lib_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lib_activity_institution
	ON lib_activity_log (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lib_activity_user
	ON lib_activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lib_activity_action
	ON lib_activity_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lib_activity_resource
	ON lib_activity_log (resource_type, resource_id);
-- Errors are the hottest non-default filter: what went wrong today
CREATE INDEX IF NOT EXISTS idx_lib_activity_errors
	ON lib_activity_log (created_at DESC)
	WHERE status = 'error';

-- Every read and write goes through the service-role server client, which is
-- guarded per route. No policy is granted to anon or authenticated.
ALTER TABLE lib_activity_log ENABLE ROW LEVEL SECURITY;

/*
 * Keeping the log from eating the database.
 *
 * Screen movement is high-volume and low-value — a busy desk produces hundreds
 * of page views a day and nobody asks about them a month later. Changes to
 * books, members, money and rules are the opposite, and stay for two years.
 *
 * Run daily. Decide the windows before go-live: this is a promise about how
 * long the library keeps a record of what its staff did, not a tuning knob.
 */
CREATE OR REPLACE FUNCTION purge_lib_activity_log() RETURNS void AS $$
BEGIN
	DELETE FROM lib_activity_log
	WHERE created_at < now() - INTERVAL '90 days'
	  AND action IN ('navigation', 'page_view', 'click', 'search');

	DELETE FROM lib_activity_log
	WHERE created_at < now() - INTERVAL '2 years';
END;
$$ LANGUAGE plpgsql;
