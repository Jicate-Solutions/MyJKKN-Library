'use client'

import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react'
import { useAuth } from '@/lib/auth/auth-context'

export interface Institution {
	id?: string
	institution_code: string
	institution_name?: string
	short_name?: string
	myjkkn_institution_ids?: string[]
}

/**
 * The shape every /api/lib/* route reads. The key is `institution_id` — an
 * earlier `institutions_id` spelling (carried over from COE) matched no route,
 * so choosing a college changed the URL but never actually filtered anything.
 */
export interface InstitutionFilter {
	institution_id?: string
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

/** One shared empty list, so "no ids" is always the same value. */
const EMPTY_IDS: string[] = []

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

					// A single entry means the API pinned this user to one library, so it
					// is their working context. More than one means they may switch, and
					// the header shows "All Institutions" until they pick — so nothing is
					// auto-selected here. Pre-selecting their home campus would filter
					// every list to it while the badge still claimed "All Institutions".
					if (data && data.length === 1) {
						setCurrentInstitution(data[0])
					} else {
						setCurrentInstitution(null)
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
		// Keyed on the signed-in user: the API answers per caller, so the list has
		// to be re-read when someone else signs in.
	}, [user?.email])

	const currentInstitutionCode = selectedInstitution?.institution_code ?? currentInstitution?.institution_code ?? null
	const currentInstitutionId = selectedInstitution?.id ?? currentInstitution?.id ?? null
	// An empty list written out here would be a new array on every render, and
	// pages watch it — so it is held steady when there is nothing in it.
	const currentMyJKKNInstitutionIds = useMemo(
		() => (selectedInstitution ?? currentInstitution)?.myjkkn_institution_ids ?? EMPTY_IDS,
		[selectedInstitution, currentInstitution]
	)

	// Switching is decided server-side: /api/lib/institutions returns every
	// institution to a super admin and exactly one to everyone else, so a
	// librarian receives a single-entry list and gets no switcher. This is a
	// display rule only — every /api/lib/* route re-checks the caller's scope,
	// so picking another institution by any means still gets refused.
	const canSwitchInstitution = availableInstitutions.length > 1
	const shouldFilter = !!currentInstitutionId

	// Built once per actual change of institution rather than once per render.
	// Pages put this object in the dependency list of the effect that loads
	// their data, so a fresh one each time meant re-fetching the whole list on
	// every keystroke and every toggle anywhere on the page.
	const institutionFilter = useMemo<InstitutionFilter>(
		() => (currentInstitutionId ? { institution_id: currentInstitutionId } : {}),
		[currentInstitutionId]
	)

	const queryParams = useMemo(
		() =>
			Object.entries(institutionFilter)
				.map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
				.join('&'),
		[institutionFilter]
	)

	const clearInstitutionSelection = useCallback(() => setSelectedInstitution(null), [])

	// Likewise the value itself: a new object here re-renders every page that
	// reads the context, whether or not anything about the institution moved.
	const value = useMemo<InstitutionContextValue>(
		() => ({
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
			clearInstitutionSelection,
		}),
		[
			selectedInstitution,
			currentInstitution,
			currentInstitutionCode,
			currentInstitutionId,
			currentMyJKKNInstitutionIds,
			availableInstitutions,
			canSwitchInstitution,
			shouldFilter,
			institutionFilter,
			queryParams,
			isLoading,
			isInitialized,
			clearInstitutionSelection,
		]
	)

	return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>
}

export function useInstitution() {
	return useContext(InstitutionContext)
}
