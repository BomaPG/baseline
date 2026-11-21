/* Baseline service worker.
   Job: after the first visit, open the app with no internet. Nothing about her data goes through here
   (her records live in localStorage on the phone).

   To ship a new version of the app: just deploy the new index.html. This file does not need to change.
   Change VERSION only if you change which files are in SHELL. */
const VERSION = 'baseline-shell-v3';
const FONTS = 'baseline-fonts-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png', './icon.svg'];
const APP_MARKER = 'baseline_settings';          // text only our app contains: guards against hotspot login pages and error pages

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch the newest index.html and keep it for next time, but only if it really is our app.
async function refreshApp() {
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res.ok) return;
    const copy = res.clone();
    const text = await res.text();
    if (!text.includes(APP_MARKER)) return;
    const cache = await caches.open(VERSION);
    const old = await cache.match('./index.html');
    const oldText = old ? await old.text() : '';
    await cache.put('./index.html', copy);
    if (oldText && oldText !== text) {
      const all = await self.clients.matchAll({ type: 'window' });
      all.forEach((c) => c.postMessage({ type: 'update-ready' }));
    }
  } catch (e) { /* offline: keep what we have */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Opening the app: show the saved copy straight away (works with no signal), then refresh it quietly.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const saved = await cache.match('./index.html');
      if (saved) { event.waitUntil(refreshApp()); return saved; }
      try { return await fetch(req); } catch (e) { return new Response('Baseline needs to be opened once with internet before it can work offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    })());
    return;
  }

  // Fonts: keep a copy so the app looks the same offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const saved = await cache.match(req);
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
      if (saved) { event.waitUntil(net); return saved; }
      return (await net) || Response.error();
    })());
    return;
  }

  // Our own icons and manifest: saved copy first.
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
