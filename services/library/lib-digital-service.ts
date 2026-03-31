import type {
	LibDigitalResource,
} from '@/types/lib'

export async function fetchDigitalResources(institutionId: string): Promise<LibDigitalResource[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/digital?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch digital resources')
	}
	return res.json()
}

export async function createDigitalResource(data: Partial<LibDigitalResource>): Promise<LibDigitalResource> {
	const res = await fetch('/api/lib/digital', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create digital resource')
	}
	return res.json()
}

export async function updateDigitalResource(id: string, data: Partial<LibDigitalResource>): Promise<LibDigitalResource> {
	const res = await fetch(`/api/lib/digital/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update digital resource')
	}
	return res.json()
}

export async function deleteDigitalResource(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/digital/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete digital resource')
	}
	return res.json()
}
