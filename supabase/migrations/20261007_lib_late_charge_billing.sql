-- ─────────────────────────────────────────────────────────────────────────────
-- A library fine the learner can pay in MyJKKN.
--
-- Until now a fine was settled at the counter: the librarian took the cash and
-- pressed Paid, or let it off with Waive. A learner with no money on them had
-- to come back, and the book could not go back until they did.
--
-- So a fine can now be put on their MyJKKN bill instead, beside their tuition
-- and hostel fees. The library writes one row into MyJKKN's
-- `billing_student_bills` and keeps two things here:
--
--   billing_student_bill_id   the bill it raised, so this fine can read its
--                             status back and show Paid the moment the learner
--                             pays — the library never decides that itself.
--
--   billing_idempotency_key   what stops one fine becoming two bills. A retry,
--                             a double click or a second desk all build the
--                             same key, and the unique index below refuses the
--                             second bill rather than charging twice. The
--                             transport module (`tms_fee_fine`) carries the
--                             same pair for the same reason.
--
-- Nothing already recorded changes: both columns are null on every existing
-- row, which means "settled at the counter, as before".
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lib_late_charges
	add column if not exists billing_student_bill_id uuid,
	add column if not exists billing_idempotency_key text;

comment on column public.lib_late_charges.billing_student_bill_id is
	'The MyJKKN billing_student_bills row raised for this fine, when it was billed instead of collected at the desk. Null means it was settled at the counter.';

comment on column public.lib_late_charges.billing_idempotency_key is
	'One key per fine, so a retry cannot raise a second bill for it.';

-- One bill per fine, enforced rather than hoped for. Partial, because every
-- fine settled at the counter has no key and there are thousands of those.
create unique index if not exists lib_late_charges_billing_key_uniq
	on public.lib_late_charges (billing_idempotency_key)
	where billing_idempotency_key is not null;

-- Reading a fine back from its bill, and finding the fines waiting on a payment
create index if not exists lib_late_charges_billing_bill_idx
	on public.lib_late_charges (billing_student_bill_id)
	where billing_student_bill_id is not null;
