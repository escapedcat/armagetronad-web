// web/page/offline.js -- THE INSTALLED APP'S OFFLINE COPY, the page's half.
//
// Registers sw.js (web/sw.js, stamped by web/tools/stamp-sw.mjs), which saves
// the game's four files on every visit and serves them to the installed app
// (opened as armagetronad.html?app=1) when there is no network. A plain tab is
// still served by the network; see web/sw.js for who gets what.
//
// AFTER THE LOAD EVENT: the worker's first install downloads the same 5 MB the
// page is loading; waiting for `load` keeps it from competing with the game's
// own download and turns it into four cheap revalidations.
//
// NOTHING HERE MAY THROW OR REJECT UNHANDLED: window.onunhandledrejection
// paints the red "Failed to load" banner. Offline, the browser's update check
// for sw.js fails on every launch -- that is the expected case, logged, not
// shown.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAOffline = (function () {
  'use strict';

  var PREFIX = 'aa-offline-';   // web/tools/stamp-sw.mjs PREFIX (the test checks they match)

  // env: { nav (navigator), win (window), doc (document), caches (window.caches),
  // log }. Logs one [PWA] line per outcome; the offline gate waits on "ready".
  var start = function (env) {
    var sw = env.nav.serviceWorker;
    if (!sw) {
      env.log('[PWA] no service worker here (an insecure page or an old browser): no offline copy');
      return;
    }
    var watchInstall = function (reg) {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        if (w.state === 'redundant') {
          env.log('[PWA] the offline copy could not be saved (it will retry on the next visit)');
        }
      });
    };
    var go = function () {
      sw.register('sw.js', { updateViaCache: 'none' })
        .then(function (reg) { watchInstall(reg); return sw.ready; })
        .then(function () { return env.caches.keys(); })
        .then(function (keys) {
          var mine = keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
          env.log('[PWA] ready ' + (mine.length ? mine.join(' ') : '(no offline copy yet)'));
        })
        .catch(function (e) {
          env.log(sw.controller ? '[PWA] offline copy in use; the update check failed: ' + e
                                : '[PWA] registration failed: ' + e);
        });
    };
    if (env.doc.readyState === 'complete') go();
    else env.win.addEventListener('load', go, { once: true });
  };

  return { start: start, PREFIX: PREFIX };
})();
