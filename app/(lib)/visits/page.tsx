'use client'

/**
 * Gate Entry.
 *
 * Pharmacy runs its gate differently — server-stamped IST times, a past-day
 * register, manual exits, an export — so it gets its own screen. Every other
 * campus keeps the screen it already had, unchanged, in StandardGateEntry.
 */

import { useInstitution } from '@/context/institution-context'
import { usesPharmacyRegister } from '@/lib/library/catalogue-options'
import { PharmacyGateEntry } from '@/components/library/pharmacy-gate-entry'
import { StandardGateEntry } from '@/components/library/standard-gate-entry'

export default function GateEntryPage() {
	const { currentInstitutionCode } = useInstitution()

	return usesPharmacyRegister(currentInstitutionCode)
		? <PharmacyGateEntry />
		: <StandardGateEntry />
}
