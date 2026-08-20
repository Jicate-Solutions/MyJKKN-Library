'use client'

/**
 * The one place that records a screen being opened.
 *
 * Mounted once inside the library layout, so every page is counted without any
 * page having to remember to count itself. It draws nothing.
 *
 * It also tells the log which library is being looked at, so a line can later
 * be read back by the college it belongs to rather than landing in a common
 * pile that no principal can filter.
 */

import { useEffect } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useActivityLog } from '@/hooks/use-transaction-log'
import { activityLog } from '@/services/library/activity-log-service'

export function ActivityTracker() {
	const { institutionId, isReady } = useInstitutionFilter()

	useEffect(() => {
		if (isReady) activityLog.setInstitution(institutionId ?? null)
	}, [isReady, institutionId])

	useActivityLog({ trackPageViews: true })

	return null
}
