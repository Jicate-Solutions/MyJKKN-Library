/**
 * Service worker for the installed JKKN Library app.
 *
 * Deliberately small. Members, books and loans live on the server, so the
 * app cannot work without the network; what this does is make the install
 * possible, keep the built assets and icons close, and show a plain page
 * instead of the browser's error when the connection is gone.
 *
 *   - Built assets (/_next/static) and icons: cache first. Their names carry
 *     a hash, so a cached copy is never stale.
 *   - Pages: network first, never cached. Every page is data, and a stale
 *     page at a desk is worse than no page. Offline, /offline.html.
 *   - APIs and everything else: straight to the network, untouched.
 *
 * Bump the version to drop every old cache on the next visit.
 */
const VERSION = 'jkkn-library-v1'
const OFFLINE_PAGE = '/offline.html'

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(VERSION)
			.then(cache => cache.addAll([OFFLINE_PAGE, '/icons/icon-192.png']))
			.then(() => self.skipWaiting())
	)
})

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
			.then(() => self.clients.claim())
	)
})

self.addEventListener('fetch', event => {
	const { request } = event
	if (request.method !== 'GET') return

	const url = new URL(request.url)
	if (url.origin !== self.location.origin) return

	// Built assets and icons: cache first
	if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
		event.respondWith(
			caches.match(request).then(hit => hit || fetch(request).then(response => {
				if (response.ok) {
					const copy = response.clone()
					caches.open(VERSION).then(cache => cache.put(request, copy))
				}
				return response
			}))
		)
		return
	}

	// Pages: the network, and the offline page when there is none
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() => caches.match(OFFLINE_PAGE))
		)
	}
})
