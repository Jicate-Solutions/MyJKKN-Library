/**
 * MyJKKN Learners API
 *
 * Fetches learner profiles from MyJKKN with pagination support.
 * When fetchAll=true, paginates through all pages and filters by
 * current_semester and program_code server-side (external API ignores these).
 */

import { NextResponse } from 'next/server'

const MYJKKN_API_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''
const PAGE_SIZE = 200
const FETCH_TIMEOUT_MS = 15000 // 15s timeout for external API calls
const MAX_CONCURRENCY = 5 // Max parallel page fetches
const MAX_SCAN_PAGES = 50 // Safety cap when walking pages without trustworthy metadata

// Helper: fetch a single page with AbortController timeout
async function fetchPage(
	url: string,
	headers: Record<string, string>
): Promise<{ profiles: any[]; meta: any } | null> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const response = await fetch(url, {
			method: 'GET',
			headers,
			cache: 'no-store',
			signal: controller.signal,
		})
		if (!response.ok) return null
		const data = await response.json()
		// MyJKKN returns pagination under `metadata` on some endpoints and
		// `pagination` on others — reading only one silently collapses the page
		// count to 1 and hides every learner past the first page.
		return { profiles: data.data || [], meta: data.metadata || data.pagination || {} }
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			console.error(`[MyJKKN Learners API] Timeout fetching ${url}`)
		}
		return null
	} finally {
		clearTimeout(timeout)
	}
}

// Helper: does this profile match the search term on ANY field?
// Every scalar value on the profile is searched rather than a fixed list, so a
// learner is findable by email, roll number, register number, phone, program —
// whatever MyJKKN happens to name those columns. The joined full name is added
// separately so "Priya Devi" matches across first_name + last_name.
function matchesSearch(profile: any, search: string): boolean {
	const q = search.trim().toLowerCase()
	if (!q) return true
	if (!profile || typeof profile !== 'object') return false

	const fullName = [profile.first_name, profile.middle_name, profile.last_name]
		.filter(Boolean)
		.join(' ')
	if (fullName.toLowerCase().includes(q)) return true

	// Walks nested objects/arrays too — MyJKKN nests contact details under a
	// sub-object on some payloads, and a top-level-only scan would miss them.
	const scan = (value: unknown, key: string, depth: number): boolean => {
		// Skip internal UUID keys — a short query would otherwise match random
		// UUID fragments and return unrelated learners.
		if (key === 'id' || key.endsWith('_id')) return false
		if (typeof value === 'string') return value.toLowerCase().includes(q)
		if (typeof value === 'number') return String(value).includes(q)
		if (depth >= 3 || value === null || typeof value !== 'object') return false
		if (Array.isArray(value)) return value.some(v => scan(v, key, depth + 1))
		return Object.entries(value as Record<string, unknown>)
			.some(([k, v]) => scan(v, k, depth + 1))
	}

	return Object.entries(profile).some(([key, value]) => scan(value, key, 0))
}

