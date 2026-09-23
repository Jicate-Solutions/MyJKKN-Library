'use client'

/**
 * The departments this college offers, for any screen that has to ask for one.
 *
 * One source for every dropdown: the Departments List page — MyJKKN's
 * departments plus the ones the library added. A department switched off there
 * stops being offered here on the next load.
 *
 * While the list is still loading, or if it cannot be read at all, this falls
 * back to the per-college list that used to live in the code. Cataloguing must
 * not stop because MyJKKN is slow or a migration has not been run yet — that
 * list is exactly what the form offered before this hub existed.
 */

import { useState, useEffect } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { fetchDepartmentNames } from '@/services/library/lib-departments-service'
import { departmentsFor } from '@/lib/library/catalogue-options'

export function useDepartments(): { departments: string[]; loading: boolean } {
	const { isReady, institutionId, institutionCode } = useInstitutionFilter()
	const [departments, setDepartments] = useState<string[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		if (!isReady || !institutionId) {
			setDepartments([])
			setLoading(false)
			return
		}

		let cancelled = false
		setLoading(true)
		fetchDepartmentNames(institutionId)
			.then(names => { if (!cancelled) setDepartments(names) })
			.catch(() => { if (!cancelled) setDepartments([]) })
			.finally(() => { if (!cancelled) setLoading(false) })

		return () => { cancelled = true }
	}, [isReady, institutionId])

	const fallback = departmentsFor(institutionCode)
	return {
		departments: departments.length > 0 ? departments : [...fallback],
		loading,
	}
}
