// web/sw.js -- THE INSTALLED APP'S OFFLINE COPY (a service worker).
//
// Built into web/dist-m1/sw.js by web/tools/stamp-sw.mjs, which replaces the
// placeholder below with this build's file hashes. Registered by
// web/page/offline.js. docs/development.md "Offline play" has the why.
//
// WHO IS SERVED FROM THE COPY: the installed app only. Its manifest start_url
// is armagetronad.html?app=1; a page opened with app=1 gets the four game
// files from this cache, the page itself by its URL and the .js/.wasm/.data
// by the URL of the page that asked. Everything else -- a plain browser tab,
// any other file -- goes to the network as if this worker did not exist, so
// a website visitor always gets the newest deploy.
//
// EVERY VISIT FILLS THE COPY, tab or app, so an installed app is ready
// offline from its first launch. A copy is one build or nothing: install
// hashes each download against the stamped hash and fails on a mismatch.
// A copy that goes missing later (a cache cleared on its own, the worker
// kept) is saved again in the background by the next request for a game
// file, once at a time.
//
// UPDATES: a new deploy changes this file; the browser installs the new
// worker in the background and lets it take over once no window of the game
// is open, and activate deletes the older copy. No skipWaiting: a running
// game never has its files swapped under it.
'use strict';

const AA_PRECACHE = {"prefix":"aa-offline-","version":"5406324cd6ab","files":{"armagetronad.html":"1eab1203ee52d358c4f5faa07191b9ae5e27d875e2a7e6b9654f1efaca0c5937","armagetronad.js":"4df707ab7b7831a11783a13ebe52b94a181e2050fbac628b2d5c854c11a5fcad","armagetronad.wasm":"8cafa91b8a228ca980cea8b0aae61a16ce3d84a4f3e829b418f7aa994a44e609","armagetronad.data":"3a6895a29c9863dac8dd13af7e85a42d6cf9456cdf1f789fa21fcfd09743e836"}};

const PREFIX = AA_PRECACHE.prefix;
const CACHE = PREFIX + AA_PRECACHE.version;
const owns = (file) => Object.prototype.hasOwnProperty.call(AA_PRECACHE.files, file);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const isApp = (url) => new URL(url).searchParams.get('app') === '1';

// A same-origin URL's path relative to this worker's scope, or null.
const fileOf = (url) => {
  const u = new URL(url);
  const scope = new URL(self.registration.scope);
  if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return null;
  return u.pathname.slice(scope.pathname.length);
};

async function saveCopy() {
  const cache = await caches.open(CACHE);
  try {
    for (const [file, want] of Object.entries(AA_PRECACHE.files)) {
      // no-cache: revalidate, so a file the page has just loaded costs a 304,
      // and an HTTP-cached file from an older deploy is never taken unchecked.
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(file + ': HTTP ' + res.status);
      const got = hex(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
      if (got !== want) throw new Error(file + ' is not this build');
      await cache.put(file, res);
    }
  } catch (e) {
    await caches.delete(CACHE);
    throw e;
  }
}

async function copyIsComplete() {
  const cache = await caches.open(CACHE);
  return (await cache.keys()).length === Object.keys(AA_PRECACHE.files).length;
}

let refilling = null;
function refillIfMissing(event) {
  if (!refilling) {
    refilling = copyIsComplete()
      .then((complete) => (complete ? null : saveCopy()))
      .catch(() => {})   // saveCopy has already deleted a partial copy; the next visit tries again
      .finally(() => { refilling = null; });
  }
  event.waitUntil(refilling);
}

async function dropOlderCopies() {
  for (const name of await caches.keys()) {
    if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
  }
}

async function fromCopyOrNetwork(event, file) {
  let app;
  if (event.request.mode === 'navigate') {
    app = isApp(event.request.url);
  } else {
    const client = event.clientId ? await clients.get(event.clientId) : undefined;
    app = !!client && isApp(client.url);
  }
  if (app) {
    const hit = await (await caches.open(CACHE)).match(file, { ignoreVary: true });
    if (hit) return hit;
  }
  return fetch(event.request);
}

self.addEventListener('install', (event) => event.waitUntil(saveCopy()));
self.addEventListener('activate', (event) => event.waitUntil(dropOlderCopies()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const file = fileOf(event.request.url);
  if (file === null || !owns(file)) return;
  event.respondWith(fromCopyOrNetwork(event, file));
  refillIfMissing(event);
});
