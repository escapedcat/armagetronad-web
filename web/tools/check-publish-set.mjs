#!/usr/bin/env node
// Assert that the directory about to be published holds EXACTLY the release
// set -- no more, no less -- and fail before anything reaches the remote.
//
//     node web/tools/check-publish-set.mjs [dir]        # default web/dist-m1
//     node web/tools/check-publish-set.mjs --list       # print the set and exit 0
//
// WHY THIS EXISTS. `npm run deploy` publishes `web/dist-m1` as it finds it.
// That directory is gitignored, it is where every probe build and generated
// control page in this milestone was written, and `make -f web/Makefile client`
// does not clear it. The result is already published: the live gh-pages branch
// carried 23 entries and 16,185,514 bytes where the release is 6 entries and
// 5,382,608 -- the extra 17 being `armagetronad-fstoggle.*`,
// `armagetronad-oldyield.*` and nine `res-*.html` probe pages, all publicly
// fetchable, one of them a build with a known HUD flicker and one a build with
// a deliberately broken fullscreen key. Two later tasks then left five more
// (`texprobe.html`, `aniso-{on,off}.html`, `fps-aniso-{on,off}.html`) that the
// next deploy would have published the same way.
//
// Nothing detected any of that, because nothing was looking: the deploy step
// had no idea what it was supposed to be shipping. Every earlier attempt at
// this problem in this repo hard-coded a list of names to CHECK and so could
// only ever miss a stray -- `docs/evidence/m5-deploy/measure-wire.sh` and
// `web/tools/wire-facts.sh` both enumerate the five expected files and are
// silent about a sixth. Set equality is the fix, and it is the standard this
// project already holds its provers to.
//
// WHAT IT DOES NOT DO. It says nothing about the CONTENT of these files -- a
// stale build with the right names passes. `check-wire-facts.mjs` W7 is the
// content check, and it runs against the deployment afterwards. This one is
// about the shape of the set only.
//
// PROVING IT CAN FAIL: web/tools/prove-publish-set-check-can-fail.sh.

import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The release set, by name. `.nojekyll` is deliberately absent: gh-pages writes
// it into the published branch from the --nojekyll flag, it is never in dist.
const EXPECTED = [
  'armagetronad.data',   // preloaded MEMFS image
  'armagetronad.html',   // emcc's page -- the entry point the gates name
  'armagetronad.js',     // emcc's glue
  'armagetronad.wasm',   // the engine
  'index.html',          // the site-root redirect; copied in by `npm run deploy`
];

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const n of EXPECTED) console.log(n);
  process.exit(0);
}

const dir = args[0] ?? join(here, '..', 'dist-m1');

// Walk everything gh-pages would publish. Its -v pattern is "{**/*,**/.*}",
// which matches dotfiles at every level, so a walk that skipped them would be
// checking a different set than the one that ships.
function walk(root, base = root) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (e) {
    console.error(`cannot read ${root}: ${e.message}`);
    process.exit(2);
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) out = out.concat(walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

const found = walk(dir).sort();
const expected = [...EXPECTED].sort();

const strays = found.filter((n) => !expected.includes(n));
const missing = expected.filter((n) => !found.includes(n));

let total = 0;
console.log(`publish set: ${dir}`);
for (const n of found) {
  const bytes = statSync(join(dir, n)).size;
  total += bytes;
  const tag = strays.includes(n) ? 'STRAY   ' : '        ';
  console.log(`  ${tag} ${String(bytes).padStart(9)}  ${n}`);
}
console.log(`  ${found.length} file(s), ${total} bytes`);

if (strays.length === 0 && missing.length === 0) {
  console.log(`\nPASS  the set equals the ${expected.length} declared release files`);
  process.exit(0);
}

console.error('');
if (strays.length) {
  console.error(`FAIL  ${strays.length} file(s) present that are NOT part of the release:`);
  for (const n of strays) console.error(`        ${n}`);
  console.error('      These would be published and publicly fetchable. Delete them,');
  console.error('      or `make -f web/Makefile clean` and rebuild before deploying.');
}
if (missing.length) {
  console.error(`FAIL  ${missing.length} release file(s) absent:`);
  for (const n of missing) console.error(`        ${n}`);
  console.error('      Build first: source deps/emsdk/emsdk_env.sh &&');
  console.error('      make -f web/Makefile client -j8   (index.html is copied by `npm run deploy`)');
}
process.exit(1);
