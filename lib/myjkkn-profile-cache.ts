'use client'

interface CacheEntry<T> {
	data: T
	timestamp: number
}

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry<unknown>>()

export function getCachedProfile<T>(key: string): T | null {
	const entry = cache.get(key)
	if (!entry) return null
	if (Date.now() - entry.timestamp > TTL_MS) {
		cache.delete(key)
		return null
	}
	return entry.data as T
}

export function setCachedProfile<T>(key: string, data: T): void {
	cache.set(key, { data, timestamp: Date.now() })
}

export function clearProfileCache(): void {
	cache.clear()
}
