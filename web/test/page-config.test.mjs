// web/page/page-config.js: the config lines the page appends, exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';

const C = loadPageModule('web/page/page-config.js', 'AAPageConfig');
const AUTO = '/data/webdefaults/autoexec.cfg';
const none = { cam: null, sparks: null, wallcut: null };

// What the five separate appenders this module replaced wrote on a phone with
// no parameters, in their order (camera, sparks, hints, wall cut), byte for
// byte. Written out by hand, not generated.
const PHONE = [
  '',
  '# appended at runtime by web/shell.html: camera x0.5 (touch device)',
  'CAMERA_CUSTOM_BACK 3', 'CAMERA_CUSTOM_RISE 2',
  'CAMERA_CUSTOM_BACK_FROMSPEED 0.25', 'CAMERA_CUSTOM_RISE_FROMSPEED 0.2',
  'CAMERA_GLANCE_BACK 3', 'CAMERA_GLANCE_RISE 2',
  'CAMERA_GLANCE_BACK_FROMSPEED 0.25', 'CAMERA_GLANCE_RISE_FROMSPEED 0.2',
  '',
].join('\n') + [
  '',
  '# appended at runtime by web/shell.html: crash sparks on, priced for a phone (touch device)',
  'SPARKS 1', 'SPARKS_LIFETIME 1', 'SPARKS_INTERVAL 0.05',
  '',
].join('\n') + [
  '',
  '# appended at runtime by web/shell.html: no camera or glance hints on a touch device',
  'SWITCH_VIEW_TOOLTIP 0 0 0 0 0', 'GLANCE_BACK_TOOLTIP 0 0 0 0 0',
  'GLANCE_LEFT_TOOLTIP 0 0 0 0 0', 'GLANCE_RIGHT_TOOLTIP 0 0 0 0 0',
  '',
].join('\n') + [
  '',
  '# appended at runtime by web/shell.html: wall cut (touch device)',
  'WALL_CUT 1',
  '',
].join('\n');

function fakeFS(start = 'SHIPPED\n', { failWrite = false } = {}) {
  const files = { [AUTO]: start };
  const writes = [];
  return {
    files, writes,
    readFile: (p) => { if (!(p in files)) throw new Error('ENOENT ' + p); return files[p]; },
    writeFile: (p, data) => {
      if (failWrite) throw new Error('EIO');
      writes.push(p); files[p] = data;
    },
  };
}
const run = (touch, params, fs = fakeFS()) => {
  const logs = [];
  C.apply(fs, touch, params, (l) => logs.push(l));
  return { fs, logs };
};

test('a phone with no parameters: the four blocks, in one write', () => {
  const { fs, logs } = run(true, none);
  assert.equal(fs.files[AUTO], 'SHIPPED\n' + PHONE);
  assert.deepEqual(fs.writes, [AUTO]);
  assert.deepEqual(logs, [
    '[CAMERA] camera distance x0.5 written to ' + AUTO + ' before main()',
    '[SPARKS] SPARKS 1 / SPARKS_LIFETIME 1 / SPARKS_INTERVAL 0.05 written to ' + AUTO + ' before main() (touch device)',
    '[HINTS] camera and glance hints off (touch device)',
    '[WALLS] WALL_CUT 1 written to ' + AUTO + ' before main()',
  ]);
});

test('a desktop with no parameters: the shipped file is left exactly as it was', () => {
  const { fs, logs } = run(false, none);
  assert.equal(fs.files[AUTO], 'SHIPPED\n');
  assert.deepEqual(fs.writes, []);
  assert.deepEqual(logs, ['[CAMERA] stock camera (factor 1)', '[SPARKS] stock sparks, nothing written']);
});

