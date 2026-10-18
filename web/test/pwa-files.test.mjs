// The installable app's files: manifest, icons, publish set, page links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readRepoFile, repoPath } from './load-page-module.mjs';
import { PRECACHED } from '../tools/stamp-sw.mjs';

const OFFLINE_FILES = ['sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
                       'icon-maskable-512.png', 'apple-touch-icon.png'];
const manifest = () => JSON.parse(readRepoFile('web/pwa/manifest.json'));
const pngSize = (rel) => {
  const b = readFileSync(repoPath(rel));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', rel + ' is a PNG');
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
};
// IHDR colour type: 2 = RGB, 6 = RGBA. A full-bleed icon must be opaque: iOS
// fills transparency with black, and Android's mask would show it.
const pngHasAlpha = (rel) => [4, 6].includes(readFileSync(repoPath(rel))[25]);

test('the manifest starts the app in app mode (sw.test checks the worker serves it)', () => {
  const m = manifest();
  const start = new URL(m.start_url, 'https://aa.test/game/');
  assert.equal(start.pathname, '/game/armagetronad.html');
  assert.equal(start.searchParams.get('app'), '1');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'fullscreen');
  // The app's identity. Chrome derives it from start_url when id is missing,
  // so this keeps installs made before id was set as the same app.
  assert.equal(new URL(m.id, 'https://aa.test/game/').href, start.href);
});

test('every manifest icon is in web/pwa at the size it claims', () => {
  const icons = manifest().icons;
  assert.deepEqual(icons.map((i) => (i.purpose ?? 'any') + ' ' + i.sizes).sort(),
                   ['any 192x192', 'any 512x512', 'maskable 512x512']);
  for (const i of icons) assert.equal(pngSize('web/pwa/' + i.src), i.sizes, i.src);
});

test('the full-bleed icons are opaque, and the home-screen icon is 180 px', () => {
  for (const i of manifest().icons.filter((i) => i.purpose === 'maskable'))
    assert.equal(pngHasAlpha('web/pwa/' + i.src), false, i.src);
  assert.equal(pngSize('web/pwa/apple-touch-icon.png'), '180x180');
  assert.equal(pngHasAlpha('web/pwa/apple-touch-icon.png'), false);
});

test('the publish set has the offline files and every file the worker saves', () => {
  const list = execFileSync(process.execPath, [repoPath('web/tools/check-publish-set.mjs'), '--list'],
                            { encoding: 'utf8' }).trim().split('\n');
  for (const f of [...OFFLINE_FILES, ...PRECACHED]) assert.ok(list.includes(f), f);
});

test('every file in web/pwa is copied by the build (web/Makefile PWA_FILES)', () => {
  // Adding an offline file touches four lists: web/pwa, PWA_FILES, the publish
  // set and the deploy's FILES. This test and the two below keep them equal.
  const pwa = /^PWA_FILES := (.+)$/m.exec(readRepoFile('web/Makefile'))[1].trim().split(/\s+/)
    .map((p) => p.replace('web/dist-m1/', ''));
  assert.deepEqual(pwa.sort(), readdirSync(repoPath('web/pwa')).sort());
  for (const f of pwa) assert.ok(OFFLINE_FILES.includes(f), f + ' is in OFFLINE_FILES');
});

test('the deploy waits for the offline files too', () => {
  const files = /FILES="([^"]+)"/.exec(readRepoFile('.github/workflows/deploy-pages.yml'))[1].split(' ');
  for (const f of OFFLINE_FILES) assert.ok(files.includes(f), f);
});

test('the page links the manifest and the home-screen icon', () => {
  const head = readRepoFile('web/shell.html').split('</head>')[0];
  assert.match(head, /<link rel="manifest" href="manifest.json">/);
  assert.match(head, /<link rel="apple-touch-icon" href="apple-touch-icon.png">/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="Armagetron">/);
  assert.match(head, /<meta name="theme-color" content="#111111">/);
});

test('the build runs the stamp with emsdk\'s own node, not a PATH lookup of `node`', () => {
  // CI (GNU make 4, emsdk_env.sh sourced) failed with "make: node: Permission
  // denied" on a bare `node`; the link step just before it runs emsdk's node.
  const mk = readRepoFile('web/Makefile');
  assert.match(mk, /^NODE \?= \$\(or \$\(EMSDK_NODE\),node\)$/m);
  assert.match(mk, /^\t\$\(NODE\) web\/tools\/stamp-sw\.mjs web\/dist-m1$/m);
});
