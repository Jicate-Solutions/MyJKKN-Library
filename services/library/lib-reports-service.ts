import type {
	LibNaacReport,
	LibAccessionRegister,
	LibAccessionRegisterParams,
	LibCirculationSummary,
	LibBudgetUtilisation,
	LibOverdueReport,
} from '@/types/lib'

export async function fetchNaacReport(institutionId: string, academicYear: string): Promise<LibNaacReport> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)
	params.set('academic_year', academicYear)

	const res = await fetch(`/api/lib/reports/naac?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch NAAC report')
	}
	return res.json()
}

export async function fetchAccessionRegister(institutionId: string, params: LibAccessionRegisterParams = {}): Promise<LibAccessionRegister> {
	const searchParams = new URLSearchParams()
	searchParams.set('institution_id', institutionId)
	if (params.date_from) searchParams.set('date_from', params.date_from)
	if (params.date_to) searchParams.set('date_to', params.date_to)
	if (params.material_type) searchParams.set('material_type', params.material_type)
	if (params.department) searchParams.set('department', params.department)

	const res = await fetch(`/api/lib/reports/accession-register?${searchParams}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch accession register')
	}
	return res.json()
}

export async function fetchCirculationSummary(institutionId: string, dateFrom: string, dateTo: string): Promise<LibCirculationSummary> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)
	params.set('date_from', dateFrom)
	params.set('date_to', dateTo)

	const res = await fetch(`/api/lib/reports/circulation-summary?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch circulation summary')
	}
	return res.json()
}

export async function fetchBudgetUtilisation(institutionId: string, fiscalYear: string): Promise<LibBudgetUtilisation> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)
	params.set('fiscal_year', fiscalYear)

	const res = await fetch(`/api/lib/reports/budget-utilisation?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch budget utilisation')
	}
	return res.json()
}

export async function fetchOverdueReport(institutionId: string): Promise<LibOverdueReport> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/reports/overdue?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch overdue report')
	}
	return res.json()
}
