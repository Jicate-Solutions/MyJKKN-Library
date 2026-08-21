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

/**
 * Cancelling a hold marks it cancelled; it does not delete it.
 *
 * A queue that forgets the reservations it turned away cannot answer "why did
 * this book never reach me?", so the line stays and its status changes — which
 * also frees the copy that was being held, as the route does on the way through.
 *
 * This used to send DELETE, and no DELETE handler exists on that route: the
 * Cancel Hold button answered 405 every time it was pressed.
 */
export async function cancelHold(id: string, reason = 'Cancelled at the desk'): Promise<LibHold> {
	const res = await fetch(`/api/lib/circulation/holds/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hold_status: 'cancelled', cancellation_reason: reason }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to cancel hold')
	}
	return res.json()
}
