// Cache only public static resources in this instance's scope. Character HTML,
// API responses, sockets and uploads always use the network and are never cached.
const scope = new URL(self.registration.scope);
const family = `dicecloud-static:${scope.href}:`;
const cacheName = family + 'v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(family) && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const local = url.pathname.slice(scope.pathname.length);
  const immutable = /^[a-f0-9]{20,}\.(js|css)$/.test(local);
  const publicAsset = /^(fonts|images)\//.test(local) || /^(favicon|apple-touch-icon|android-chrome|mstile|crown-dice-logo)[^/]*\.(png|ico)$/.test(local);
  if (!immutable && !publicAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(event.request);
    if (cached && immutable) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic' && !/no-store/i.test(response.headers.get('cache-control') || '')) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) { if (cached) return cached; throw error; }
  })());
});
