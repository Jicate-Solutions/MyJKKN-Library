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

/**
 * The overdue list.
 *
 * Unlike its neighbours, this route does not reply with a bare array — it sends
 * `{ data, total, as_of }`, because the page also wants to know the date the
 * days were counted from. Handing that object straight back was the bug: the
 * Overdue page stored it as its list of transactions, and the first
 * `transactions.filter(...)` threw, which took the whole application down to
 * Next.js's "This page couldn't load".
 *
 * It looked intermittent for the worst possible reason — it failed only when
 * the request SUCCEEDED. A failed request was caught by the page and rendered
 * as an empty list, which looks perfectly healthy.
 *
 * So the envelope is unwrapped here, and an unexpected shape becomes an empty
 * list rather than something a page will later try to call `.filter` on.
 */
export async function fetchOverdue(institutionId: string): Promise<LibCirculationTransaction[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/circulation/overdue?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch overdue items')
	}

	const body = await res.json()
	if (Array.isArray(body)) return body
	return Array.isArray(body?.data) ? body.data : []
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
