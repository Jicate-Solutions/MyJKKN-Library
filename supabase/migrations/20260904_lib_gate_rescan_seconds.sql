-- The gate's guard against a card swiped twice.
--
-- A student in the queue scans, is not sure it took, and scans again. The
-- second scan was read as an exit, so the register showed a one-minute visit
-- and the footfall counted them twice. This is the window, per college, within
-- which a second scan of the same card is the same entry: the gate answers
-- "already in" and does nothing. 0 turns it off.
--
-- Safe to run more than once. A college with no settings row keeps the code
-- default (60 seconds) until it saves its rules.

alter table lib_institution_settings
	add column if not exists gate_rescan_seconds integer not null default 60;

comment on column lib_institution_settings.gate_rescan_seconds is
	'Seconds within which a repeat scan of the same card at the gate is ignored rather than recorded as an exit. 0 = off.';
