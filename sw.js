const CACHE = "rfs-ops-v262";
/** Estos archivos NUNCA se sirven desde caché vieja (solo red). */
const NETWORK_ONLY = new Set([
  "",
  "index.html",
  "app.js",
  "version.json",
  "cloud.js",
  "reload.html",
]);

const ASSETS = [
  "./",
  "index.html",
  "reload.html",
  "styles.css",
  "styles.css?v=227",
  "app.js",
  "app.js?v=262",
  "hr.js",
  "hr.js?v=144",
  "depuracion.js",
  "depuracion.js?v=144",
  "suplidores.js",
  "suplidores.js?v=175",
  "contabilidad.js",
  "contabilidad.js?v=261",
  "report-excel-import.js",
  "report-excel-import.js?v=261",
  "report-snapshot-bridge.js",
  "report-snapshot-bridge.js?v=261",
  "monorriel-report.js",
  "monorriel-report.js?v=261",
  "report-cells.js",
  "report-cells.js?v=237",
  "vargas.js",
  "vargas.js?v=261",
  "vargas-seed-data.js",
  "vargas-seed-data.js?v=176",
  "quotes.js",
  "quotes.js?v=217",
  "cloud.js",
  "cloud.js?v=261",
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
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function pathName(url) {
  const path = url.pathname.split("/").pop() || "";
  return path.split("?")[0];
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const base = pathName(url);

  if (
    NETWORK_ONLY.has(base) ||
    base === "version.json" ||
    base.startsWith("app.js") ||
    base.startsWith("cloud.js")
  ) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(
        () =>
          new Response("Sin conexión. Abra /reload.html para limpiar caché.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
      )
    );
    return;
  }

  const isShell =
    base === "styles.css" ||
    base.startsWith("styles.css") ||
    base.startsWith("hr.js") ||
    base.startsWith("depuracion.js") ||
    base.startsWith("suplidores.js") ||
    base.startsWith("contabilidad.js") ||
    base.startsWith("vargas") ||
    base.startsWith("quotes.js") ||
    base.startsWith("monorriel") ||
    base.startsWith("reaction") ||
    base.startsWith("report-") ||
    base.startsWith("sw.js");
  if (isShell) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req).catch(() => cached)));
});