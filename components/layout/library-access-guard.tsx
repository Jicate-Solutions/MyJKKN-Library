'use client'

/**
 * The door to the library.
 *
 * Only four MyJKKN roles open this application — super_admin, library_admin,
 * librarian, assistant_librarian. Somebody signed in to MyJKKN with any other
 * role is a real person with a real account; they are simply not library staff,
 * and they see this instead of an empty application.
 *
 * It is a courtesy, not a security boundary: every `/api/lib/*` route refuses
 * them on its own, so hiding the screen only saves them from a page of failed
 * requests. The refusal names what MyJKKN calls them and what the library would
 * have needed, because "access denied" with nothing else is the kind of message
 * that generates a phone call.
 */

import { useLibraryRole } from '@/hooks/use-library-role'
import { Card, CardContent } from '@/components/ui/card'
import { Lock, RefreshCw } from 'lucide-react'

/** `library_admin` reads better as "Library Admin" on a page meant to be read. */
function readable(roleKey: string): string {
	return roleKey
		.split('_')
		.filter(Boolean)
		.map(word => word[0].toUpperCase() + word.slice(1))
		.join(' ')
}

function AccessRestricted({
	fullName,
	email,
	myjkknRoles,
	libraryRoles,
	reason,
}: {
	fullName: string | null
	email: string | null
	myjkknRoles: string[]
	libraryRoles: string[]
	reason: string | null
}) {
	const explanation =
		reason === 'not_staff'
			? 'MyJKKN has no staff record for this account.'
			: reason === 'inactive'
				? 'Your MyJKKN account is not active.'
				: reason === 'no_institution'
					? 'Your MyJKKN college is not set up as a library yet.'
					: 'Your MyJKKN role does not open the library.'

	return (
		<div className="flex flex-1 items-center justify-center p-4">
			<Card className="w-full max-w-md border-destructive/30">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
						<Lock className="h-7 w-7 text-destructive" />
					</div>

					<div className="space-y-1">
						<h1 className="text-lg font-semibold font-heading">Access restricted</h1>
						<p className="text-sm text-muted-foreground">{explanation}</p>
					</div>

					{(fullName || email) && (
						<div className="w-full rounded-md border bg-muted/40 px-4 py-3 text-left text-sm">
							{fullName && <p className="font-medium">{fullName}</p>}
							{email && <p className="text-xs text-muted-foreground">{email}</p>}
							{myjkknRoles.length > 0 && (
								<p className="mt-2 text-xs text-muted-foreground">
									Your MyJKKN role
									{myjkknRoles.length > 1 ? 's' : ''}:{' '}
									<span className="font-medium text-foreground">
										{myjkknRoles.map(readable).join(', ')}
									</span>
								</p>
							)}
						</div>
					)}

					{libraryRoles.length > 0 && (
						<div className="w-full text-left">
							<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								The library needs one of
							</p>
							<ul className="mt-2 space-y-1">
								{libraryRoles.map(role => (
									<li key={role} className="text-sm">
										· {readable(role)}
									</li>
								))}
							</ul>
						</div>
					)}

					<p className="text-xs text-muted-foreground">
						Roles are set in MyJKKN, not here. Ask whoever manages MyJKKN staff to add one of
						these to your account, then sign in again.
					</p>
				</CardContent>
			</Card>
		</div>
	)
}

export function LibraryAccessGuard({ children }: { children: React.ReactNode }) {
	const { isReady, allowed, fullName, email, myjkknRoles, libraryRoles, reason } = useLibraryRole()

	// Nothing is drawn until the answer is in. A flash of the application before
	// the restricted page would show a person data they may not have.
	if (!isReady) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<div className="flex flex-col items-center gap-2 text-muted-foreground">
					<RefreshCw className="h-5 w-5 animate-spin" />
					<span className="text-sm">Checking your access…</span>
				</div>
			</div>
		)
	}

	if (allowed === false) {
		return (
			<AccessRestricted
				fullName={fullName}
				email={email}
				myjkknRoles={myjkknRoles}
				libraryRoles={libraryRoles}
				reason={reason}
			/>
		)
	}

	return <>{children}</>
}
