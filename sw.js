const CACHE = "rfs-ops-v14";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "cloud-config.js",
  "manifest.json",
  "logo.jpg",
  "import-posts.json",
  "icons/icon-192.png",
  "icons/icon-256.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // No cachear import-posts ni APIs; sí assets estáticos
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
