/**
 * Service Worker — [Phase11実装計画書]11-2(2)。手書き・依存なし。
 * 同一オリジンGETのみstale-while-revalidateでキャッシュする(アプリシェルの
 * オフライン表示用)。Google Drive等の他オリジンへのfetchはキャッシュ対象外
 * (ネットワークのみ、SWを素通り)。
 */
const CACHE_NAME = 'dp-pwa-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジン(Drive API等)はSWを素通りさせる

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      if (cached) {
        // stale-while-revalidate: キャッシュを即返し、裏で更新を試みる。
        event.waitUntil(networkFetch);
        return cached;
      }
      const networkRes = await networkFetch;
      return networkRes ?? new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
