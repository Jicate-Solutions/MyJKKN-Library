'use client'

/**
 * Recording what a person does on screen, from a component.
 *
 * A thin wrapper over the batching service, plus the one thing a hook can do
 * that a service cannot: watch the address bar and record a page being opened
 * without every page having to remember to say so.
 *
 * The navigation call was pointed at a route that never existed, so every menu
 * click quietly produced a 404 and no record of anything. It now goes to the
 * batch endpoint with the rest.
 */

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { activityLog } from '@/services/library/activity-log-service'

interface NavigationLogParams {
	to_path: string
	menu_title?: string
	menu_section?: string
}

/** The sidebar's version: one call, one menu click. */
export function useNavigationLog() {
	const logNavigation = useCallback(async (params: NavigationLogParams) => {
		activityLog.logNavigation(params.to_path, {
			menu_title: params.menu_title,
			menu_section: params.menu_section,
		})
	}, [])

	return { logNavigation }
}

/**
 * Everything a page might want to record.
 *
 * With `trackPageViews` it also reports the page itself: the first screen as a
 * page view, and each move after it as navigation carrying where it came from.
 * A repeated path is ignored, because React may render the same route twice
 * and two rows for one arrival would be a lie.
 */
export function useActivityLog(options: { trackPageViews?: boolean } = {}) {
	const pathname = usePathname()
	const lastPath = useRef<string | null>(null)

	useEffect(() => {
		if (!options.trackPageViews || !pathname) return
		if (lastPath.current === pathname) return

		if (lastPath.current === null) {
			activityLog.logPageView(pathname)
		} else {
			activityLog.logNavigation(pathname, { from_path: lastPath.current })
		}
		lastPath.current = pathname
	}, [pathname, options.trackPageViews])

	return {
		log: activityLog.log.bind(activityLog),
		queueLog: activityLog.queueLog.bind(activityLog),
		logNavigation: activityLog.logNavigation.bind(activityLog),
		logPageView: activityLog.logPageView.bind(activityLog),
		logClick: activityLog.logClick.bind(activityLog),
		logSearch: activityLog.logSearch.bind(activityLog),
		logFileOperation: activityLog.logFileOperation.bind(activityLog),
		logError: activityLog.logError.bind(activityLog),
		logAuth: activityLog.logAuth.bind(activityLog),
	}
}
