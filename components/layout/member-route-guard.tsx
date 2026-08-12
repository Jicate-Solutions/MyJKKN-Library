'use client'

/**
 * Keeps a `member` on the pages they are allowed to see.
 *
 * The sidebar already hides the rest, but a typed URL would still render an
 * empty shell before the API refused it. This sends them back to Circulation
 * instead. It is a redirect, not a security boundary — the guards on
 * `/api/lib/*` are what actually refuse the data.
 */

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLibraryRole } from '@/hooks/use-library-role'
import { isMemberAllowedPage, MEMBER_HOME } from '@/lib/auth/member-access'

export function MemberRouteGuard({ children }: { children: React.ReactNode }) {
	const { isMember, isReady } = useLibraryRole()
	const pathname = usePathname()
	const router = useRouter()

	const blocked = isReady && isMember && !isMemberAllowedPage(pathname)

	useEffect(() => {
		if (blocked) router.replace(MEMBER_HOME)
	}, [blocked, router])

	// Render nothing while redirecting, so no other module's data flashes up
	if (blocked) return null

	return <>{children}</>
}
