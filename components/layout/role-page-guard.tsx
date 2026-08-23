'use client'

/**
 * Stops a page being opened by typing its address.
 *
 * Hiding a page from the menu is not the same as closing it, and a menu is the
 * first thing anybody works around. This sits above every page in the library
 * layout and checks the path against the same rule the menu used, so a page a
 * role was not given cannot be reached by hand either.
 *
 * It explains rather than redirects. Bouncing somebody to the dashboard leaves
 * them wondering whether the link was broken; naming the page and saying who
 * to ask ends it in one screen.
 *
 * The sidebar stays on purpose — they are library staff who took a wrong turn,
 * not strangers, and the rest of their menu is still theirs.
 */

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useLibraryRole } from '@/hooks/use-library-role'
import { canOpenPath, pageForPath } from '@/lib/auth/role-pages'
import { ROLE_LABEL } from '@/lib/auth/library-roles'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lock, ArrowLeft } from 'lucide-react'

export function RolePageGuard({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const { role, isReady, pages } = useLibraryRole()

	// Until the answer is in, draw the page. The layout above this one already
	// holds everything back until access itself is settled, so there is nothing
	// on screen yet to flash.
	if (!isReady) return <>{children}</>

	if (canOpenPath(role, pathname, pages)) return <>{children}</>

	const page = pageForPath(pathname)
	const roleLabel = role ? ROLE_LABEL[role] : 'Your role'

	return (
		<div className="flex flex-1 items-center justify-center p-4">
			<Card className="w-full max-w-md border-l-4 border-l-brand-yellow">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-yellow-100 dark:bg-brand-yellow-900/20">
						<Lock className="h-7 w-7 text-brand-yellow-800 dark:text-brand-yellow-500" />
					</div>

					<div className="space-y-1">
						<h1 className="text-lg font-semibold font-heading">
							{page ? `${page.title} is not part of your role` : 'This page is not part of your role'}
						</h1>
						<p className="text-sm text-muted-foreground">
							{roleLabel} does not include this page in this library. Everything else in
							your menu is still yours.
						</p>
					</div>

					<p className="text-xs text-muted-foreground">
						A super admin decides this on the Role Management screen. Ask them if you
						need this page for your work.
					</p>

					<Button asChild variant="outline" size="sm">
						<Link href="/dashboard">
							<ArrowLeft className="mr-1.5 h-4 w-4" />
							Back to the dashboard
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	)
}
