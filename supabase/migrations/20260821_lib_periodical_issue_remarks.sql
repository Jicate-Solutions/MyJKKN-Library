-- A note against one issue of a periodical.
--
-- The register needs somewhere to say why an issue is marked missing, what the
-- supplier said when it was claimed, or that this copy arrived torn — the kind
-- of thing that is written in the margin of a paper register today and has had
-- nowhere to go here.
--
-- Nullable, because almost every issue arrives with nothing worth noting.
-- Safe to run more than once.

ALTER TABLE lib_periodical_issues
	ADD COLUMN IF NOT EXISTS remarks TEXT;

COMMENT ON COLUMN lib_periodical_issues.remarks IS
	'Free note against this issue — why it is missing, what the supplier said, condition on arrival.';
