'use client'

import { Badge } from '@/components/ui/badge'
import type { LibItemStatus } from '@/types/lib'

interface ResourceStatusBadgeProps {
	status: LibItemStatus
	className?: string
}

const statusConfig: Record<LibItemStatus, { label: string; className: string }> = {
	available: {
		label: 'Available',
		className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
	},
	on_loan: {
		label: 'On Loan',
		className: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
	},
	on_hold: {
		label: 'On Hold',
		className: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
	},
	on_order: {
		label: 'On Order',
		className: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
	},
	in_conservation: {
		label: 'In Conservation',
		className: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800',
	},
	lost: {
		label: 'Lost',
		className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
	},
	damaged: {
		label: 'Damaged',
		className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
	},
	retired: {
		label: 'Retired',
		className: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800',
	},
	missing: {
		label: 'Missing',
		className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800',
	},
}

export function ResourceStatusBadge({ status, className }: ResourceStatusBadgeProps) {
	const config = statusConfig[status] ?? {
		label: status,
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
