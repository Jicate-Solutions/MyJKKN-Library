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

/**
 * Collecting and waiving both go to the one charge, as a change to its payment
 * status. They used to be posted to `/pay` and `/waive`, which were never
 * built — so both buttons on the Late Charges screen answered 404 and the
 * librarian was told "Action failed" with nothing else wrong.
 */
export async function collectPayment(id: string, data: LibPaymentPayload): Promise<LibLateCharge> {
	const res = await fetch(`/api/lib/charges/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...data, payment_status: 'paid' }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to collect payment')
	}
	return res.json()
}

export async function waiveCharge(id: string, data: LibWaivePayload): Promise<LibLateCharge> {
	const res = await fetch(`/api/lib/charges/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...data, payment_status: 'waived' }),
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
