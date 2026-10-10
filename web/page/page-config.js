// web/page/page-config.js -- THE CONFIG THE PAGE WRITES INTO THE GAME.
//
// Some settings depend on something only the page knows: whether the primary
// input is a finger, and the URL's parameters. The page states them as config
// lines appended to the preloaded /data/webdefaults/autoexec.cfg before main()
// runs. This module decides those lines (plan(), pure) and writes them in one
// go (apply()). web/test/page-config.test.mjs checks the exact text.
//
// WHY THAT FILE, AND WHY IT WINS. st_LoadConfig (src/tools/tConfiguration.cpp)
// reads the player's /persist/var/user.cfg FIRST and the userconfigdir
// autoexec.cfg near the END, so a line appended here beats a saved setting on
// every boot. A desktop with no parameters gets nothing appended: its file is
// byte for byte the one the build shipped, which web/tools/menu-gate.steps
// asserts (no SPARKS in it).
//
// WHEN. From onRuntimeInitialized and not from preRun: the file packager
// appends ITS preRun after the page's, so the /data tree does not exist yet
// in a page preRun. And before main(), which reads the file.
//
// TWO KINDS OF SETTING, AND THE DIFFERENCE MATTERS FOR OVERRIDES.
// tSettingItems (the CAMERA_* items) are never saved to user.cfg, so writing
// nothing really is the stock value. tConfItems (SPARKS) ARE saved
// (tConfItemBase::Save() returns true), so after one session with SPARKS 0
// appended the player's own user.cfg holds SPARKS 0 too: an override back to
// the stock value has to WRITE it, silence would leave the saved 0 standing.
// The price of the ordering, stated plainly: on a touch device the append
// re-applies on every boot, so a player who turns sparks back on in the menu
// is overridden at the next load. ?sparks=1 is the way back.
//
// No line in this file may start with '#': emcc's shell preprocessor reads
// one as a directive (web/test checks).
var AAPageConfig = (function () {
  'use strict';
  var AUTOEXEC = '/data/webdefaults/autoexec.cfg';
  var USER_CFG = '/persist/var/user.cfg';

  // ---- the camera: "the bike is tiny" on a phone ---------------------------
  // At a phone's landscape aspect the player's cycle is 23 x 63 backing-store
  // pixels. Halving the camera distance makes it 47 x 122 and keeps the arena
  // rim in frame, which narrowing the field of view does not
  // (docs/evidence/phone-feedback/camera/). The values are multiplied, not
  // replaced, so the stock camera's speed scaling is kept. They are copied
  // from config/settings_visual.cfg; web/test checks they still match it.
  // ?cam=F (0.15..4) overrides the factor on any device; ?cam=1 is stock.
  var CAMERA_BASE = {
    CAMERA_CUSTOM_BACK: 6,   CAMERA_CUSTOM_RISE: 4,
    CAMERA_CUSTOM_BACK_FROMSPEED: 0.5, CAMERA_CUSTOM_RISE_FROMSPEED: 0.4,
    CAMERA_GLANCE_BACK: 6,   CAMERA_GLANCE_RISE: 4,
    CAMERA_GLANCE_BACK_FROMSPEED: 0.5, CAMERA_GLANCE_RISE_FROMSPEED: 0.4,
  };
  var CAMERA_TOUCH_FACTOR = 0.5;

  // ---- crash sparks: cheap on a phone --------------------------------------
  // A grinding cycle threw up to two spark objects per frame, each alive four
  // seconds and each its own draw call: a quarter of the frame at the rim on a
  // phone (docs/evidence/m6-lag/task8-sparks/). SPARKS_LIFETIME and
  // SPARKS_INTERVAL (src/tron/gSparks.cpp, client-only) default to upstream's
  // behaviour; these are the touch values (docs/evidence/m8-cheap-sparks/).
  // ?sparks=0 is off and ?sparks=1 stock sparks, on any device, both written.
  var SPARKS_CHEAP_LINES = ['SPARKS 1', 'SPARKS_LIFETIME 1', 'SPARKS_INTERVAL 0.05'];

  // ---- no hints naming keys a phone doesn't have ---------------------------
  // "Press <v> or <c> to switch camera modes" and the glance hints. Each
  // *_TOOLTIP counts how many more times to show it; all zeros is never. The
  // turn and chat tooltips stay: the touch and portrait gates count them.
  var TOUCH_HINTS_OFF = ['SWITCH_VIEW_TOOLTIP 0 0 0 0 0', 'GLANCE_BACK_TOOLTIP 0 0 0 0 0',
                         'GLANCE_LEFT_TOOLTIP 0 0 0 0 0', 'GLANCE_RIGHT_TOOLTIP 0 0 0 0 0'];

  // ---- the wall cut --------------------------------------------------------
  // On an Android phone a wall passing level with the camera sometimes drew a
  // comb of lines to the screen edge. WALL_CUT 1 keeps every piece of a
  // player's wall at least 0.05 units in front of the camera
  // (src/emscripten/eWebWallCut.cpp, docs/evidence/phone-wall-comb/: 4 combs
  // in 112 s of play, 0 in 110 s with the cut). Touch only; ?wallcut=0 turns
  // it off on a phone, ?wallcut=1 on anywhere.

  // touch: is the primary input a finger. params: { cam, sparks, wallcut },
  // each a number or null (the page's readNumberParam has range-checked them
  // and logged any it ignored).
  //
  // Returns { text, sections }: text is what is appended to autoexec.cfg, and
  // each section is { tag, written, ok, failed(e) } -- `ok` is the log line
  // once the write has worked, `failed` the line if it did not; a section
  // that writes nothing has only `ok`.
  var plan = function (touch, params) {
    var p = params || {};
    var isNull = function (v) { return v === null || v === undefined; };
    var sections = [];
    var add = function (tag, header, body, ok, failed) {
      sections.push({ tag: tag, written: body !== null,
                      lines: body === null ? null : [''].concat([header], body, ['']),
                      ok: ok, failed: failed });
    };

    // camera
    var cam = isNull(p.cam) ? null : p.cam;
    var factor = cam !== null ? cam : (touch ? CAMERA_TOUCH_FACTOR : 1);
    if (factor === 1) {
      add('camera', null, null, '[CAMERA] stock camera (factor 1' + (cam !== null ? ', from ?cam' : '') + ')');
    } else {
      var camLines = [];
      for (var k in CAMERA_BASE) camLines.push(k + ' ' + (Math.round(CAMERA_BASE[k] * factor * 1e4) / 1e4));
      add('camera', '# appended at runtime by web/shell.html: camera x' + factor + (touch ? ' (touch device)' : ''),
          camLines,
          '[CAMERA] camera distance x' + factor + ' written to ' + AUTOEXEC + ' before main()',
          function (e) { return '[CAMERA] tuning skipped (factor ' + factor + '): ' + e; });
    }

    // sparks. 0 and 1 are the only meaningful values: ?sparks=2 never gets
    // here (out of range, readNumberParam logged it under [DISPLAY]), and
    // ?sparks=0.5 is in range but not a bool, so it is ignored out loud here.
    var q = isNull(p.sparks) ? null : p.sparks;
    var fromParam = q === 0 || q === 1;
    var ignored = (q !== null && !fromParam) ? '[SPARKS] ?sparks=' + q + ' ignored (want 0 or 1)' : null;
    var value = fromParam ? q : (touch ? 'cheap' : null);
    if (value === null) {
      add('sparks', null, null, '[SPARKS] stock sparks, nothing written');
    } else {
      var why = fromParam ? ' (from ?sparks=' + q + ')' : ' (touch device)';
      var body = value === 0 ? ['SPARKS 0'] : value === 1 ? ['SPARKS 1'] : SPARKS_CHEAP_LINES.slice();
      var what = value === 0 ? 'off' : value === 1 ? 'on' : 'on, priced for a phone';
      add('sparks', '# appended at runtime by web/shell.html: crash sparks ' + what + why, body,
          '[SPARKS] ' + body.join(' / ') + ' written to ' + AUTOEXEC + ' before main()' + why,
          function (e) { return '[SPARKS] tuning skipped (value ' + value + '): ' + e; });
    }
    if (ignored) sections[sections.length - 1].before = ignored;

    // hints
    if (touch) {
      add('hints', '# appended at runtime by web/shell.html: no camera or glance hints on a touch device',
          TOUCH_HINTS_OFF.slice(),
          '[HINTS] camera and glance hints off (touch device)',
          function (e) { return '[HINTS] skipped: ' + e; });
    }

    // wall cut
    var wc = isNull(p.wallcut) ? null : p.wallcut;
    var cut = wc !== null ? wc === 1 : !!touch;
    if (!cut) {
      if (touch) add('wallcut', null, null, '[WALLS] wall cut off (?wallcut=0)');
    } else {
      add('wallcut', '# appended at runtime by web/shell.html: wall cut (' + (wc !== null ? '?wallcut=1' : 'touch device') + ')',
          ['WALL_CUT 1'],
          '[WALLS] WALL_CUT 1 written to ' + AUTOEXEC + ' before main()',
          function (e) { return '[WALLS] wall cut skipped: ' + e; });
    }

    var text = '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].lines) text += sections[i].lines.join('\n');
    }
    return { text: text, sections: sections };
  };

  // Appends plan()'s text to autoexec.cfg in one write and logs each section.
  // A failure is a stock setting, not a broken game: it is logged under each
  // section's own tag and never thrown (it must not reach the failure banner).
  var apply = function (FS, touch, params, log) {
    var pl = plan(touch, params);
    var err = null;
    if (pl.text) {
      try {
        FS.writeFile(AUTOEXEC, FS.readFile(AUTOEXEC, { encoding: 'utf8' }) + pl.text);
      } catch (e) { err = e; }
    }
    for (var i = 0; i < pl.sections.length; i++) {
      var s = pl.sections[i];
      if (s.before) log(s.before);
      log(err && s.written ? s.failed(err) : s.ok);
    }
    return pl;
  };

  // ---- the default player name ----------------------------------------------
  // Emscripten says USER=web_user, and the game starts a new player with
  // getenv("USER"), so every browser player used to be "web_user". The page
  // sets USER to a fresh web_NNNN instead (preRun).
  var defaultName = function (random) {
    return 'web_' + String(Math.floor((random || Math.random)() * 10000)).padStart(4, '0');
  };

  // A profile saved before that still says PLAYER_1 web_user: it becomes this
  // load's web_NNNN, once (a name the player chose is left alone). Takes and
  // returns user.cfg as a latin-1 string; null means "leave the file alone".
  var OLD_DEFAULT = /^(\s*PLAYER_1\s+)web_user[ \t]*$/m;
  var renameOldDefault = function (cfg, name) {
    return OLD_DEFAULT.test(cfg) ? cfg.replace(OLD_DEFAULT, '$1' + name) : null;
  };
  var applyRename = function (FS, name, log) {
    try {
      if (!FS.analyzePath(USER_CFG).exists) return;
      var cfg = '';
      var bytes = FS.readFile(USER_CFG);
      for (var i = 0; i < bytes.length; i++) cfg += String.fromCharCode(bytes[i]);
      var next = renameOldDefault(cfg, name);
      if (next === null) return;
      FS.writeFile(USER_CFG, Uint8Array.from(next, function (ch) { return ch.charCodeAt(0); }));
      log('[NAME] the old default web_user is now ' + name);
    } catch (e) {
      log('[NAME] web_user rename skipped: ' + e);
    }
  };

  return { plan: plan, apply: apply, defaultName: defaultName,
           renameOldDefault: renameOldDefault, applyRename: applyRename,
           CAMERA_BASE: CAMERA_BASE, CAMERA_TOUCH_FACTOR: CAMERA_TOUCH_FACTOR,
           AUTOEXEC: AUTOEXEC, USER_CFG: USER_CFG };
})();
