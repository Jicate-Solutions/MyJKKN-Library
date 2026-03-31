import type {
	LibBudgetHead,
} from '@/types/lib'

export async function fetchBudgetHeads(institutionId: string, fiscalYear?: string): Promise<LibBudgetHead[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)
	if (fiscalYear) params.set('fiscal_year', fiscalYear)

	const res = await fetch(`/api/lib/procurement/budget?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch budget heads')
	}
	return res.json()
}

export async function createBudgetHead(data: Partial<LibBudgetHead>): Promise<LibBudgetHead> {
	const res = await fetch('/api/lib/procurement/budget', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create budget head')
	}
	return res.json()
}

export async function updateBudgetHead(id: string, data: Partial<LibBudgetHead>): Promise<LibBudgetHead> {
	const res = await fetch(`/api/lib/procurement/budget/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update budget head')
	}
	return res.json()
}

export async function deleteBudgetHead(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/procurement/budget/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete budget head')
	}
	return res.json()
}