// Helper: run promises with concurrency limit
async function promiseAllWithConcurrency<T>(
	tasks: (() => Promise<T>)[],
	concurrency: number
): Promise<T[]> {
	const results: T[] = []
	let index = 0

	async function runNext(): Promise<void> {
		while (index < tasks.length) {
			const currentIndex = index++
			results[currentIndex] = await tasks[currentIndex]()
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext())
	await Promise.all(workers)
	return results
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const institutionId = searchParams.get('institution_id')
		const programCode = searchParams.get('program_code')
		const batchId = searchParams.get('batch_id')
		const currentSemester = searchParams.get('current_semester')
		const search = searchParams.get('search')
		const limit = searchParams.get('limit')
		const fetchAll = searchParams.get('fetchAll') === 'true'

		if (!MYJKKN_API_KEY) {
			return NextResponse.json({ error: 'MYJKKN_API_KEY not configured' }, { status: 500 })
		}

		if (!institutionId) {
			return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
		}

		const headers = {
			'Authorization': `Bearer ${MYJKKN_API_KEY}`,
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		}

		if (!fetchAll) {
			// Single page fetch with optional search support
			const pageLimit = limit ? parseInt(limit) : PAGE_SIZE
			const params = new URLSearchParams({ institution_id: institutionId, limit: String(pageLimit), page: '1' })
			if (programCode) params.set('program_code', programCode)
			if (batchId) params.set('batch_id', batchId)
			if (currentSemester) params.set('current_semester', currentSemester)
			if (search) params.set('search', search)

			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
			try {
				const response = await fetch(`${MYJKKN_API_URL}/api-management/learners/profiles?${params}`, {
					method: 'GET',
					headers,
					cache: 'no-store',
					signal: controller.signal,
				})
				if (!response.ok) {
					const err = await response.json().catch(() => ({}))
					return NextResponse.json({ error: err.message || `MyJKKN API Error: ${response.status}` }, { status: response.status })
				}
				const data = await response.json()
				let profiles = data.data || []

				// MyJKKN ignores the `search` param and returns the full page, so its
				// response can never be trusted as filtered. Whenever a search term is
				// given we filter locally, and if this page holds no match we scan every
				// page — a learner must be findable by any identifying field, wherever
				// they sit in the list.
				if (search) {
					profiles = profiles.filter((p: any) => matchesSearch(p, search))

					if (profiles.length === 0) {
						const buildUrl = (page: number) => {
							const p = new URLSearchParams({ institution_id: institutionId, limit: String(PAGE_SIZE), page: String(page) })
							if (programCode) p.set('program_code', programCode)
							if (batchId) p.set('batch_id', batchId)
							return `${MYJKKN_API_URL}/api-management/learners/profiles?${p}`
						}

						const firstPage = await fetchPage(buildUrl(1), headers)
						if (firstPage) {
							const matched = firstPage.profiles.filter(p => matchesSearch(p, search))

							// Prefer the page count MyJKKN reports, but never trust it blindly:
							// if it is missing or wrong we keep paging until a page comes back
							// short, so no learner is left unscanned.
							const reportedPages = Number(firstPage.meta.totalPages) || 0
							let scannedPages = 1

							if (reportedPages > 1) {
								const pageTasks = Array.from({ length: reportedPages - 1 }, (_, i) => {
									const pageNum = i + 2
									return () => fetchPage(buildUrl(pageNum), headers)
								})
								const pageResults = await promiseAllWithConcurrency(pageTasks, MAX_CONCURRENCY)
								for (const result of pageResults) {
									if (result) matched.push(...result.profiles.filter(p => matchesSearch(p, search)))
								}
								scannedPages = reportedPages
							}

							// Metadata missing or under-reported — walk on until a short page.
							let lastCount = firstPage.profiles.length
							while (lastCount === PAGE_SIZE && scannedPages < MAX_SCAN_PAGES) {
								const nextPage = await fetchPage(buildUrl(scannedPages + 1), headers)
								if (!nextPage || nextPage.profiles.length === 0) break
								matched.push(...nextPage.profiles.filter(p => matchesSearch(p, search)))
								lastCount = nextPage.profiles.length
								scannedPages++
							}

							console.log(`[MyJKKN Learners API] Full scan for "${search}": reported ${reportedPages || 'none'}, scanned ${scannedPages} page(s), matched ${matched.length}`)
							profiles = matched
						}
					}

					profiles = profiles.slice(0, pageLimit)
				}

				console.log(`[MyJKKN Learners API] Single page: ${profiles.length} profiles${search ? ` (search: "${search}")` : ''}`)
				return NextResponse.json({ data: profiles, total: profiles.length, metadata: data.metadata || {} })
			} finally {
				clearTimeout(timeout)
			}
		}

		// fetchAll=true — fetch first page to determine totalPages, then fetch remaining in parallel
		const semNum = currentSemester ? parseInt(currentSemester) : null

		// Helper to filter a page of profiles
		const filterProfiles = (profiles: any[]): any[] => {
			return profiles.filter((l) => {
				if (semNum !== null) {
					const lSem = l.current_semester ?? l.semester ?? null
					if (lSem === null || Number(lSem) !== semNum) return false
				}
				if (programCode) {
					if (!l.program_code || l.program_code !== programCode) return false
				}
				return true
			})
		}

		// Fetch first page to determine total pages
		const firstPageParams = new URLSearchParams({ institution_id: institutionId, limit: String(PAGE_SIZE), page: '1' })
		if (batchId) firstPageParams.set('batch_id', batchId)

		const firstPageResult = await fetchPage(
			`${MYJKKN_API_URL}/api-management/learners/profiles?${firstPageParams}`,
			headers
		)

		if (!firstPageResult || firstPageResult.profiles.length === 0) {
			console.log(`[MyJKKN Learners API] fetchAll: no profiles on first page`)
			return NextResponse.json({ data: [], total: 0 })
		}

		const totalRecords = firstPageResult.meta.total || firstPageResult.meta.totalCount || firstPageResult.profiles.length
		const totalPages = Math.ceil(totalRecords / PAGE_SIZE)
		const allProfiles = filterProfiles(firstPageResult.profiles)

		console.log(`[MyJKKN Learners API] Page 1/${totalPages}: ${firstPageResult.profiles.length} fetched, ${allProfiles.length} matched so far`)

		// Fetch remaining pages in parallel with concurrency limit
		if (totalPages > 1) {
			const pageTasks = Array.from({ length: totalPages - 1 }, (_, i) => {
				const pageNum = i + 2 // pages 2..totalPages
				return () => {
					const params = new URLSearchParams({ institution_id: institutionId, limit: String(PAGE_SIZE), page: String(pageNum) })
					if (batchId) params.set('batch_id', batchId)
					return fetchPage(
						`${MYJKKN_API_URL}/api-management/learners/profiles?${params}`,
						headers
					)
				}
			})

			const pageResults = await promiseAllWithConcurrency(pageTasks, MAX_CONCURRENCY)

			for (let i = 0; i < pageResults.length; i++) {
				const result = pageResults[i]
				if (!result || result.profiles.length === 0) continue
				const matched = filterProfiles(result.profiles)
				allProfiles.push(...matched)
				console.log(`[MyJKKN Learners API] Page ${i + 2}/${totalPages}: ${result.profiles.length} fetched, ${allProfiles.length} matched so far`)
			}
		}

		console.log(`[MyJKKN Learners API] fetchAll complete: ${allProfiles.length} profiles matched`)
		return NextResponse.json({ data: allProfiles, total: allProfiles.length })

	} catch (error) {
		console.error('[MyJKKN Learners API] Error:', error)
		return NextResponse.json({ error: 'Failed to fetch learner profiles from MyJKKN' }, { status: 500 })
	}
}
