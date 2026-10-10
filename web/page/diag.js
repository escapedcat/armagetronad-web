// web/page/diag.js -- ?diag=1: THE READOUT.
//
// WHY A PANEL AT ALL, when the game already draws "FPS: n" in the corner.
// Because the questions a phone report raised were about GEOMETRY -- what dpr
// is this device, what did the page ask the GPU for, what did the GPU give it
// -- and there is no way to read those off a phone screen. The maintainer is
// the instrument; this is the dial.
//
// THE ROW THAT MATTERS IS `gl`. canvas.width/height is what the page asked
// for and what the game builds glViewport and glFrustum from;
// gl.drawingBufferWidth/Height is what the driver allocated. A drawing buffer
// over the driver's limit is silently clamped, and a non-proportional clamp is
// a genuinely stretched picture -- after docs/evidence/phone-feedback the only
// mechanism left on this page that can produce one. That row says MATCH or
// CLAMPED, in red. `err` is the other half: the displayed box's aspect against
// the backing store's (0.00 % in every emulated configuration; a non-zero
// number on a real phone would be a new fact).
//
// COSTS NOTHING WHEN OFF: the page calls start() only for ?diag=1, and the
// glFlush/glFinish wrappers are installed there.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AADiag = (function () {
  'use strict';

  var R2 = function (x) { return Math.round(x * 100) / 100; };

  // The panel's text from one measurement (pure). m: { dpr, vw, vh, vis
  // ({w,h} or null), bsW, bsH, cssW, cssH, gl ({w,h} or null), fps, cam,
  // touch, ctx (game.context() or null on a desktop) }.
  // Returns { text, bad }.
  var rows = function (m) {
    var bsA = m.bsW / m.bsH;
    var cssA = m.cssH > 0 ? m.cssW / m.cssH : 0;
    var err = cssA ? (cssA / bsA - 1) * 100 : 0;
    var glOK = !!m.gl && m.gl.w === m.bsW && m.gl.h === m.bsH;
    var c = m.ctx;
    var lines = [
      'dpr ' + m.dpr + '   vp ' + m.vw + 'x' + m.vh +
        (m.vis ? '  vis ' + R2(m.vis.w) + 'x' + R2(m.vis.h) : ''),
      'bs  ' + m.bsW + 'x' + m.bsH + '  a ' + bsA.toFixed(4),
      'css ' + R2(m.cssW) + 'x' + R2(m.cssH) + '  a ' + cssA.toFixed(4) +
        '  err ' + err.toFixed(2) + '%',
      'gl  ' + (m.gl ? m.gl.w + 'x' + m.gl.h + (glOK ? '  MATCH' : '  CLAMPED') : '(no context yet)'),
      'fps ' + m.fps + ' swaps/s   cam x' + m.cam + '   touch ' + (m.touch ? 'on' : 'off'),
      // The two bits the game reports and the decision the overlay makes from
      // them: on a phone, the only way to see WHY a tap did what it did.
      'ctx ' + (c ? c.raw + ' menu ' + (c.menu ? 'y' : 'n') + ' cycle ' + (c.cycle ? 'y' : 'n') +
                    ' -> ' + (c.driving ? 'STEER' : 'TAP=ENTER')
                  : 'n/a (desktop)'),
    ];
    return { text: lines.join('\n'), bad: (!!m.gl && !glOK) || Math.abs(err) > 0.5 };
  };

  // Shows the panel and refreshes it every 500 ms. env: { el, canvas, win,
  // game, touch, cam, log }.
  var start = function (env) {
    var win = env.win, canvas = env.canvas, el = env.el;
    // The frame counter counts glFlush + glFinish, the same quantity
    // web/tools/fps-resolution-probe.steps and every M2/M5 frame measurement
    // counts -- buffer swaps; this game has no requestAnimationFrame callback.
    // Verified against the game's own on-screen counter under emulation.
    var swaps = 0, swapsPerSec = 0, lastT = win.performance.now();
    [win.WebGLRenderingContext, win.WebGL2RenderingContext].forEach(function (C) {
      if (!C) return;
      ['flush', 'finish'].forEach(function (name) {
        var orig = C.prototype[name];
        if (!orig) return;
        C.prototype[name] = function () { swaps++; return orig.apply(this, arguments); };
      });
    });
    el.hidden = false;
    var gl = null;
    var tick = function () {
      try {
        var now = win.performance.now();
        if (now - lastT >= 1000) {
          swapsPerSec = Math.round(swaps * 1000 / (now - lastT));
          swaps = 0; lastT = now;
        }
        // Fetched lazily and cached: before SDL_SetVideoMode there is no
        // context, and getContext() on a canvas that has one returns it.
        if (!gl) {
          try { gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl'); }
          catch (e) { gl = null; }
        }
        var r = canvas.getBoundingClientRect();
        var vv = win.visualViewport;
        var out = rows({
          dpr: win.devicePixelRatio || 1, vw: win.innerWidth, vh: win.innerHeight,
          vis: vv ? { w: vv.width, h: vv.height } : null,
          bsW: canvas.width, bsH: canvas.height, cssW: r.width, cssH: r.height,
          gl: gl ? { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight } : null,
          fps: swapsPerSec, cam: env.cam, touch: env.touch,
          ctx: env.touch ? env.game.context() : null,
        });
        el.textContent = out.text;
        el.className = out.bad ? 'bad' : '';
      } catch (e) {
        el.textContent = 'diag failed: ' + e;
      }
    };
    tick();
    win.setInterval(tick, 500);
    env.log('[DIAG] ?diag=1: readout on, glFlush/glFinish counted');
  };

  return { rows: rows, start: start };
})();
