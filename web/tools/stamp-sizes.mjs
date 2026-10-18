#!/usr/bin/env node
// web/tools/stamp-sizes.mjs <dist-dir> -- writes the byte sizes of the game's
// two big downloads into <dist-dir>/armagetronad.html.
//
// The loading bar (web/page/loading.js) counts those downloads as they stream
// in, and needs their real, uncompressed sizes: Content-Length cannot give
// them on a server that gzips (GitHub Pages does). The page carries the
// placeholder string '@AA_SIZES@' (a string, because the HTML minifier keeps
// strings and drops comments); this replaces it with the sizes as a JSON
// object. web/Makefile runs it right after the link step writes the page, and
// before stamp-sw.mjs hashes it.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDER = '@AA_SIZES@';
const FILES = ['armagetronad.wasm', 'armagetronad.data'];   // web/page/loading.js FILES (the test checks)

export function sizesFor(dir) {
  const sizes = {};
  for (const f of FILES) sizes[f] = statSync(join(dir, f)).size;
  return sizes;
}

export function stamp(html, sizes) {
  const re = new RegExp(`(['"])${PLACEHOLDER}\\1`, 'g');
  const n = (html.match(re) || []).length;
  if (n !== 1) throw new Error(`armagetronad.html: want exactly one '${PLACEHOLDER}', found ${n}`);
  return html.replace(re, () => JSON.stringify(sizes));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node web/tools/stamp-sizes.mjs <dist-dir>'); process.exit(2); }
  const page = join(dir, 'armagetronad.html');
  const sizes = sizesFor(dir);
  writeFileSync(page, stamp(readFileSync(page, 'utf8'), sizes));
  console.log('armagetronad.html: download sizes ' + JSON.stringify(sizes));
}
