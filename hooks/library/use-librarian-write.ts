'use client'

/**
 * Whether the person at the screen may make the changes only a librarian may.
 *
 * The same line `lib/auth/librarian-only.ts` draws for the API, read on the
 * client so a screen can leave out the button the server would refuse. Until
 * the role is known it answers true: a librarian should not watch their
 * buttons appear a moment late, and the server refuses an assistant either way.
 */

import { useLibraryRole } from '@/hooks/use-library-role'
import { canLibrarianWrite } from '@/lib/auth/librarian-only'

export function useLibrarianWrite(): boolean {
	const { role } = useLibraryRole()
	return role === null ? true : canLibrarianWrite(role)
}
