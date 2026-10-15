#!/usr/bin/env node
// web/tools/stamp-sw.mjs <dist-dir> -- writes <dist-dir>/sw.js from web/sw.js.
//
// The worker saves the game for offline play, and it must never save half of
// one build and half of another (Pages publishes a deploy file by file). So
// each build's sw.js carries the SHA-256 of every file it saves; the worker
// hashes what it downloaded and refuses a mismatch. The version -- the cache
// name's suffix -- is a hash of those hashes, so it changes exactly when a
// saved file changes, and a changed sw.js is what tells the browser that a new
// build is out. web/Makefile runs this after the link step.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRECACHED = ['armagetronad.html', 'armagetronad.js', 'armagetronad.wasm', 'armagetronad.data'];
const PLACEHOLDER = '/* @precache */ null';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function precacheFor(dir) {
  const files = {};
  for (const f of PRECACHED) files[f] = sha256(readFileSync(join(dir, f)));
  return { version: sha256(PRECACHED.map((f) => files[f]).join('\n')).slice(0, 12), files };
}

export function stamp(template, precache) {
  if (template.split(PLACEHOLDER).length !== 2) {
    throw new Error('sw.js template: want exactly one ' + PLACEHOLDER);
  }
  return template.replace(PLACEHOLDER, () => JSON.stringify(precache));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node web/tools/stamp-sw.mjs <dist-dir>'); process.exit(2); }
  const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sw.js'), 'utf8');
  const precache = precacheFor(dir);
  writeFileSync(join(dir, 'sw.js'), stamp(template, precache));
  console.log('sw.js: offline copy aa-offline-' + precache.version);
}
