// web/page/page-lifecycle.js -- WHEN THE PAGE IS HIDDEN OR CLOSED.
//
// Two jobs, both driven by visibilitychange (and one by beforeunload):
//
// LEAVE A SERVER CLEANLY WHEN THE PAGE HAS BEEN HIDDEN. All browser players
// reach the servers through the relay, so a server sees them as ONE address
// and counts their kicks together; too many and it autobans that address --
// every web player at once (49+ minutes on 2026-09-30). The usual kick is the
// idle kick: a tab in the background or a phone that switched apps stops
// sending input. A regular logout is not a kick, so after leaveAfterMs hidden
// while connected, the page asks the game for exactly the in-game menu's
// Disconnect (src/emscripten/eWebPage.cpp). Coming back sooner cancels it. A
// phone that freezes the tab outright never gets that far -- the server then
// sees a timeout, which is not a kick either.
//
// THE SAVE BACKSTOP. IT IS A BACKSTOP AND NOTHING IN A GATE MAY DEPEND ON IT.
// The primary mechanism is src/emscripten/eWebPersist.cpp's
// uCallbackMenuLeave: the game saves its own config when the player leaves a
// menu, from inside its own loop. This is for the change the player makes and
// then never leaves the menu on -- they alt-tab, close the tab, or the OS
// discards the page. web/tools/persist-settings-gate.steps passes 18/18 with it
// disabled (docs/evidence/m4-persist-settings/make-settings-control-pages.mjs).
//  - beforeunload is only a backstop because of THE PAYLOAD CLIFF: a save from
//    it survives at 50 KB and 500 KB of changed data and loses the WHOLE batch
//    at 2 MB (libidbfs.js persists the mount in one transaction). user.cfg is
//    ~22 KB today.
//  - pagehide IS REJECTED, though it is the usual advice: measured twice, the
//    handler runs and the write reaches MEMFS, and the data is LOST, because
//    queuePersist's setTimeout(0) never gets serviced. Do not switch to it.
//  - visibilitychange (hidden) fires while the page still has a normal event
//    loop, and before a mobile tab is discarded with no unload event at all.
//    Reasoned, not measured: the weaker of these claims.
//  - THE GUARD IS game.started(): before main(), the exports are abort()
//    stubs, and main() is what tells tDirectories where --userdatadir is.
//    aa_web_save_config MUST NOT YIELD (eWebPersist.cpp).
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAPageLifecycle = (function () {
  'use strict';

  // env.game: AAGame's object. env.doc: the document (visibilityState).
  // env.log(line). env.leaveAfterMs. env.setTimeout / env.clearTimeout.
  var create = function (env) {
    var game = env.game, doc = env.doc, log = env.log;
    var timer = null;

    var saveBackstop = function (why) {
      if (!game.started()) return;
      try {
        game.saveConfig();
        log('[PERSISTBACKSTOP] ' + why);
      } catch (e) {
        log('[PERSISTBACKSTOP] ' + why + ' FAILED: ' + e);
      }
    };

    var leaveIfStillHidden = function () {
      timer = null;
      if (doc.visibilityState !== 'hidden' || !game.started()) return;
      try {
        if (game.connected()) {
          log('[LEAVE] hidden for ' + (env.leaveAfterMs / 1000) + ' s while connected: asking the game to disconnect');
          game.requestLeave();
        }
      } catch (e) { log('[LEAVE] could not ask the game to disconnect: ' + e); }
    };

    return {
      onVisibilityChange: function () {
        if (doc.visibilityState === 'hidden') {
          if (timer === null) timer = env.setTimeout(leaveIfStillHidden, env.leaveAfterMs);
          saveBackstop('visibilitychange-hidden');
        } else if (timer !== null) {
          env.clearTimeout(timer);
          timer = null;
        }
      },
      onBeforeUnload: function () { saveBackstop('beforeunload'); },
    };
  };

  return { create: create };
})();
