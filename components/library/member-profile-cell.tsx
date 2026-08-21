'use client'

/**
 * One member, as the members table shows them: photo, real name, roll number.
 *
 * This used to fetch its own profile from MyJKKN, once per row — which meant a
 * page of fifty rows opened fifty external calls at the same moment, with
 * nothing capping a slow one. The page now asks for everyone on it in a single
 * request and passes the answer down, so this component only draws.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import type { LibMemberCategory } from '@/types/lib'
import type { MyjkknProfile } from '@/lib/library/myjkkn-profile'

interface MemberProfileCellProps {
	memberCategory: LibMemberCategory
	learnerId?: string | null
	facilitatorId?: string | null
	fallbackName?: string | null
	/** From the page's one lookup: the profile, or null when MyJKKN has none. */
	profile?: MyjkknProfile | null
	/** True while that lookup is still out for this row. */
	loading?: boolean
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map(w => w[0])
		.filter(Boolean)
		.slice(0, 2)
		.join('')
		.toUpperCase()
}

export function MemberProfileCell({
	memberCategory,
	learnerId,
	facilitatorId,
	fallbackName,
	profile,
	loading,
}: MemberProfileCellProps) {
	// Only rows that stand for a MyJKKN person are ever waiting on one
	const fromMyjkkn =
		(memberCategory === 'learner' && !!learnerId) ||
		(memberCategory === 'facilitator' && !!facilitatorId)

	if (fromMyjkkn && loading && !profile) {
		return (
			<div className="flex items-center gap-2.5">
				<Skeleton className="h-8 w-8 rounded-full shrink-0" />
				<div className="space-y-1">
					<Skeleton className="h-3.5 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
			</div>
		)
	}

	if (profile) {
		const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name)}&backgroundColor=059669&textColor=ffffff&fontSize=40`
		return (
			<div className="flex items-center gap-2.5">
				<Avatar className="h-8 w-8 shrink-0">
					<AvatarImage src={profile.photoUrl || diceBearUrl} alt={profile.name} />
					<AvatarFallback className="text-xs bg-blue-100 text-blue-700">
						{getInitials(profile.name)}
					</AvatarFallback>
				</Avatar>
				<div className="min-w-0">
					<div className="text-sm font-medium truncate">{profile.name}</div>
					<div className="text-xs text-muted-foreground truncate">
						{profile.identifier}{profile.subtitle ? ` · ${profile.subtitle}` : ''}
					</div>
				</div>
			</div>
		)
	}

	// No MyJKKN profile — theirs, or none was ever going to be asked for. The
	// name the library stored is still a name.
	const displayName = fallbackName || 'Unknown Member'
	const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=6b7280&textColor=ffffff&fontSize=40`
	return (
		<div className="flex items-center gap-2.5">
			<Avatar className="h-8 w-8 shrink-0">
				<AvatarImage src={diceBearUrl} alt={displayName} />
				<AvatarFallback className="text-xs">{getInitials(displayName)}</AvatarFallback>
			</Avatar>
			<div className="text-sm font-medium truncate">{displayName}</div>
		</div>
	)
}
