import type {
	LibItem,
} from '@/types/lib'

export async function fetchItems(catalogueRecordId: string): Promise<LibItem[]> {
	const params = new URLSearchParams()
	params.set('catalogue_record_id', catalogueRecordId)

	const res = await fetch(`/api/lib/items?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch items')
	}
	return res.json()
}

export async function fetchItemById(id: string): Promise<LibItem> {
	const res = await fetch(`/api/lib/items/${id}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch item')
	}
	return res.json()
}

export async function createItem(data: Partial<LibItem>): Promise<LibItem> {
	const res = await fetch('/api/lib/items', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create item')
	}
	return res.json()
}

export async function updateItem(id: string, data: Partial<LibItem>): Promise<LibItem> {
	const res = await fetch(`/api/lib/items/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update item')
	}
	return res.json()
}

export async function deleteItem(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/items/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete item')
	}
	return res.json()
}
