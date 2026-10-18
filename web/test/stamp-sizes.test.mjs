// web/tools/stamp-sizes.mjs: the built page learns the real sizes of its downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepoFile } from './load-page-module.mjs';
import { PLACEHOLDER, sizesFor, stamp } from '../tools/stamp-sizes.mjs';
import { loadPageModule } from './load-page-module.mjs';

test('the sizes are the files\' byte lengths, for exactly the files the bar counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aa-sizes-'));
  writeFileSync(join(dir, 'armagetronad.wasm'), Buffer.alloc(1234));
  writeFileSync(join(dir, 'armagetronad.data'), Buffer.alloc(56));
  assert.deepEqual(sizesFor(dir), { 'armagetronad.wasm': 1234, 'armagetronad.data': 56 });
  const files = loadPageModule('web/page/loading.js', 'AALoading').FILES;
  assert.deepEqual(Object.keys(sizesFor(dir)).sort(), [...files].sort());
});

test('stamp replaces the one placeholder, in either quote style the minifier leaves', () => {
  const sizes = { 'armagetronad.wasm': 1, 'armagetronad.data': 2 };
  for (const q of ["'", '"']) {
    const out = stamp(`a=${q}${PLACEHOLDER}${q};b`, sizes);
    assert.equal(out, 'a={"armagetronad.wasm":1,"armagetronad.data":2};b');
  }
});

test('stamp refuses a page with no placeholder or with two', () => {
  assert.throws(() => stamp('nothing here', {}), /exactly one/);
  assert.throws(() => stamp(`'${PLACEHOLDER}' '${PLACEHOLDER}'`, {}), /exactly one/);
});

test('the page carries the placeholder once, and the link step stamps it before sw.js hashes the page', () => {
  assert.equal(readRepoFile('web/shell.html').split(`'${PLACEHOLDER}'`).length, 2);
  const mk = readRepoFile('web/Makefile');
  assert.match(mk, /\t\$\(EMXX\) \$\(CLIENT_OBJS\)[^\n]*-o \$@\n\t\$\(NODE\) web\/tools\/stamp-sizes\.mjs web\/dist-m1\n/);
});
