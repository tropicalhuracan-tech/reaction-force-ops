const CACHE = "rfs-ops-v204";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "styles.css?v=204",
  "app.js",
  "app.js?v=204",
  "hr.js",
  "hr.js?v=144",
  "depuracion.js",
  "depuracion.js?v=144",
  "suplidores.js",
  "suplidores.js?v=175",
  "contabilidad.js",
  "contabilidad.js?v=204",
  "vargas.js",
  "vargas.js?v=204",
  "vargas-seed-data.js",
  "vargas-seed-data.js?v=176",
  "quotes.js",
  "quotes.js?v=144",
  "cloud.js",
  "cloud.js?v=204",
  "cloud-config.js",
  "cloud-config.js?v=144",
  "monorriel-data.js",
  "monorriel-data.js?v=144",
  "reaction-payroll-data.js",
  "reaction-payroll-data.js?v=144",
  "loans-seed-data.js",
  "loans-seed-data.js?v=144",
  "manifest.json",
  "logo.jpg",
  "logo.jpg?v=144",
  "quote-assets/clientes-rfs-1.jpg",
  "quote-assets/clientes-rfs-2.jpg",
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop() || "";

  // version.json siempre de red (candado de actualización)
  if (path === "version.json" || path.startsWith("version.json")) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(() => caches.match(req))
    );
    return;
  }

  const isShell =
    path === "" ||
    path === "index.html" ||
    path.startsWith("styles.css") ||
    path.startsWith("app.js") ||
    path.startsWith("hr.js") ||
    path.startsWith("depuracion.js") ||
    path.startsWith("suplidores.js") ||
    path.startsWith("contabilidad.js") ||
    path.startsWith("vargas") ||
    path.startsWith("quotes.js") ||
    path.includes("quote-assets") ||
    path.startsWith("cloud") ||
    path.startsWith("monorriel") ||
    path.startsWith("reaction") ||
    path.startsWith("sw.js");
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
