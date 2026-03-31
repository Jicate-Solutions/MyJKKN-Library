'use client'

import { useMemo } from 'react'
import { differenceInDays, parseISO, isAfter } from 'date-fns'
import { AlertCircle, CheckCircle } from 'lucide-react'

interface LateChargeCalculatorProps {
	dueDate: string
	chargePerDay: number
}

export function LateChargeCalculator({ dueDate, chargePerDay }: LateChargeCalculatorProps) {
	const { daysOverdue, amount, isOverdue } = useMemo(() => {
		try {
			const due = parseISO(dueDate)
			const now = new Date()
			const isOverdue = isAfter(now, due)
			const days = isOverdue ? differenceInDays(now, due) : 0
			const amount = days * chargePerDay
			return { daysOverdue: days, amount, isOverdue }
		} catch {
			return { daysOverdue: 0, amount: 0, isOverdue: false }
		}
	}, [dueDate, chargePerDay])

	if (!isOverdue) {
		return (
			<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
				<CheckCircle className="h-4 w-4" />
				<span>Not overdue</span>
			</div>
		)
	}

	return (
		<div className="flex items-center gap-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
			<AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
			<div className="text-sm">
				<span className="font-medium text-red-700 dark:text-red-400">
					{daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} overdue
				</span>
				<span className="text-red-600 dark:text-red-300 ml-2">
					— Late charge: <span className="font-bold">&#8377;{amount.toFixed(2)}</span>
				</span>
			</div>
		</div>
	)
}
