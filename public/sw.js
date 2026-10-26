/*
 * Remus's service worker: what makes "Add to Home Screen" a real app, and nothing more.
 *
 * It deliberately caches no app code. Every screen is fetched fresh from the server, so an
 * installed Remus is never stuck on an old version (the version check in the app tells you when
 * a new one has gone out). The one thing kept is a small "No connection" page, shown instead of
 * the browser's own error when a page is opened with no signal.
 */
const OFFLINE = 'remus-offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE).then((c) => c.addAll(['/offline.html', '/brand/remus-icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')))
    return
  }
  if (new URL(req.url).pathname === '/brand/remus-icon-192.png') {
    event.respondWith(fetch(req).catch(() => caches.match(req)))
  }
})
