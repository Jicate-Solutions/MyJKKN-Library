import type {
	LibLateCharge,
	LibPaymentPayload,
	LibWaivePayload,
	LibChargeCalculation,
} from '@/types/lib'

export async function fetchCharges(institutionId: string): Promise<LibLateCharge[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/charges?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch charges')
	}
	return res.json()
}

export async function collectPayment(id: string, data: LibPaymentPayload): Promise<LibLateCharge> {
	const res = await fetch(`/api/lib/charges/${id}/pay`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to collect payment')
	}
	return res.json()
}

export async function waiveCharge(id: string, data: LibWaivePayload): Promise<LibLateCharge> {
	const res = await fetch(`/api/lib/charges/${id}/waive`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to waive charge')
	}
	return res.json()
}

export async function calculateCharge(transactionId: string): Promise<LibChargeCalculation> {
	const params = new URLSearchParams()
	params.set('transaction_id', transactionId)

	const res = await fetch(`/api/lib/charges/calculate?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to calculate charge')
	}
	return res.json()
}
