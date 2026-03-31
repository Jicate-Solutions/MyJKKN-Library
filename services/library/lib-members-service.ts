import type {
	LibMember,
	LibMemberFilters,
} from '@/types/lib'

export async function fetchMembers(filters: LibMemberFilters = {}): Promise<LibMember[]> {
	const params = new URLSearchParams()
	if (filters.institution_id) params.set('institution_id', filters.institution_id)
	if (filters.search) params.set('search', filters.search)
	if (filters.member_category) params.set('member_category', filters.member_category)
	if (filters.is_active !== undefined) params.set('is_active', String(filters.is_active))

	const res = await fetch(`/api/lib/members?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch members')
	}
	return res.json()
}

export async function fetchMemberById(id: string): Promise<LibMember> {
	const res = await fetch(`/api/lib/members/${id}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch member')
	}
	return res.json()
}

export async function createMember(data: Partial<LibMember>): Promise<LibMember> {
	const res = await fetch('/api/lib/members', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create member')
	}
	return res.json()
}

export async function updateMember(id: string, data: Partial<LibMember>): Promise<LibMember> {
	const res = await fetch(`/api/lib/members/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update member')
	}
	return res.json()
}

export async function deleteMember(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/lib/members/${id}`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to delete member')
	}
	return res.json()
}
