// The installable app's files: manifest, icons, publish set, page links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readRepoFile, repoPath } from './load-page-module.mjs';
import { PRECACHED } from '../tools/stamp-sw.mjs';

const OFFLINE_FILES = ['sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const manifest = () => JSON.parse(readRepoFile('web/pwa/manifest.json'));
const pngSize = (rel) => {
  const b = readFileSync(repoPath(rel));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', rel + ' is a PNG');
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
};

test('the manifest starts the app in app mode, the mode web/sw.js serves offline', () => {
  const m = manifest();
  const start = new URL(m.start_url, 'https://aa.test/game/');
  assert.equal(start.pathname, '/game/armagetronad.html');
  assert.equal(start.searchParams.get('app'), '1');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'fullscreen');
  assert.match(readRepoFile('web/sw.js'), /searchParams\.get\('app'\) === '1'/);
});

test('every manifest icon is in web/pwa at the size it claims', () => {
  const icons = manifest().icons;
  assert.deepEqual(icons.map((i) => i.sizes).sort(), ['192x192', '512x512']);
  for (const i of icons) assert.equal(pngSize('web/pwa/' + i.src), i.sizes, i.src);
});

test('the publish set has the offline files and every file the worker saves', () => {
  const list = execFileSync(process.execPath, [repoPath('web/tools/check-publish-set.mjs'), '--list'],
                            { encoding: 'utf8' }).trim().split('\n');
  for (const f of [...OFFLINE_FILES, ...PRECACHED]) assert.ok(list.includes(f), f);
});

test('the deploy waits for the offline files too', () => {
  const files = /FILES="([^"]+)"/.exec(readRepoFile('.github/workflows/deploy-pages.yml'))[1].split(' ');
  for (const f of OFFLINE_FILES) assert.ok(files.includes(f), f);
});

test('the page links the manifest and the home-screen icon', () => {
  const head = readRepoFile('web/shell.html').split('</head>')[0];
  assert.match(head, /<link rel="manifest" href="manifest.json">/);
  assert.match(head, /<link rel="apple-touch-icon" href="icon-192.png">/);
  assert.match(head, /<meta name="theme-color" content="#111111">/);
});
