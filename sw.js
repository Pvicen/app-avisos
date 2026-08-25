// Service worker de la app de Avisos.
// Estrategia: red primero (siempre lo más fresco), caché como respaldo offline.
// Las peticiones de DATOS a Supabase no se tocan: van siempre directo a la red.
//
// Convenio: sube el número de CACHE ("avisos-v3", ...) si cambias cualquier
// URL de ASSETS o CDN_URL (p. ej. al subir la versión fijada de supabase-js).
const CACHE = "avisos-v4";
const CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.min.js";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const RESPUESTA_OFFLINE = () =>
  new Response("Sin conexión. Inténtalo de nuevo cuando tengas internet.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(async (c) => {
        // Los archivos propios saltan la caché HTTP: precachea lo recién desplegado
        await c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })));
        // El CDN es deseable pero no vital: si falla, el fetch handler lo cachea luego
        await c.add(CDN_URL).catch(() => {});
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(async () => {
        // Poda entradas huérfanas dentro de la caché actual
        const c = await caches.open(CACHE);
        const validas = new Set([CDN_URL, ...ASSETS.map((u) => new URL(u, self.location).href)]);
        for (const req of await c.keys()) {
          if (!validas.has(req.url)) await c.delete(req);
        }
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const esCascara =
    url.origin === self.location.origin ||
    url.href.startsWith("https://cdn.jsdelivr.net/");
  if (!esCascara) return; // datos de Supabase: siempre red directa

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.status === 200) {
          const copia = resp.clone();
          // Las navegaciones (p. ej. "./?texto=..." de un share) se guardan bajo una
          // sola clave para no acumular una entrada por cada query distinta
          const clave = e.request.mode === "navigate" ? "./index.html" : e.request;
          e.waitUntil(
            caches.open(CACHE).then((c) => c.put(clave, copia)).catch(() => {})
          );
        }
        return resp;
      })
      .catch(() =>
        caches.match(e.request).then((r) => {
          if (r) return r;
          if (e.request.mode === "navigate") {
            return caches.match("./index.html").then((idx) => idx || RESPUESTA_OFFLINE());
          }
          return Response.error();
        })
      )
      .catch(() => RESPUESTA_OFFLINE())
  );
});

// ---------- Notificaciones push ----------

self.addEventListener("push", (e) => {
  let datos = {};
  try {
    datos = e.data ? e.data.json() : {};
  } catch {
    datos = {};
  }
  e.waitUntil(
    self.registration.showNotification(datos.titulo || "📌 Avisos", {
      body: datos.cuerpo || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: datos.tag || "avisos",
      data: { url: "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      // Solo enfocar ventanas DE ESTA APP (el origen github.io se comparte entre proyectos)
      const base = self.registration.scope;
      const propia = ventanas.find((v) => v.url.startsWith(base));
      if (propia) return propia.focus();
      return self.clients.openWindow("./");
    })
  );
});
