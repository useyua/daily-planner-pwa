/**
 * Service Worker — [Phase11実装計画書]11-2(2)。手書き・依存なし。
 * 同一オリジンGETのみキャッシュする(アプリシェルのオフライン表示用)。
 * Google Drive等の他オリジンへのfetchはキャッシュ対象外(ネットワークのみ、SWを素通り)。
 *
 * # 2つの戦略を使い分ける(2026-08-20、Phase12 Step12-10 配信時に変更)
 *
 * - **HTMLページ(ナビゲーション)= network-first**
 * - **それ以外(ハッシュ名のJS/CSS・アイコン)= stale-while-revalidate**
 *
 * 以前は全部stale-while-revalidateだった。この場合`index.html`もキャッシュから即返るため、
 * **新しいバンドルを配信しても実機に届くのは「2回目の訪問」**になる(1回目は古いHTMLを表示し、
 * 裏で新しいHTMLを取ってキャッシュへ入れるだけ)。Phase12ではこれが実害になった:
 * PWAが送るTMT介入の文字列を直しても、配信済みの端末はキャッシュが入れ替わるまで旧文字列を
 * 送り続けるため、取り込み側(PC)にも旧文字列を受ける処理が要った(QA 2026-08-19 B-1)。
 *
 * HTMLだけをnetwork-firstにすれば、オンラインなら常に最新のHTML=最新のバンドル参照になる。
 * オフラインではキャッシュへ倒れるので、オフライン起動という本来の目的は保たれる。
 * JS/CSSはビルドごとにファイル名が変わる(ハッシュ名)ので、キャッシュを即返して困らない。
 */
const CACHE_NAME = 'dp-pwa-shell-v2';

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

  // ページそのものの取得。ここが古いままだと、新しいバンドルへ切り替わらない。
  const isNavigation = req.mode === 'navigate' || req.destination === 'document';

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      if (isNavigation) {
        // network-first: 取れたら必ずそれを表示し、キャッシュも更新する。
        // 取れなければ(オフライン)キャッシュ済みのシェルへ倒す。
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return cached ?? new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      }

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
