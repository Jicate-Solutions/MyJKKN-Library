'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAuth } from '@/lib/auth/auth-context-parent'

export interface Institution {
	id?: string
	institution_code: string
	institution_name?: string
	short_name?: string
	myjkkn_institution_ids?: string[]
}

export interface InstitutionFilter {
	institution_code?: string
	institutions_id?: string
}

interface InstitutionContextValue {
	currentInstitution: Institution | null
	currentInstitutionCode: string | null
	currentInstitutionId: string | null
	currentMyJKKNInstitutionIds: string[]
	selectedInstitution: Institution | null
	availableInstitutions: Institution[]
	canSwitchInstitution: boolean
	shouldFilter: boolean
	institutionFilter: InstitutionFilter
	queryParams: string
	isLoading: boolean
	isInitialized: boolean
	selectInstitution: (institution: Institution) => void
	clearInstitutionSelection: () => void
}

const InstitutionContext = createContext<InstitutionContextValue>({
	currentInstitution: null,
	currentInstitutionCode: null,
	currentInstitutionId: null,
	currentMyJKKNInstitutionIds: [],
	selectedInstitution: null,
	availableInstitutions: [],
	canSwitchInstitution: false,
	shouldFilter: false,
	institutionFilter: {},
	queryParams: '',
	isLoading: false,
	isInitialized: true,
	selectInstitution: () => {},
	clearInstitutionSelection: () => {},
})

export function InstitutionProvider({ children }: { children: ReactNode }) {
	const { user } = useAuth()
	const [isInitialized, setIsInitialized] = useState(false)
	const [availableInstitutions, setAvailableInstitutions] = useState<Institution[]>([])
	const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null)
	const [currentInstitution, setCurrentInstitution] = useState<Institution | null>(null)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		// Load institutions from API
		const loadInstitutions = async () => {
			try {
				const res = await fetch('/api/lib/institutions')
				if (res.ok) {
					const data = await res.json()
					setAvailableInstitutions(data || [])

					if (data && data.length === 1) {
						setCurrentInstitution(data[0])
					} else if (data && user?.institution_code) {
						// Auto-select the user's institution from their session
						const userInst = data.find(
							(i: Institution) => i.institution_code === user.institution_code
						)
						if (userInst) setCurrentInstitution(userInst)
					}
				}
			} catch {
				// silent fail — institutions are optional
			} finally {
				setIsLoading(false)
				setIsInitialized(true)
			}
		}
		loadInstitutions()
	}, [user?.institution_code])

	const currentInstitutionCode = selectedInstitution?.institution_code ?? currentInstitution?.institution_code ?? null
	const currentInstitutionId = selectedInstitution?.id ?? currentInstitution?.id ?? null
	const currentMyJKKNInstitutionIds = (selectedInstitution ?? currentInstitution)?.myjkkn_institution_ids ?? []

	// canSwitchInstitution would be true for super_admin — simplified here
	const canSwitchInstitution = availableInstitutions.length > 1
	const shouldFilter = !!(currentInstitutionCode)

	const institutionFilter: InstitutionFilter = {}
	if (currentInstitutionCode) institutionFilter.institution_code = currentInstitutionCode
	if (currentInstitutionId) institutionFilter.institutions_id = currentInstitutionId

	const queryParams = Object.entries(institutionFilter)
		.map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
		.join('&')

	return (
		<InstitutionContext.Provider
			value={{
				currentInstitution: selectedInstitution ?? currentInstitution,
				currentInstitutionCode,
				currentInstitutionId,
				currentMyJKKNInstitutionIds,
				selectedInstitution,
				availableInstitutions,
				canSwitchInstitution,
				shouldFilter,
				institutionFilter,
				queryParams,
				isLoading,
				isInitialized,
				selectInstitution: setSelectedInstitution,
				clearInstitutionSelection: () => setSelectedInstitution(null),
			}}
		>
			{children}
		</InstitutionContext.Provider>
	)
}

export function useInstitution() {
	return useContext(InstitutionContext)
}
