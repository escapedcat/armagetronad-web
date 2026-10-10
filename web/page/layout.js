// web/page/layout.js -- THE PAGE'S LAYOUT DECISIONS AND THE CANVAS SIZE, AS
// PURE FUNCTIONS.
//
// Which device this is, which layout it gets, and how big the canvas's
// backing store is. The shell reads the browser (the URL, the viewport, the
// media queries, the GPU's limits) and applies the answers to the DOM; the
// arithmetic is here, where web/test/layout.test.mjs can call it. The long
// argument for each choice -- why the viewport and not the screen, why the
// size is taken once, why the area cap, why the axis clamp -- stays in the
// shell, next to the code that reads those inputs ("M5: the canvas is sized
// from the VIEWPORT").
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AALayout = (function () {
  'use strict';

  // Is the primary input a finger? ?touch=1 / ?touch=0 win (a harness under
  // device emulation, or a visitor on a device the media query gets wrong);
  // otherwise '(hover: none) and (pointer: coarse)', which a touchscreen
  // laptop answers false to. coarse: that query's answer, or an Error if
  // matchMedia threw. Returns { on, why } for the [TOUCH] line.
  var decideTouch = function (search, coarse) {
    var q = new URLSearchParams(search).get('touch');
    if (q === '1') return { on: true,  why: '?touch=1' };
    if (q === '0') return { on: false, why: '?touch=0' };
    if (typeof coarse !== 'boolean') return { on: false, why: 'matchMedia threw: ' + coarse };
    return { on: !!coarse, why: 'media query -> ' + !!coarse };
  };

  // ?layout=portrait or ?layout=landscape, else null.
  var layoutParam = function (search) {
    var v = new URLSearchParams(search).get('layout');
    return (v === 'portrait' || v === 'landscape') ? v : null;
  };

  // GAME BOY = a touch device in portrait when the game starts, or told to be
  // by ?layout=portrait; ?layout=landscape is the full layout however the
  // phone is held. A desktop never gets it.
  var decideGameboy = function (touch, layout, portrait) {
    return !!touch && (layout ? layout === 'portrait' : !!portrait);
  };

  // Which way up is the viewport: its own width and height first, and the
  // media query only if those are unusable (the query's change event was
  // measured arriving 69 s late on an idle emulated page).
  var isPortrait = function (w, h, mediaPortrait) {
    if (w > 0 && h > 0) return h > w;
    return !!mediaPortrait;
  };

  // The backing store, from the viewport.
  //   o.vw, o.vh   the viewport in CSS px     o.dpr     device pixels per CSS px
  //   o.layout     layoutParam() or null      o.gameboy the layout decision
  //   o.maxPixels  the area cap               o.axisLimit the GPU's per-axis limit, or null
  // Returns null when there is no usable viewport, else
  //   { w, h, vw, vh, squareCss, capped, axisClamped }.
  var canvasSize = function (o) {
    var vw = o.vw, vh = o.vh;
    // ?layout= sizes for the layout asked for, not the viewport held: the
    // axes swap when the request and the viewport disagree.
    if ((o.layout === 'landscape' && vh > vw) || (o.layout === 'portrait' && vw > vh)) {
      var t = vw; vw = vh; vh = t;
    }
    var w = Math.floor(vw * o.dpr);
    var h = Math.floor(vh * o.dpr);
    if (!(w > 0 && h > 0)) return null;
    // The Game Boy square: the CSS width, capped at 60 % of the CSS height so
    // the pad keeps at least 40 % on a tall-but-wide tablet.
    var squareCss = 0;
    if (o.gameboy) {
      squareCss = Math.min(vw, Math.floor(vh * 0.6));
      w = h = Math.floor(squareCss * o.dpr);
    }
    // The area cap, with the aspect ratio kept.
    var capped = false;
    if (w * h > o.maxPixels) {
      var k = Math.sqrt(o.maxPixels / (w * h));
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      capped = true;
    }
    // The GPU's per-axis limit, both axes by the same factor.
    var axisClamped = false;
    if (o.axisLimit && (w > o.axisLimit || h > o.axisLimit)) {
      var a = Math.min(o.axisLimit / w, o.axisLimit / h);
      w = Math.max(1, Math.floor(w * a));
      h = Math.max(1, Math.floor(h * a));
      axisClamped = true;
    }
    return { w: w, h: h, vw: vw, vh: vh, squareCss: squareCss,
             capped: capped, axisClamped: axisClamped };
  };

  return { decideTouch: decideTouch, layoutParam: layoutParam,
           decideGameboy: decideGameboy, isPortrait: isPortrait, canvasSize: canvasSize };
})();
