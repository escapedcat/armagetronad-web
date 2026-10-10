// web/page/page-lifecycle.js, audio.js and diag.js, and the shell's start order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';

const Life = loadPageModule('web/page/page-lifecycle.js', 'AAPageLifecycle');
const Audio = loadPageModule('web/page/audio.js', 'AAAudio');
const Diag = loadPageModule('web/page/diag.js', 'AADiag');

function lifecycle({ started = true, connected = true, saveThrows = false } = {}) {
  const logs = [], calls = [], timers = new Map();
  let next = 1;
  const doc = { visibilityState: 'visible' };
  const game = {
    started: () => started,
    connected: () => connected,
    requestLeave: () => calls.push('leave'),
    saveConfig: () => { if (saveThrows) throw new Error('boom'); calls.push('save'); },
  };
  const life = Life.create({
    game, doc, log: (l) => logs.push(l), leaveAfterMs: 60000,
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const hide = () => { doc.visibilityState = 'hidden'; life.onVisibilityChange(); };
  const show = () => { doc.visibilityState = 'visible'; life.onVisibilityChange(); };
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { life, logs, calls, timers, hide, show, fire };
}

test('hidden past the timeout while connected: one regular leave', () => {
  const { logs, calls, timers, hide, fire } = lifecycle();
  hide();
  assert.equal([...timers.values()][0].ms, 60000);
  hide();
  assert.equal(timers.size, 1, 'a second hidden event does not stack a second timer');
  fire();
  assert.deepEqual(calls, ['save', 'save', 'leave']);
  assert.ok(logs.includes('[LEAVE] hidden for 60 s while connected: asking the game to disconnect'));
});

test('coming back sooner cancels the leave; not connected or not started: no leave', () => {
  const a = lifecycle();
  a.hide(); a.show();
  assert.equal(a.timers.size, 0);
  const b = lifecycle({ connected: false });
  b.hide(); b.fire();
  assert.ok(!b.calls.includes('leave'));
  const c = lifecycle({ started: false });
  c.hide(); c.fire(); c.life.onBeforeUnload();
  assert.deepEqual(c.calls, [], 'before main() nothing is saved and nothing is left');
});

test('the backstop saves on hidden and on beforeunload, and reports a failure', () => {
  const a = lifecycle();
  a.hide(); a.life.onBeforeUnload();
  assert.deepEqual(a.logs, ['[PERSISTBACKSTOP] visibilitychange-hidden', '[PERSISTBACKSTOP] beforeunload']);
  const b = lifecycle({ saveThrows: true });
  b.life.onBeforeUnload();
  assert.deepEqual(b.logs, ['[PERSISTBACKSTOP] beforeunload FAILED: Error: boom']);
});

test('audio: a trusted gesture resumes a suspended context, and says so once', async () => {
  const logs = [];
  let n = 0, resumes = 0;
  const ctx = { state: 'suspended', resume: () => { resumes++; return Promise.resolve(); } };
  const handler = Audio.resumer({ context: () => ctx, log: (l) => logs.push(l), resumed: () => n++ });
  handler({ isTrusted: false, type: 'pointerup' });
  assert.equal(resumes, 0, 'a synthetic event is not a gesture');
  handler({ isTrusted: true, type: 'pointerup' });
  handler({ isTrusted: true, type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(resumes, 2, 'every gesture tries while it is not running');
  assert.deepEqual(logs, ['[AUDIO] resumed on pointerup']);
  ctx.state = 'running';
  handler({ isTrusted: true, type: 'keydown' });
  assert.equal(resumes, 2);
  Audio.resumer({ context: () => null, log: () => {}, resumed: () => 0 })({ isTrusted: true, type: 'click' });
});

test('diag: MATCH and CLAMPED, the aspect error, and the context row', () => {
  const m = { dpr: 3, vw: 412, vh: 915, vis: null, bsW: 1236, bsH: 1236, cssW: 412, cssH: 412,
              gl: { w: 1236, h: 1236 }, fps: 60, cam: 0.5, touch: true,
              ctx: { raw: 2, menu: false, cycle: true, driving: true } };
  const ok = Diag.rows(m);
  assert.equal(ok.bad, false);
  assert.match(ok.text, /gl  1236x1236  MATCH/);
  assert.match(ok.text, /err 0\.00%/);
  assert.match(ok.text, /ctx 2 menu n cycle y -> STEER/);
  const clamped = Diag.rows({ ...m, gl: { w: 1024, h: 1024 } });
  assert.equal(clamped.bad, true);
  assert.match(clamped.text, /CLAMPED/);
  assert.equal(Diag.rows({ ...m, cssW: 420 }).bad, true, 'a stretched box');
  assert.match(Diag.rows({ ...m, ctx: null, touch: false }).text, /ctx n\/a \(desktop\)/);
});

test('shell.html runs no block by itself: everything starts from THE START ORDER', () => {
  const lines = readRepoFile('web/shell.html').split('\n');
  const iifes = lines.filter((l) => /^ {4}\(\(\) => \{/.test(l));
  assert.deepEqual(iifes, []);
  const code = lines.filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const gone of ['addEventListener(\'visibilitychange\', () =>', 'function resumeAudio', 'C.prototype[m] =']) {
    assert.ok(!code.includes(gone), gone);
  }
});
