import type {
	LibCatalogueRecord,
	LibCatalogueFilters,
	LibCatalogueSearchResult,
} from '@/types/lib'

export async function fetchCatalogueRecords(filters: LibCatalogueFilters = {}): Promise<LibCatalogueRecord[]> {
	const params = new URLSearchParams()
	if (filters.institution_id) params.set('institution_id', filters.institution_id)
	if (filters.search) params.set('search', filters.search)
	if (filters.material_type) params.set('material_type', filters.material_type)
	if (filters.subject) params.set('subject', filters.subject)
	if (filters.language) params.set('language', filters.language)
	if (filters.author) params.set('author', filters.author)
	if (filters.publisher) params.set('publisher', filters.publisher)

	const res = await fetch(`/api/lib/catalogue?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch catalogue records')
	}
	return res.json()
}

export async function fetchCatalogueById(id: string): Promise<LibCatalogueRecord> {
	const res = await fetch(`/api/lib/catalogue/${id}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch catalogue record')
	}
	return res.json()
}

export async function createCatalogueRecord(data: Partial<LibCatalogueRecord>): Promise<LibCatalogueRecord> {
	const res = await fetch('/api/lib/catalogue', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create catalogue record')
	}
	return res.json()
}

export async function updateCatalogueRecord(id: string, data: Partial<LibCatalogueRecord>): Promise<LibCatalogueRecord> {
	const res = await fetch(`/api/lib/catalogue/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update catalogue record')
	}
	return res.json()
}

export async function deleteCatalogueRecord(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/catalogue/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete catalogue record')
	}
	return res.json()
}

export async function searchCatalogue(query: string, filters: LibCatalogueFilters = {}): Promise<LibCatalogueSearchResult[]> {
	const params = new URLSearchParams()
	params.set('q', query)
	if (filters.institution_id) params.set('institution_id', filters.institution_id)
	if (filters.material_type) params.set('material_type', filters.material_type)
	if (filters.subject) params.set('subject', filters.subject)
	if (filters.language) params.set('language', filters.language)
	if (filters.author) params.set('author', filters.author)
	if (filters.publisher) params.set('publisher', filters.publisher)

	const res = await fetch(`/api/lib/catalogue/search?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to search catalogue')
	}
	return res.json()
}
