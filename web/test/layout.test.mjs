// web/page/layout.js: the layout decisions and the canvas size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';

const L = loadPageModule('web/page/layout.js', 'AALayout', { URLSearchParams });
const MAX = 3840 * 2160;

test('numberParam: absent, in range, out of range (ignored, never clamped)', () => {
  assert.deepEqual({ ...L.numberParam('', 'dpr', 0.05, 8) }, { value: null, ignored: null });
  assert.deepEqual({ ...L.numberParam('?dpr=1.5', 'dpr', 0.05, 8) }, { value: 1.5, ignored: null });
  assert.deepEqual({ ...L.numberParam('?dpr=9', 'dpr', 0.05, 8) },
    { value: null, ignored: '[DISPLAY] ?dpr=9 ignored (want 0.05..8)' });
  assert.equal(L.numberParam('?cam=abc', 'cam', 0.15, 4).value, null);
});

test('decideTouch: the parameter wins, then the media query', () => {
  assert.deepEqual({ ...L.decideTouch('?touch=1', false) }, { on: true, why: '?touch=1' });
  assert.deepEqual({ ...L.decideTouch('?touch=0', true) }, { on: false, why: '?touch=0' });
  assert.deepEqual({ ...L.decideTouch('', true) }, { on: true, why: 'media query -> true' });
  assert.deepEqual({ ...L.decideTouch('?touch=2', false) }, { on: false, why: 'media query -> false' });
  assert.equal(L.decideTouch('', new Error('x')).on, false);
});

test('the Game Boy: a phone in portrait, or ?layout=; never a desktop', () => {
  assert.equal(L.decideGameboy(true, null, true), true);
  assert.equal(L.decideGameboy(true, null, false), false);
  assert.equal(L.decideGameboy(true, 'portrait', false), true);
  assert.equal(L.decideGameboy(true, 'landscape', true), false);
  assert.equal(L.decideGameboy(false, 'portrait', true), false);
  assert.equal(L.layoutParam('?layout=portrait'), 'portrait');
  assert.equal(L.layoutParam('?layout=sideways'), null);
  assert.equal(L.isPortrait(400, 900, false), true);
  assert.equal(L.isPortrait(0, 0, true), true, 'the media query only when the viewport is unusable');
});

test('canvasSize: a desktop window is 1:1 with its physical pixels', () => {
  const s = L.canvasSize({ vw: 1280, vh: 720, dpr: 2, layout: null, gameboy: false, maxPixels: MAX, axisLimit: 16384 });
  assert.deepEqual({ ...s }, { w: 2560, h: 1440, vw: 1280, vh: 720, squareCss: 0, capped: false, axisClamped: false });
});

test('canvasSize: the Game Boy square is the CSS width, at most 60 % of the height', () => {
  const s = L.canvasSize({ vw: 412, vh: 915, dpr: 3, layout: null, gameboy: true, maxPixels: MAX, axisLimit: 4096 });
  assert.equal(s.squareCss, 412);
  assert.equal(s.w, 1236);
  assert.equal(s.h, 1236);
  const tablet = L.canvasSize({ vw: 800, vh: 1000, dpr: 1, layout: null, gameboy: true, maxPixels: MAX, axisLimit: null });
  assert.equal(tablet.squareCss, 600);
});

test('canvasSize: ?layout= sizes for the layout asked for, not the viewport held', () => {
  const s = L.canvasSize({ vw: 915, vh: 412, dpr: 1, layout: 'portrait', gameboy: true, maxPixels: MAX, axisLimit: null });
  assert.equal(s.vw, 412);
  assert.equal(s.vh, 915);
  const l = L.canvasSize({ vw: 412, vh: 915, dpr: 1, layout: 'landscape', gameboy: false, maxPixels: MAX, axisLimit: null });
  assert.deepEqual([l.w, l.h], [915, 412]);
});

test('canvasSize: the area cap and the axis clamp keep the aspect ratio', () => {
  const big = L.canvasSize({ vw: 3360, vh: 1890, dpr: 2, layout: null, gameboy: false, maxPixels: MAX, axisLimit: 32768 });
  assert.ok(big.capped);
  assert.ok(big.w * big.h <= MAX * 1.001);
  assert.ok(Math.abs(big.w / big.h - 3360 / 1890) < 0.002);
  const phone = L.canvasSize({ vw: 915, vh: 412, dpr: 3.5, layout: null, gameboy: false, maxPixels: MAX, axisLimit: 2048 });
  assert.ok(phone.axisClamped);
  assert.ok(phone.w <= 2048 && phone.h <= 2048);
  assert.ok(Math.abs(phone.w / phone.h - 915 / 412) < 0.01);
  assert.equal(L.canvasSize({ vw: 0, vh: 0, dpr: 1, layout: null, gameboy: false, maxPixels: MAX, axisLimit: null }), null);
});

test('shell.html no longer does the arithmetic or reaches across blocks through window', () => {
  const code = readRepoFile('web/shell.html').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.deepEqual(code.match(/Math\.sqrt\(MAX_CANVAS_PIXELS/g) || [], []);
  assert.deepEqual(code.match(/window\.AA_(KBD|LABEL_LAYOUT_BUTTON)\b/g) || [], []);
});
