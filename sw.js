// キャッシュは行わず、常にネットワークから最新のファイルを取得する。
// (以前はapp shellをキャッシュしていたが、HTMLとCSS/JSのキャッシュが
//  別タイミングで更新されてバージョンがずれる問題があったため撤去)
const OLD_CACHES_PREFIX = 'uma-factor-ledger-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(OLD_CACHES_PREFIX)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
