'use client'

/**
 * Gate Entry.
 *
 * One screen for every campus. Pharmacy had the fuller one first — a past-day
 * register, a date range, manual exits, an export, server-stamped IST times —
 * and on 3 Sep 2026 the other six were given the same, so a gate report can be
 * pulled for any college over any day or run of days.
 */

import { GateEntry } from '@/components/library/gate-entry'

export default function GateEntryPage() {
	return <GateEntry />
}
