const CACHE = "rfs-ops-v45";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "styles.css?v=45",
  "app.js",
  "app.js?v=45",
  "hr.js",
  "hr.js?v=45",
  "cloud.js",
  "cloud.js?v=45",
  "cloud-config.js",
  "cloud-config.js?v=45",
  "monorriel-data.js",
  "monorriel-data.js?v=45",
  "manifest.json",
  "logo.jpg",
  "logo.jpg?v=45",
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
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop() || "";
  const isShell =
    path === "" ||
    path === "index.html" ||
    path.startsWith("styles.css") ||
    path.startsWith("app.js") ||
    path.startsWith("hr.js") ||
    path.startsWith("cloud") ||
    path.startsWith("monorriel") ||
    path.startsWith("sw.js");

  // HTML/CSS/JS: red primero para que el inicio se actualice
  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(() => cached))
  );
});
