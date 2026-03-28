const CACHE_NAME = "ai-ops-v1";
const OFFLINE_URL = "/";

// キャッシュ対象（アプリシェル）
const PRECACHE_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // APIリクエストはネットワーク優先
  if (
    request.url.includes("/update") ||
    request.url.includes("/task") ||
    request.url.includes("/agents") ||
    request.url.includes("/stats") ||
    request.url.includes("/monetization") ||
    request.url.includes("supabase")
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // ページ・アセットはキャッシュ優先 → ネットワークフォールバック
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          // 成功したらキャッシュを更新
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetched;
    })
  );
});
