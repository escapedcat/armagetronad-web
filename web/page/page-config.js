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

  var HEADER = '# appended at runtime by web/shell.html: ';
  var given = function (v) { return v !== null && v !== undefined; };

  // THE RULES, in the order their lines are appended. Each rule turns
  // (touch, params) into a decision with choose(), and the rest is read off
  // that decision: null means "write nothing" (then `stock` is the log line,
  // or nothing if the rule has none); anything else is written as `lines`
  // under `header`, and logged with `written` -- or `failed` if the write did
  // not happen. `note` is an extra line logged before the rule's own.
  var RULES = [
    {
      tag: 'camera',
      choose: function (touch, p) {
        var factor = given(p.cam) ? p.cam : (touch ? CAMERA_TOUCH_FACTOR : 1);
        return factor === 1 ? null : { factor: factor, fromParam: given(p.cam) };
      },
      stock: function (touch, p) { return '[CAMERA] stock camera (factor 1' + (given(p.cam) ? ', from ?cam' : '') + ')'; },
      header: function (d, touch) { return 'camera x' + d.factor + (touch ? ' (touch device)' : ''); },
      lines: function (d) {
        var out = [];
        for (var k in CAMERA_BASE) out.push(k + ' ' + (Math.round(CAMERA_BASE[k] * d.factor * 1e4) / 1e4));
        return out;
      },
      written: function (d) { return '[CAMERA] camera distance x' + d.factor + ' written to ' + AUTOEXEC + ' before main()'; },
      failed: function (d, e) { return '[CAMERA] tuning skipped (factor ' + d.factor + '): ' + e; },
    },
    {
      // 0 and 1 are the only meaningful values: ?sparks=2 never gets here (out
      // of range, the page's readNumberParam logged it), and ?sparks=0.5 is in
      // range but not a bool, so it is ignored out loud here.
      tag: 'sparks',
      note: function (touch, p) {
        return given(p.sparks) && p.sparks !== 0 && p.sparks !== 1
          ? '[SPARKS] ?sparks=' + p.sparks + ' ignored (want 0 or 1)' : null;
      },
      choose: function (touch, p) {
        if (p.sparks === 0 || p.sparks === 1) return { value: p.sparks, why: ' (from ?sparks=' + p.sparks + ')' };
        return touch ? { value: 'cheap', why: ' (touch device)' } : null;
      },
      stock: function () { return '[SPARKS] stock sparks, nothing written'; },
      header: function (d) {
        var what = d.value === 0 ? 'off' : d.value === 1 ? 'on' : 'on, priced for a phone';
        return 'crash sparks ' + what + d.why;
      },
      lines: function (d) {
        return d.value === 0 ? ['SPARKS 0'] : d.value === 1 ? ['SPARKS 1'] : SPARKS_CHEAP_LINES.slice();
      },
      written: function (d, lines) { return '[SPARKS] ' + lines.join(' / ') + ' written to ' + AUTOEXEC + ' before main()' + d.why; },
      failed: function (d, e) { return '[SPARKS] tuning skipped (value ' + d.value + '): ' + e; },
    },
    {
      tag: 'hints',
      choose: function (touch) { return touch ? {} : null; },
      header: function () { return 'no camera or glance hints on a touch device'; },
      lines: function () { return TOUCH_HINTS_OFF.slice(); },
      written: function () { return '[HINTS] camera and glance hints off (touch device)'; },
      failed: function (d, e) { return '[HINTS] skipped: ' + e; },
    },
    {
      tag: 'wallcut',
      choose: function (touch, p) {
        var on = given(p.wallcut) ? p.wallcut === 1 : !!touch;
        return on ? { why: given(p.wallcut) ? '?wallcut=1' : 'touch device' } : null;
      },
      stock: function (touch) { return touch ? '[WALLS] wall cut off (?wallcut=0)' : null; },
      header: function (d) { return 'wall cut (' + d.why + ')'; },
      lines: function () { return ['WALL_CUT 1']; },
      written: function () { return '[WALLS] WALL_CUT 1 written to ' + AUTOEXEC + ' before main()'; },
      failed: function (d, e) { return '[WALLS] wall cut skipped: ' + e; },
    },
  ];

  // touch: is the primary input a finger. params: { cam, sparks, wallcut },
  // each a number or null (the page's readNumberParam has range-checked them
  // and logged any it ignored).
  //
  // Returns { text, sections }: text is what is appended to autoexec.cfg, and
  // each section is { tag, written, ok, failed(e), before } -- `ok` is the log
  // line once the write has worked (or the only line, if nothing is written),
  // `failed` the line if the write did not happen.
  var plan = function (touch, params) {
    var p = params || {};
    var text = '', sections = [];
    RULES.forEach(function (r) {
      var note = r.note ? r.note(touch, p) : null;
      var d = r.choose(touch, p);
      if (d === null) {
        var stock = r.stock ? r.stock(touch, p) : null;
        if (stock || note) sections.push({ tag: r.tag, written: false, ok: stock, before: note });
        return;
      }
      var lines = r.lines(d);
      text += [''].concat([HEADER + r.header(d, touch)], lines, ['']).join('\n');
      sections.push({ tag: r.tag, written: true, ok: r.written(d, lines), before: note,
                      failed: function (e) { return r.failed(d, e); } });
    });
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
      var line = err && s.written ? s.failed(err) : s.ok;
      if (line) log(line);
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
