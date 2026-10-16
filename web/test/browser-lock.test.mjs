// One gate browser at a time: two headless Chromes software-render WebGL at
// ~630 % CPU each, and two suites in parallel once took the machine down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeBrowserLock } from '../tools/browser-lock.mjs';

const lockIn = () => join(mkdtempSync(join(tmpdir(), 'aa-lock-test-')), 'browser.lock');
const alive = (pids) => (pid) => pids.includes(pid);

test('the first driver gets the lock and the second is refused, naming the first', () => {
  const path = lockIn();
  const first = takeBrowserLock({ path, pid: 100, out: '/tmp/a', isAlive: alive([100, 200]) });
  assert.equal(first.ok, true);
  const second = takeBrowserLock({ path, pid: 200, out: '/tmp/b', isAlive: alive([100, 200]) });
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, 100);
  assert.equal(second.holder.out, '/tmp/a');
});

test('a lock left by a driver that died (killed, crashed) is taken over', () => {
  const path = lockIn();
  takeBrowserLock({ path, pid: 100, out: '/tmp/a', isAlive: alive([100]) });
  const next = takeBrowserLock({ path, pid: 200, out: '/tmp/b', isAlive: alive([200]) });
  assert.equal(next.ok, true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, 200);
});

test('a lock file that is not JSON counts as stale', () => {
  const path = lockIn();
  writeFileSync(path, 'garbage');
  assert.equal(takeBrowserLock({ path, pid: 200, out: '/tmp/b', isAlive: alive([200]) }).ok, true);
});

test('release frees the lock, and only for its own holder', () => {
  const path = lockIn();
  const a = takeBrowserLock({ path, pid: 100, out: '/tmp/a', isAlive: alive([100, 200]) });
  a.release();
  assert.equal(existsSync(path), false);
  const b = takeBrowserLock({ path, pid: 200, out: '/tmp/b', isAlive: alive([100, 200]) });
  a.release();
  assert.equal(existsSync(path), true, "an old holder's release must not free the new holder's lock");
  b.release();
  assert.equal(existsSync(path), false);
});
