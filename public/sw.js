// Broker Assistant service worker: an offline shell only.
//
// It keeps a small offline page, the logo and the icons. Every page still
// comes from the network, and when the network is down the offline page is
// shown instead of the browser's error. It never caches pages, API answers or
// anything from Monday, and never touches /api or non-GET requests, so capture,
// lookups and saving stay online only.

const CACHE = "broker-shell-v1";
const OFFLINE_PAGE = "/offline.html";
const SHELL = [OFFLINE_PAGE, "/vantage-logo.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Network only; the offline page when the network can't be reached.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
  }
});
