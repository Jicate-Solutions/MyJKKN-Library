import type {
	LibSupplier,
} from '@/types/lib'

export async function fetchSuppliers(institutionId: string): Promise<LibSupplier[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/procurement/suppliers?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch suppliers')
	}
	return res.json()
}

export async function fetchSupplierById(id: string): Promise<LibSupplier> {
	const res = await fetch(`/api/lib/procurement/suppliers/${id}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch supplier')
	}
	return res.json()
}

export async function createSupplier(data: Partial<LibSupplier>): Promise<LibSupplier> {
	const res = await fetch('/api/lib/procurement/suppliers', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create supplier')
	}
	return res.json()
}

export async function updateSupplier(id: string, data: Partial<LibSupplier>): Promise<LibSupplier> {
	const res = await fetch(`/api/lib/procurement/suppliers/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update supplier')
	}
	return res.json()
}

export async function deleteSupplier(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/procurement/suppliers/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete supplier')
	}
	return res.json()
}
