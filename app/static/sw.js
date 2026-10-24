const CACHE = "amircars-offline-v33";
const PRECACHE = [
  "/offline.html",
  "/manifest.json",
  "/static/vendor/dexie.min.js",
  "/static/js/csrf.js",
  "/static/js/db.js",
  "/static/js/localBackup.js",
  "/static/js/diskStore.js",
  "/static/js/archiveVault.js",
  "/static/js/api.js",
  "/static/js/repository.js",
  "/static/js/syncStatus.js",
  "/static/js/syncEngine.js",
  "/static/js/pwa.js",
  "/static/js/dom.js",
  "/static/js/store.js",
  "/static/js/taxonomy.js",
  "/static/js/bcvView.js",
  "/static/js/nav.js",
  "/static/js/catalog.js",
  "/static/js/combo.js",
  "/static/js/searchBox.js",
  "/static/js/zoom.js",
  "/static/js/filters.js",
  "/static/js/dateField.js",
  "/static/js/productForm.js",
  "/static/js/productDetail.js",
  "/static/js/bulk.js",
  "/static/js/inventory.js",
  "/static/js/bitacora.js",
  "/static/js/movements.js",
  "/static/js/exportDocs.js",
  "/static/js/opsLines.js",
  "/static/js/proveedores.js",
  "/static/js/entradas.js",
  "/static/js/salidas.js",
  "/static/js/fallas.js",
  "/static/js/pedidos.js",
  "/static/js/views.js",
  "/static/js/router.js",
  "/static/js/app.js",
  "/static/css/app.css?v=17",
  "/static/css/catalog.css?v=27",
  "/static/img/amircars/logo.png",
  "/static/img/amircars/fondo.jpg?v=14",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE.map(async (path) => {
            const response = await fetch(new Request(path, { cache: "reload" }));
            if (!response.ok) {
              throw new Error(path);
            }
            await cache.put(path, response);
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return;
  }
  if (url.origin !== self.location.origin || url.pathname === "/sw.js") {
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ ok: false, error: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const finalPath = new URL(response.url).pathname;
          if (response.ok && finalPath !== "/login") {
            const forRequest = response.clone();
            const forRoot = response.clone();
            caches.open(CACHE).then((cache) => {
              cache.put(request, forRequest);
              cache.put("/", forRoot);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match("/")) || (await caches.match("/offline.html"));
          return cached;
        })
    );
    return;
  }
  const isScript = url.pathname.startsWith("/static/js/") || url.pathname.startsWith("/static/css/");
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(new Request(request, { cache: isScript ? "reload" : "default" }))
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return isScript ? fetched.catch(() => cached) : cached || fetched;
    })
  );
});
