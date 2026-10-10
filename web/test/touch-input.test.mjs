// web/page/touch-input.js: the held keys of every touch surface, one reading
// of the game per tick, and the surfaces' geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';

const T = loadPageModule('web/page/touch-input.js', 'AATouchInput');

function el() {
  const set = new Set();
  return { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c) },
           down: () => set.has('aa-down') };
}
function setup(state = {}) {
  const keys = [], logs = [];
  let reads = 0;
  const game = {
    key: (type, name) => keys.push((type === 'keydown' ? '+' : '-') + name),
    context: () => { reads++; return state.context || { raw: 0, menu: false, cycle: false, driving: false }; },
    textField: () => state.field || 'none',
    chatPossible: () => !!state.chatPossible,
  };
  return { t: T.create(game, (l) => logs.push(l)), keys, logs, reads: () => reads };
}

test('a key goes down once and up once, however many fingers hold it', () => {
  const { t, keys } = setup();
  const half = el();
  t.press('dp:1', 'ArrowLeft', half);
  t.press('dp:2', 'ArrowLeft', half);
  assert.equal(t.held('ArrowLeft'), 2);
  t.release('dp:1');
  assert.ok(half.down(), 'still held by the second thumb');
  t.release('dp:2');
  assert.ok(!half.down());
  assert.deepEqual(keys, ['+ArrowLeft', '-ArrowLeft']);
});

test('pressing again as the same owner lets go of its old key first (a slide)', () => {
  const { t, keys } = setup();
  const left = el(), right = el();
  t.press('dp:1', 'ArrowLeft', left);
  t.press('dp:1', 'ArrowRight', right);
  assert.equal(t.holds('dp:1'), 'ArrowRight');
  assert.ok(!left.down() && right.down());
  assert.deepEqual(keys, ['+ArrowLeft', '-ArrowLeft', '+ArrowRight']);
});

test('a press with no key shows and sends nothing (the pad Enter while driving)', () => {
  const { t, keys } = setup();
  const enter = el();
  t.press('btn:1', null, enter);
  assert.ok(enter.down());
  assert.equal(t.holds('btn:1'), null);
  t.release('btn:1');
  assert.ok(!enter.down());
  assert.deepEqual(keys, []);
});

test('releaseAll lets go of every surface and says so once', () => {
  const { t, keys, logs } = setup();
  t.press('btn:1', 'ArrowUp', el());
  t.press('dp:2', 'ArrowDown', el());
  t.press('dp:3', 'ArrowDown', el());
  assert.equal(t.releaseAll('input context changed'), 3);
  assert.deepEqual(keys, ['+ArrowUp', '+ArrowDown', '-ArrowUp', '-ArrowDown']);
  assert.deepEqual(logs, ['[TOUCH] released 3 held key(s): input context changed']);
  assert.equal(t.releaseAll('again'), 0);
  assert.equal(logs.length, 1);
  assert.equal(t.release('dp:2'), false);
});

test('one tick reads the game once and hands every subscriber the same answer', () => {
  const ctx = { raw: 2, menu: false, cycle: true, driving: true };
  const { t, reads } = setup({ context: ctx, field: 'password', chatPossible: true });
  const seen = [];
  t.subscribe((s) => seen.push(s));
  t.subscribe((s) => seen.push(s));
  t.tick();
  assert.equal(reads(), 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.deepEqual({ ...seen[0] }, { context: ctx, field: 'password', chatPossible: true });
});

test('geometry: driving pad, look zone, tap slop', () => {
  const pad = { left: 0, top: 500, width: 400, height: 300 };
  assert.equal(T.driveKeyAt(10, 600, pad, 750), 'ArrowLeft');
  assert.equal(T.driveKeyAt(250, 600, pad, 750), 'ArrowRight');
  assert.equal(T.driveKeyAt(250, 744, pad, 750), 'ArrowDown', '6 px of slop above the brake');
  assert.equal(T.driveKeyAt(250, 743, pad, 750), 'ArrowRight');

  const zone = { left: 0, top: 0, width: 400, height: 400 };
  assert.equal(T.lookBitAt(10, 10, zone), 1);
  assert.equal(T.lookBitAt(390, 10, zone), 2);
  assert.equal(T.lookBitAt(10, 300, zone), 4);

  const start = { x: 100, y: 100, t: 1000 };
  assert.equal(T.notATap(start, 110, 110, 1500), null);
  assert.equal(T.notATap(start, 130, 100, 1100), 'moved 30px, held 100ms');
  assert.equal(T.notATap(start, 100, 100, 1701), 'moved 0px, held 701ms');
});

test('shell.html keeps no key state of its own, and watches the game in one place', () => {
  const code = readRepoFile('web/shell.html').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.deepEqual(code.match(/classList\.(add|remove)\('aa-down'\)/g) || [], []);
  assert.deepEqual(code.match(/MutationObserver/g) || [], []);
  assert.equal((code.match(/setInterval\(/g) || []).length, 2, 'the touch tick and the ?diag readout');
});

test('Enter is chat in a round: the pad, the tap and the label follow one rule', () => {
  const ctx = (menu, cycle) => ({ raw: (menu ? 1 : 0) | (cycle ? 2 : 0), menu, cycle, driving: cycle && !menu });
  assert.equal(T.padSendsEnter(ctx(false, true)), false, 'driving: the pad sends no Enter');
  assert.equal(T.padSendsEnter(ctx(true, true)), true, 'the in-game menu over a live round');
  assert.equal(T.padSendsEnter(ctx(false, false)), true);

  const tap = (c, onField, gameboy) => T.tapMeans(c, { onField, gameboy });
  assert.equal(tap(ctx(false, true), true, true), 'steering', 'steering wins over a highlighted field');
  assert.equal(tap(ctx(true, false), true, true), 'keyboard');
  assert.equal(tap(ctx(false, false), false, true), 'pad-chat', 'portrait, between rounds: the pad opens chat');
  assert.equal(tap(ctx(false, false), false, false), 'enter', 'landscape has no pad');
  assert.equal(tap(ctx(true, false), false, true), 'enter', 'a menu wants Enter');

  const st = (chatPossible, c) => ({ chatPossible, context: c });
  assert.equal(T.enterOpensChat(st(true, ctx(false, false))), true);
  assert.equal(T.enterOpensChat(st(true, ctx(false, true))), false, 'driving');
  assert.equal(T.enterOpensChat(st(true, ctx(true, false))), false, 'a menu');
  assert.equal(T.enterOpensChat(st(false, ctx(false, false))), false, 'local game or connecting');
});