test('overrides: ?cam=1 on a phone, ?sparks=0 and ?wallcut=1 on a desktop', () => {
  const phone = C.plan(true, { cam: 1, sparks: null, wallcut: null });
  assert.ok(!/CAMERA_/.test(phone.text));
  assert.equal(phone.sections[0].ok, '[CAMERA] stock camera (factor 1, from ?cam)');

  const desk = C.plan(false, { cam: null, sparks: 0, wallcut: 1 });
  assert.equal(desk.text,
    '\n# appended at runtime by web/shell.html: crash sparks off (from ?sparks=0)\nSPARKS 0\n' +
    '\n# appended at runtime by web/shell.html: wall cut (?wallcut=1)\nWALL_CUT 1\n');

  const stock = C.plan(true, { cam: null, sparks: 1, wallcut: 0 });
  assert.match(stock.text, /crash sparks on \(from \?sparks=1\)\nSPARKS 1\n/);
  assert.ok(!/WALL_CUT/.test(stock.text));
  assert.equal(stock.sections.at(-1).ok, '[WALLS] wall cut off (?wallcut=0)');

  assert.match(C.plan(false, { cam: 0.35, sparks: null, wallcut: null }).text,
    /camera x0\.35\nCAMERA_CUSTOM_BACK 2\.1\n/);
});

test('?sparks= in range but not 0 or 1 is ignored out loud and the device default stands', () => {
  const { logs, fs } = run(true, { cam: null, sparks: 0.5, wallcut: null });
  assert.ok(logs.includes('[SPARKS] ?sparks=0.5 ignored (want 0 or 1)'));
  assert.match(fs.files[AUTO], /SPARKS_INTERVAL 0\.05/);
});

test('a failed write is logged under every section that wanted to write, and never thrown', () => {
  const { logs } = run(true, none, fakeFS('x', { failWrite: true }));
  assert.deepEqual(logs, [
    '[CAMERA] tuning skipped (factor 0.5): Error: EIO',
    '[SPARKS] tuning skipped (value cheap): Error: EIO',
    '[HINTS] skipped: Error: EIO',
    '[WALLS] wall cut skipped: Error: EIO',
  ]);
});

test('the camera base values still match config/settings_visual.cfg', () => {
  const cfg = readRepoFile('config/settings_visual.cfg');
  for (const [k, v] of Object.entries(C.CAMERA_BASE)) {
    const m = new RegExp('^\\s*' + k + '\\s+([0-9.]+)', 'm').exec(cfg);
    assert.ok(m, k + ' is in settings_visual.cfg');
    assert.equal(Number(m[1]), v, k);
  }
});

test('default name and the one-time web_user rename', () => {
  assert.match(C.defaultName(), /^web_\d{4}$/);
  assert.equal(C.defaultName(() => 0.0042), 'web_0042');
  assert.equal(C.renameOldDefault('A 1\nPLAYER_1 web_user\nB 2\n', 'web_0007'), 'A 1\nPLAYER_1 web_0007\nB 2\n');
  assert.equal(C.renameOldDefault('PLAYER_1 web_user  \n', 'web_1'), 'PLAYER_1 web_1\n');
  assert.equal(C.renameOldDefault('PLAYER_1 web_users\n', 'x'), null);
  assert.equal(C.renameOldDefault('PLAYER_1 Ångström\n', 'x'), null);
  assert.equal(C.renameOldDefault('PLAYER_2 web_user\n', 'x'), null);
});

test('applyRename keeps user.cfg latin-1 and logs once', () => {
  const name = 'web_0001';
  const cfg = 'PLAYER_1 web_user\nCHAT \xe9t\xe9\n';
  const files = { '/persist/var/user.cfg': Uint8Array.from(cfg, (c) => c.charCodeAt(0)) };
  const FS = {
    analyzePath: (p) => ({ exists: p in files }),
    readFile: (p) => files[p],
    writeFile: (p, d) => { files[p] = d; },
  };
  const logs = [];
  C.applyRename(FS, name, (l) => logs.push(l));
  assert.equal(String.fromCharCode(...files['/persist/var/user.cfg']), 'PLAYER_1 web_0001\nCHAT \xe9t\xe9\n');
  assert.deepEqual(logs, ['[NAME] the old default web_user is now web_0001']);
  C.applyRename(FS, 'web_0002', (l) => logs.push(l));
  assert.equal(logs.length, 1, 'renamed once only');
});

test('shell.html writes autoexec.cfg nowhere else', () => {
  const code = readRepoFile('web/shell.html').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.deepEqual(code.match(/FS\.writeFile\(/g) || [], []);
});
