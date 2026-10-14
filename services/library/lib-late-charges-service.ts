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

/**
 * Puts the principal's signed letter in the bucket and hands back its path.
 *
 * Done before the waiver is saved, not with it, so the settle and waive calls
 * keep taking plain JSON. The cost is that a librarian who picks a file and
 * then cancels leaves it behind unattached — a stray file nobody can reach,
 * which is cheaper than making both save paths carry multipart.
 */
export async function uploadWaiverLetter(
	institutionId: string,
	file: File
): Promise<{ path: string; name: string }> {
	const form = new FormData()
	form.set('institution_id', institutionId)
	form.set('file', file)

	const res = await fetch('/api/lib/circulation/waiver-document', { method: 'POST', body: form })
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Could not upload the letter')
	}
	return res.json()
}

/** A link to one waiver's letter that works for five minutes. */
export async function waiverLetterUrl(chargeId: string): Promise<{ url: string; name: string }> {
	const res = await fetch(`/api/lib/circulation/waiver-document?charge_id=${encodeURIComponent(chargeId)}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Could not open the letter')
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
