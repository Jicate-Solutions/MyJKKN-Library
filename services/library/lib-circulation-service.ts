import type {
	LibCirculationTransaction,
	LibIssuePayload,
	LibReturnPayload,
	LibRenewPayload,
	LibHold,
} from '@/types/lib'

export async function issueItem(payload: LibIssuePayload): Promise<LibCirculationTransaction> {
	const res = await fetch('/api/lib/circulation/issue', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to issue item')
	}
	return res.json()
}

export async function returnItem(payload: LibReturnPayload): Promise<LibCirculationTransaction> {
	const res = await fetch('/api/lib/circulation/return', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to return item')
	}
	return res.json()
}

export async function renewItem(payload: LibRenewPayload): Promise<LibCirculationTransaction> {
	const res = await fetch('/api/lib/circulation/renew', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to renew item')
	}
	return res.json()
}

export async function fetchOverdue(institutionId: string): Promise<LibCirculationTransaction[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/circulation/overdue?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch overdue items')
	}
	return res.json()
}

export async function fetchHolds(institutionId: string): Promise<LibHold[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/circulation/holds?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch holds')
	}
	return res.json()
}

export async function createHold(data: Partial<LibHold>): Promise<LibHold> {
	const res = await fetch('/api/lib/circulation/holds', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create hold')
	}
	return res.json()
}

export async function updateHold(id: string, data: Partial<LibHold>): Promise<LibHold> {
	const res = await fetch(`/api/lib/circulation/holds/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update hold')
	}
	return res.json()
}

export async function cancelHold(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/circulation/holds/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to cancel hold')
	}
	return res.json()
}
