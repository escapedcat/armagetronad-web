// web/page/game.js -- EVERYTHING THE PAGE KNOWS ABOUT THE GAME, IN ONE PLACE.
//
// The page talks to the running game in two ways: it calls the wasm's
// aa_web_* exports (src/emscripten/), and it dispatches keyboard events that
// Emscripten's SDL 1.2 shim turns into key presses. Every feature on the page
// -- the touch pad, the tap layer, the phone keyboard, looking around, the
// hidden-page leave, the save backstop, the ?diag readout -- goes through the
// object AAGame.create() returns, and nothing else on the page touches
// Module._aa_web_* or builds a KeyboardEvent itself. web/test/game.test.mjs
// checks both rules against web/shell.html.
//
// Inlined into the page at build time (web/Makefile, PAGE_SHELL), so it is a
// plain script that defines one global. Node loads the same file in a vm
// sandbox for the tests, with a fake Module and a recording key sink.
//
// NOTE FOR EDITORS: emcc runs the shell page through its preprocessor, which
// treats a line starting with '#' as a directive. No line in this file may
// start with '#' (the test checks).
var AAGame = (function () {
  'use strict';

  // ---- what the player is doing ----------------------------------------
  //
  // THE GAME ANSWERS, NOT THE PAGE. aa_web_input_context() returns two bits:
  // a uMenu is on screen, and a local player has a cycle that is Alive(). The
  // page cannot derive either -- a menu item can start the game, a round can
  // end by itself, and Escape mid-round opens the in-game menu, none of which
  // reaches the page. The values are AA_WEB_CTX_MENU and AA_WEB_CTX_DRIVING in
  // the C++; the test reads them from there so the two cannot drift.
  //
  // THE POLICY IS HERE AND THE FACTS ARE THERE, deliberately. "Driving" means
  // a live cycle AND no menu: the in-game menu is reached with Escape in the
  // middle of a round, so the cycle is still alive while a menu is asking for
  // Enter, and a rule that looked only at the cycle would put the turn zones
  // over the top of that menu.
  var CTX_MENU = 1, CTX_CYCLE = 2;
  var readContext = function (raw) {
    raw = raw | 0;
    var menu = (raw & CTX_MENU) !== 0, cycle = (raw & CTX_CYCLE) !== 0;
    return { raw: raw, menu: menu, cycle: cycle, driving: cycle && !menu };
  };

  // ---- keys ----------------------------------------------------------------
  //
  // Emscripten's SDL 1.2 shim listens on `document` and never reads
  // event.isTrusted; the one property that decides the game's action is
  // keyCode, which SDL.keyCodes maps (37 -> 1104 and 39 -> 1103, the keysyms
  // user.cfg binds CYCLE_TURN_LEFT / CYCLE_TURN_RIGHT to). `key` and `code` are
  // set to the name because receiveEvent consults event.key (only to decide
  // whether to preventDefault on Backspace and Tab). Measured, not reasoned:
  // web/tools/synthetic-key-gate.steps, docs/evidence/phase3-touch/.
  // 'Return' is Enter under the name the phone keyboard has always sent.
  var KEY_CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
                    Enter: 13, Return: 13, Escape: 27, Backspace: 8 };

  // env.module()      -> the Emscripten Module, or undefined
  // env.send(type, init) dispatches a KeyboardEvent of `type` at document
  var create = function (env) {
    // STARTED MEANS main() HAS BEEN CALLED, and it is the one readiness rule.
    // Before it, every export is either a makeInvalidEarlyAccess stub whose
    // body is abort() -- and `typeof` reports it as a function, so a feature
    // test passes and then takes the runtime down -- or a question about a
    // game that is not running yet. 0 / false / 'none' are the honest answers
    // then.
    var started = false;
    var exported = function (name) {
      var M = env.module();
      var f = M && M['_' + name];
      if (typeof f !== 'function') throw new Error(name + ' is not exported');
      return f;
    };
    // A question: before main() or on any throw, the fallback.
    //
    // CALLING INTO WASM FROM AN EVENT HANDLER IS SAFE FOR THESE EXPORTS FOR ONE
    // SPECIFIC REASON, not as a general licence: each reads a few statics or
    // walks a few pointers, so none can reach emscripten_sleep, so Asyncify
    // does not instrument them and there is no second stack unwind to start on
    // top of the one the game is nearly always parked in. A new export that
    // can sleep does not belong here.
    var ask = function (name, fallback) {
      if (!started) return fallback;
      try { return exported(name)(); } catch (e) { return fallback; }
    };
    // A request: before main() it does nothing; a throw reaches the caller,
    // which logs it.
    var tell = function (name, args) {
      if (!started) return false;
      exported(name).apply(null, args || []);
      return true;
    };
    var key = function (type, name) {
      var kc = KEY_CODES[name];
      env.send(type, { key: name, code: name, keyCode: kc, which: kc });
    };

    return {
      markStarted: function () { started = true; },
      started: function () { return started; },

      // { raw, menu, cycle, driving }. 0 (not driving, a tap is Enter) is the
      // safe side of a failure: a tap that confirms nothing during a round
      // costs a tap, while a tap that TURNS the player inside a menu changes
      // a setting they never chose.
      context: function () { return readContext(ask('aa_web_input_context', 0)); },
      // The highlighted menu item: 'none', 'text' or 'password'
      // (aa_web_text_selected: 0, 1, 2).
      textField: function () {
        var s = ask('aa_web_text_selected', 0) | 0;
        return s === 2 ? 'password' : s === 1 ? 'text' : 'none';
      },
      chatOpen: function () { return ask('aa_web_chat_open', 0) === 1; },
      // On a server, in a game: not while connecting, logging in or loading.
      chatPossible: function () { return ask('aa_web_chat_possible', 0) === 1; },
      connected: function () { return !!ask('aa_web_connected', 0); },

      // The in-game menu's Disconnect, done from the game's own frame loop.
      requestLeave: function () { return tell('aa_web_request_leave'); },
      // Which looks are held: 1 left, 2 right, 4 back; GLANCE_* from the
      // game's frame loop. Called from pointer handlers, so it never throws:
      // a throw there would reach window.onerror and the failure banner.
      look: function (bits) {
        try { return tell('aa_web_look', [bits | 0]); } catch (e) { return false; }
      },
      // MUST NOT YIELD on the C++ side -- see src/emscripten/eWebPersist.cpp.
      saveConfig: function () { return tell('aa_web_save_config'); },

      // A key press or release, by name (KEY_CODES).
      key: key,
      // Down and up at once. NO ARTIFICIAL HOLD between them: SDL only queues
      // events and SDL_PollEvent drains them in order, so the keydown is acted
      // on however soon the keyup follows.
      press: function (name) { key('keydown', name); key('keyup', name); },
      // One typed character for a text field. A keydown and a keypress
      // carrying charCode: SDL 1 copies that into keysym.unicode, and
      // uMenuItemString::Event inserts 32-255 (latin-1; anything above becomes
      // "?"). The keydown says "a" (keyCode 65): the text field reads only
      // unicode, and SDL ignores key codes it doesn't know. Control
      // characters are dropped; returns whether anything was sent.
      typeChar: function (ch) {
        var c = ch.codePointAt(0);
        if (c < 32 || (c >= 127 && c < 160)) return false;
        if (c > 255) c = 63;
        env.send('keydown', { key: ch, keyCode: 65, which: 65 });
        env.send('keypress', { key: ch, charCode: c, keyCode: c, which: c });
        env.send('keyup', { key: ch, keyCode: 65, which: 65 });
        return true;
      },
    };
  };

  return { create: create, readContext: readContext, KEY_CODES: KEY_CODES,
           CTX_MENU: CTX_MENU, CTX_CYCLE: CTX_CYCLE };
})();
