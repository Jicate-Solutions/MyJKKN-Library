import type {
	LibPeriodicalSubscription,
	LibPeriodicalIssue,
} from '@/types/lib'

export async function fetchSubscriptions(institutionId: string): Promise<LibPeriodicalSubscription[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/periodicals/subscriptions?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch subscriptions')
	}
	return res.json()
}

export async function createSubscription(data: Partial<LibPeriodicalSubscription>): Promise<LibPeriodicalSubscription> {
	const res = await fetch('/api/lib/periodicals/subscriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create subscription')
	}
	return res.json()
}

export async function updateSubscription(id: string, data: Partial<LibPeriodicalSubscription>): Promise<LibPeriodicalSubscription> {
	const res = await fetch(`/api/lib/periodicals/subscriptions/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update subscription')
	}
	return res.json()
}

export async function fetchIssues(subscriptionId: string): Promise<LibPeriodicalIssue[]> {
	const params = new URLSearchParams()
	params.set('subscription_id', subscriptionId)

	const res = await fetch(`/api/lib/periodicals/subscriptions/${subscriptionId}/issues?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch issues')
	}
	return res.json()
}

export async function receiveIssue(subscriptionId: string, data: Partial<LibPeriodicalIssue>): Promise<LibPeriodicalIssue> {
	const res = await fetch(`/api/lib/periodicals/subscriptions/${subscriptionId}/issues`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to receive issue')
	}
	return res.json()
}
