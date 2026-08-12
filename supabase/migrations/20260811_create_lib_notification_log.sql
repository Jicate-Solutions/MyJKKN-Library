-- =============================================================================
-- Library notification log
-- Records every reminder email sent from the library so the same member is not
-- emailed twice for the same loan/hold on the same day, and so librarians can
-- see what was already sent.
--
-- NOT YET APPLIED — run this in Supabase SQL Editor before using "Send Reminders".
-- The API degrades gracefully if this table is missing (it just skips logging),
-- but without it the duplicate-send guard cannot work.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lib_notification_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  member_id             UUID NOT NULL REFERENCES lib_members(id) ON DELETE CASCADE,
  notification_type     TEXT NOT NULL CHECK (notification_type IN ('overdue', 'hold_available')),
  -- The loan or hold this reminder was about
  reference_id          UUID,
  recipient_email       TEXT NOT NULL,
  subject               TEXT,
  send_status           TEXT NOT NULL DEFAULT 'sent' CHECK (send_status IN ('sent', 'failed', 'skipped')),
  error_message         TEXT,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by               UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_notification_log_institution
  ON lib_notification_log(institution_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_lib_notification_log_member
  ON lib_notification_log(member_id, notification_type, sent_at DESC);

-- Duplicate guard: one successful reminder per reference per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_notification_log_daily_unique
  ON lib_notification_log(reference_id, notification_type, (sent_at::date))
  WHERE send_status = 'sent' AND reference_id IS NOT NULL;

ALTER TABLE lib_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages notification log" ON lib_notification_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
