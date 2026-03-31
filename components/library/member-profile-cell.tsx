'use client'

import { useState, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { getCachedProfile, setCachedProfile } from '@/lib/myjkkn-profile-cache'
import type { LibMemberCategory } from '@/types/lib'

interface MemberProfileCellProps {
	memberCategory: LibMemberCategory
	learnerId?: string | null
	facilitatorId?: string | null
	fallbackName?: string | null
}

interface ResolvedProfile {
	name: string
	identifier: string
	photoUrl?: string
	subtitle?: string
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
}: MemberProfileCellProps) {
	const [profile, setProfile] = useState<ResolvedProfile | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState(false)

	const needsFetch =
		(memberCategory === 'learner' && !!learnerId) ||
		(memberCategory === 'facilitator' && !!facilitatorId)

	const cacheKey = memberCategory === 'learner'
		? `learner:${learnerId}`
		: `facilitator:${facilitatorId}`

	useEffect(() => {
		if (!needsFetch) return

		const cached = getCachedProfile<ResolvedProfile>(cacheKey)
		if (cached) {
			setProfile(cached)
			return
		}

		let cancelled = false

		const fetchProfile = async () => {
			setLoading(true)
			setError(false)
			try {
				const apiId = memberCategory === 'learner' ? learnerId : facilitatorId
				// Learner: use students/[id] which proxies to /api-management/learners/profiles/{id}
				// Staff: use staff/[id] which proxies to /api-management/staff/{id}
				const endpoint = memberCategory === 'learner'
					? `/api/myjkkn/students/${apiId}`
					: `/api/myjkkn/staff/${apiId}`

				const res = await fetch(endpoint)
				if (!res.ok) throw new Error('fetch failed')

				const json = await res.json()
				const d = json.data || json

				const resolved: ResolvedProfile = memberCategory === 'learner'
					? {
						name: [d.first_name, d.last_name].filter(Boolean).join(' '),
						identifier: d.roll_number || d.register_number || '',
						photoUrl: d.student_photo_url || d.profile_picture,
						subtitle: d.program_code || d.program?.program_name || '',
					}
					: {
						name: [d.first_name, d.last_name].filter(Boolean).join(' '),
						identifier: d.staff_id || d.staff_code || '',
						photoUrl: d.profile_picture || d.staff_photo_url,
						subtitle: d.designation || '',
					}

				if (!cancelled) {
					setProfile(resolved)
					setCachedProfile(cacheKey, resolved)
				}
			} catch {
				if (!cancelled) setError(true)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		fetchProfile()
		return () => { cancelled = true }
	}, [needsFetch, cacheKey, memberCategory, learnerId, facilitatorId])

	if (loading) {
		return (
			<div className="flex items-center gap-2.5">
				<Skeleton className="h-8 w-8 rounded-full" />
				<div className="space-y-1">
					<Skeleton className="h-3.5 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
			</div>
		)
	}

	if (profile && !error) {
		const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name)}&backgroundColor=059669&textColor=ffffff&fontSize=40`
		return (
			<div className="flex items-center gap-2.5">
				<Avatar className="h-8 w-8">
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

	const displayName = fallbackName || 'Unknown Member'
	const diceBearUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=6b7280&textColor=ffffff&fontSize=40`
	return (
		<div className="flex items-center gap-2.5">
			<Avatar className="h-8 w-8">
				<AvatarImage src={diceBearUrl} alt={displayName} />
				<AvatarFallback className="text-xs">{getInitials(displayName)}</AvatarFallback>
			</Avatar>
			<div className="text-sm font-medium truncate">{displayName}</div>
		</div>
	)
}
