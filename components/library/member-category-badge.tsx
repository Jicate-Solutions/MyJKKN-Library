'use client'

import { Badge } from '@/components/ui/badge'
import type { LibMemberCategory } from '@/types/lib'

interface MemberCategoryBadgeProps {
	category: LibMemberCategory
	className?: string
}

const categoryConfig: Record<LibMemberCategory, { label: string; className: string }> = {
	learner: {
		label: 'Learner',
		className: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
	},
	facilitator: {
		label: 'Facilitator',
		className: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
	},
	team_member: {
		label: 'Team Member',
		className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
	},
	guest: {
		label: 'Guest',
		className: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
	},
	alumni: {
		label: 'Alumni',
		className: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800',
	},
}

export function MemberCategoryBadge({ category, className }: MemberCategoryBadgeProps) {
	const config = categoryConfig[category] ?? {
		label: category,
		className: 'bg-gray-100 text-gray-800 border-gray-200',
	}

	return (
		<Badge
			variant="outline"
			className={`text-xs font-medium ${config.className} ${className ?? ''}`}
		>
			{config.label}
		</Badge>
	)
}
