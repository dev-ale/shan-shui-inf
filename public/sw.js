// Makes the app work offline after the first visit. Pages are fetched fresh
// when there is a network and fall back to the cache; the build's hashed
// assets never change, so they are served from the cache straight away.
const CACHE = "shan-shui-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k != CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method != "GET" || new URL(req.url).origin != location.origin) {
    return;
  }
  const fresh = () =>
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    });
  if (new URL(req.url).pathname.includes("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fresh()));
  } else {
    event.respondWith(fresh().catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
