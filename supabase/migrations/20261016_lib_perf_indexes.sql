-- ─────────────────────────────────────────────────────────────────────────────
-- Three indexes for reads the desk already does on every scan.
--
-- Nothing about what the library does changes here. These are indexes only:
-- the same rows come back, in the same order, to the same code. Postgres is
-- simply told where to find them instead of walking the table.
--
-- Each one answers a query that is already in the app:
--
--  1. Settling a fine, and showing whether a late book has been cleared, asks
--     lib_late_charges for the charges on a set of loans (late-fine.ts,
--     settledChargesFor). That runs on every card scan where something is
--     late, twice — once for paid/waived, once for billed — and there is no
--     index on transaction_id, so both halves scan the table.
--
--  2. Every card scan also asks which of this college's fines are sitting on
--     a MyJKKN bill, so money paid over there clears here (myjkkn-billing.ts,
--     syncBilledForScope). It is a narrow question — unpaid or partly paid,
--     and on a bill — so a partial index covers it and stays small.
--
--  3. The Activity Log page reads newest-first within one college. The log is
--     the fastest growing table in the library and the only index on it is for
--     text search, so the ordering is done by sorting the whole college's
--     history on every page.
--
-- Safe to run twice: every statement is IF NOT EXISTS. None of them is
-- CONCURRENTLY, because the Supabase SQL editor runs a script as a single
-- transaction and CONCURRENTLY is refused inside one.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The charges on a loan — both halves of settledChargesFor.
CREATE INDEX IF NOT EXISTS idx_lib_charges_txn
	ON lib_late_charges(transaction_id);

-- 2. This college's fines that are still owed and already on a MyJKKN bill.
CREATE INDEX IF NOT EXISTS idx_lib_charges_on_bill
	ON lib_late_charges(institution_id, payment_status)
	WHERE billing_student_bill_id IS NOT NULL;

-- 3. The Activity Log, newest first, one college at a time.
CREATE INDEX IF NOT EXISTS idx_lib_log_recent
	ON lib_activity_log(institution_id, created_at DESC);

-- Fresh statistics, so the planner starts using them immediately rather than
-- after the next autovacuum.
ANALYZE lib_late_charges;
ANALYZE lib_activity_log;
