// Service worker de FacturAI.
// - La interfaz (HTML, CSS, JS, íconos) se guarda para abrir rápido y sin red.
// - /api y el inicio de sesión de Google NUNCA se guardan: facturas, clientes
//   y timbrado siempre se consultan en línea.
const VERSION = "facturai-v8";
const SHELL = [
  "/", "/index.html", "/styles.css?v=7", "/app.js?v=8", "/finder.js?v=1", "/data/catalogo.json?v=8.1", "/auth.js?v=6", "/coin3d.js?v=4",
  "/vendor/three.module.min.js", "/vendor/RoomEnvironment.js",
  "/assets/z-logo-alpha.png", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => null)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // Google, gstatic, fuentes: directo
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/")) return; // siempre en línea

  // Páginas: primero la red (siempre la versión más nueva); sin red, la guardada.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put("/index.html", copy));
        return res;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Recursos estáticos: la copia guardada y se actualiza en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
