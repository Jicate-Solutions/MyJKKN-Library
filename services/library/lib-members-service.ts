/**
 * Reading the library's members.
 *
 * Only reading. Members are Active learners and staff in MyJKKN, so there is
 * nothing here to create, change or delete — MyJKKN owns all three. A name
 * correction happens there and shows here on the next load.
 */

import type { LibDirectoryMember, LibMemberFilters } from '@/types/lib'

export async function fetchMembers(filters: LibMemberFilters = {}): Promise<LibDirectoryMember[]> {
	const params = new URLSearchParams()
	if (filters.institution_id) params.set('institution_id', filters.institution_id)
	if (filters.search) params.set('search', filters.search)
	if (filters.member_category) params.set('member_category', filters.member_category)

	const res = await fetch(`/api/lib/members?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch members')
	}
	return res.json()
}
