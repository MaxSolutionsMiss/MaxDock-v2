// The service worker for MaxDock Receiving.
//
// It exists for one reason: so tapping the icon opens the app instantly, on a dock's wifi,
// rather than showing a white screen while the stylesheet and the modules come down. It caches
// the shell — the page, the stylesheet, the modules — and nothing else.
//
// It deliberately does not cache or queue anything from Supabase. A receiver with no signal is
// meant to find that out, not to tap "At the dock", see it succeed, and have it arrive twenty
// minutes later — by which time the board has been wrong for twenty minutes and nobody knew.
// The station computer is the fallback, which is the owner's own answer to this.
//
// Living in /app/ rather than at the root is what keeps its scope to the app's own pages. A
// worker at the root would control every office screen, which is a much larger promise than
// this one is making.

// Bumped whenever the worker itself has to change. The browser only looks for a new worker
// when this file's bytes differ, and a new worker taking over is what tells an installed app
// to pick up a deploy — so a change that only touches the page needs this moved as well.
const SHELL = 'maxdock-receiving-shell-v2';
const FILES = [
  './receiving.html',
  '../assets/maxdock.css',
  '../js/pages/receiving.js',
  '../js/router.js',
  '../js/db.js',
  '../js/session.js',
  '../js/format.js',
  '../js/ui/qr-scan.js',
  '../js/ui/toast.js',
];

self.addEventListener('install', event => {
  // addAll fails the whole install if one file 404s, which is the behaviour worth having:
  // a half-cached shell is a shell that breaks in a way nobody can reproduce.
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Anything that is not this origin's shell goes straight to the network with no fallback:
  // Supabase, the Supabase client on the CDN, and the fonts. Nothing about a load is ever
  // served from a cache, so the app cannot show a status that has since changed.
  if (url.origin !== self.location.origin) return;
  if (!FILES.some(file => url.pathname.endsWith(file.replace('./', '/').replace('../', '/')))) return;
  // Network first, so a deployed fix reaches a phone on its next open rather than on the
  // next cache version. The cache is the fallback, which is what makes the app open offline.
  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(SHELL).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
