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
// THE UPDATE CHIP. A new deploy downloads in the background and then waits
// until no window of the game is open (web/sw.js). On a phone an app in the
// background still counts as open, so an installed app could run an old build
// for days. Once a new build is downloaded, the installed app is offered it
// (env.onUpdateReady(apply)); the page shows a chip in menus only
// (offerUpdateNow), and the tap calls apply(): the waiting worker takes over
// and the page reloads into the new build. A browser tab is never offered
// one: it is served by the network and already runs the newest deploy.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAOffline = (function () {
  'use strict';

  var PREFIX = 'aa-offline-';   // web/tools/stamp-sw.mjs PREFIX (the test checks they match)

  // The chip shows while a menu is up and no cycle is alive. Not behind the
  // in-game menu (Escape mid-round): the reload would end that round.
  var offerUpdateNow = function (ctx) { return !!ctx.menu && !ctx.cycle; };

  // The chip itself. Returns the onUpdateReady handler: from then on the
  // chip's visibility follows the game twice a second (env.context() is
  // AAGame's context()), and a tap calls apply(), which reloads the page into
  // the new build. The reload is the same as the layout switch's:
  // page-lifecycle's pagehide save covers the settings.
  var chip = function (env) {
    return function (apply) {
      var el = env.el;
      var show = function () { el.hidden = !el.disabled && !offerUpdateNow(env.context()); };
      show();
      env.win.setInterval(show, 500);
      el.addEventListener('click', function () {
        if (!apply()) return;
        el.disabled = true;
        el.textContent = 'Updating\u2026';
      });
    };
  };

  // env: { nav (navigator), win (window), doc (document), caches (window.caches),
  // log, app (opened as the installed app), onUpdateReady(apply) }. Logs one
  // [PWA] line per outcome; the offline gate waits on "ready".
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
    var watchUpdate = function (reg) {
      if (!env.app || !env.onUpdateReady) return;
      var offered = false, asked = false;
      var apply = function () {
        var w = reg.waiting;
        if (!w || asked) return false;
        asked = true;
        sw.addEventListener('controllerchange', function () { env.win.location.reload(); });
        w.postMessage('aa-update');
        env.log('[PWA] switching to the new build');
        return true;
      };
      // No controller means this is the first copy being saved: there is no
      // older build running, so nothing to restart into.
      var offer = function () {
        if (offered || !sw.controller || !reg.waiting) return;
        offered = true;
        env.log('[PWA] a new build is ready');
        env.onUpdateReady(apply);
      };
      var follow = function (w) {
        if (w) w.addEventListener('statechange', function () { if (w.state === 'installed') offer(); });
      };
      follow(reg.installing);
      reg.addEventListener('updatefound', function () { follow(reg.installing); });
      offer();
    };
    var register = function () {
      sw.register('sw.js', { updateViaCache: 'none' })
        .then(function (reg) { watchInstall(reg); watchUpdate(reg); return sw.ready; })
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
    if (env.doc.readyState === 'complete') register();
    else env.win.addEventListener('load', register, { once: true });
  };

  return { start: start, chip: chip, offerUpdateNow: offerUpdateNow, PREFIX: PREFIX };
})();
