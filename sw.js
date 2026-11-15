/* Service worker — Cek Bahan PWA (15 Nov 2026).
   Tujuan: memenuhi syarat install PWA + cache ringan aset statis.
   ATURAN KEAMANAN (jangan dilonggarkan):
   - Hanya GET same-origin yang di-cache; POST/PUT/DELETE dilewatkan.
   - JANGAN PERNAH cache /api/*, Supabase, PubChem, atau cross-origin.
   - Navigasi (HTML): network-first supaya update situs selalu mengalir.
   - Versi cache dinaikkan tiap perubahan perilaku SW. */
var PWA_CACHE = "cek-bahan-v3";
var PWA_PRECACHE = [
  "/icons/icon.svg",
  "/icons/icon-maskable.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(PWA_CACHE).then(function (c) { return c.addAll(PWA_PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== PWA_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  if (e.request.mode === "navigate") {
    /* Navigasi: jaringan dulu (update selalu mengalir), cache hanya darurat offline. */
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(PWA_CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }
  /* Aset statis same-origin: cache dulu, jaringan sebagai cadangan. */
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(PWA_CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
