// One gate browser at a time, machine-wide.
//
// A headless gate browser renders WebGL in software (SwiftShader), and its GPU
// helper alone takes ~630 % CPU. On 2026-10-16 two gate suites ran in parallel
// (devtools ports 9222 and 9422) and starved the Mac's watchdog into a kernel
// panic. Ports keep two runs from colliding, not from overloading the machine,
// so drive-browser.mjs takes this lock before it starts a browser and refuses
// to run while another driver holds it.
//
// The lock is a file holding the holder's pid. A driver that is killed without
// cleaning up (a watchdog's SIGKILL, a crash) leaves the file behind; the next
// driver finds that pid dead and takes the lock over.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_LOCK = join(tmpdir(), 'aa-gate-browser.lock');

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function readHolder(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// -> { ok: true, release() } or { ok: false, holder: { pid, out, started } }
export function takeBrowserLock({ path = DEFAULT_LOCK, pid = process.pid, out = '',
                                  isAlive = pidAlive } = {}) {
  const mine = JSON.stringify({ pid, out, started: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, mine, { flag: 'wx' });
      return {
        ok: true,
        release() {
          if (readHolder(path)?.pid === pid) { try { unlinkSync(path); } catch { /* gone */ } }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const holder = readHolder(path);
    if (holder && Number.isInteger(holder.pid) && isAlive(holder.pid)) return { ok: false, holder };
    try { unlinkSync(path); } catch { /* someone else cleared it */ }
  }
  return { ok: false, holder: readHolder(path) ?? { pid: null, out: '', started: '' } };
}
