/*
 * Offline shell of the installable game (spec 08 §3.8). Navigations are
 * network-first so a new build always wins; hashed Vite assets, models,
 * textures and icons are cache-first with a background refresh.
 */
const CACHE = "red-line-shell-v1";
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL("index.html", SCOPE).href;
const ROOT = new URL("./", SCOPE).href;
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const CACHEABLE = ["assets/", "icons/", "models/", "textures/", "data/"].map(
  (path) => new URL(path, SCOPE).pathname,
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map((path) =>
          cache.add(new URL(path, SCOPE).href).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("red-line-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Fetches a navigation, stores its shell HTML and falls back to it offline. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(INDEX, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(INDEX)) ?? (await cache.match(ROOT));
    if (cached !== undefined) return cached;
    throw error;
  }
}

/** Serves a cached asset immediately and refreshes it in the background. */
function staleWhileRevalidate(event) {
  const update = (async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })();
  event.waitUntil(update.catch(() => undefined));
  return (async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    return cached ?? update;
  })();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (!CACHEABLE.some((path) => url.pathname.startsWith(path))) return;
  event.respondWith(staleWhileRevalidate(event));
});
