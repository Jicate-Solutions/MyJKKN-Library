-- ===========================================================================
-- An issue that has not arrived yet has no received date.
--
-- `lib_periodical_issues.received_date` was NOT NULL DEFAULT CURRENT_DATE,
-- which is right for the only thing the table used to hold — an issue somebody
-- was recording because it had just come in.
--
-- A subscription now writes its whole year out in advance: a monthly journal
-- creates twelve rows marked 'expected' the day it is registered, and they wait
-- there until each one arrives. With the old default every one of those twelve
-- would be stamped as received today, and the register would read as a year's
-- issues all delivered on the day the subscription was opened — which is both
-- untrue and exactly the figure a claim to the supplier is argued from.
--
-- So the column becomes optional. Nothing else changes: an issue actually being
-- received still carries the date it came in, every row already in the table
-- keeps the date it has, and the default is deliberately left in place so any
-- older code path that inserts without naming the column behaves as it always
-- did.
--
-- Safe to run more than once.
-- ===========================================================================

alter table lib_periodical_issues
	alter column received_date drop not null;
