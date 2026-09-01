#!/usr/bin/env node
// Build the control pages for M5 task 5's frame-rate sweep -- the measurement
// that chose MAX_CANVAS_PIXELS in web/shell.html.
//
//   make -f web/Makefile client -j8
//   node docs/evidence/m5-startup/make-resolution-pages.mjs
//   # writes web/dist-m1/res-1024x768.html   (0.79 Mpx -- the pre-M5 size)
//   #        web/dist-m1/res-1280x720.html   (0.92 Mpx)
//   #        web/dist-m1/res-1600x900.html   (1.44 Mpx)
//   #        web/dist-m1/res-1920x1080.html  (2.07 Mpx)
//   #        web/dist-m1/res-2560x1440.html  (3.69 Mpx)
//   #        web/dist-m1/res-3360x1890.html  (6.35 Mpx -- this machine's screen)
//
// then, per page:
//
//   node web/tools/drive-browser.mjs --headed --out /tmp/fps-1920x1080 \
//        --url http://localhost:8000/res-1920x1080.html \
//        --script-file web/tools/fps-resolution-probe.steps
//
// ============================ WHY A PAGE AND NOT A REBUILD ==================
//
// The quantity being measured is frames per second as a function of ONE input,
// the canvas backing store. A rebuild per resolution would vary the binary as
// well, and this repo has already been bitten once by a "control" that changed
// more than the thing under test. Every page written here loads the SAME
// armagetronad.js, armagetronad.wasm and armagetronad.data -- they are plain
// relative <script src> and fetches, and none of them is copied or edited. The
// only difference between two sweep pages is two numbers in one injected
// <script>.
//
// web/shell.html reads window.AA_CANVAS_SIZE before it consults window.screen
// and takes it in preference. That hook exists for this file and is documented
// as such at its definition; nothing in the shipped page defines it.
//
// ============================ WHY THE INJECTION POINT IS <body> =============
//
// -O2 minifies the shell into the generated HTML, so nothing in it can be
// matched on its readable form -- `outline: none` comes out as `outline:0`,
// and `1920 * 1080` comes out constant-folded to `2073600`. The one anchor
// that survives minification unchanged is the `<body>` tag itself, because it
// is structure rather than content. The injected script must come BEFORE the
// shell's own inline <script> (which is the next thing in the body) so that
// the global is already set when the sizing block reads it, and `<body>` is
// the only point that is both stable and early enough.
//
// The insert is asserted, not assumed: a missing or duplicated `<body>` is a
// hard exit rather than a page that silently measures the default size.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist-m1');
const SRC = join(DIST, 'armagetronad.html');

// 1024x768 is what every gate before M5 ran at and is the comparison point for
// "60 fps median / 52 min". 3360x1890 is this machine's screen, i.e. the
// uncapped result of the new sizing rule. The rest bracket the answer.
const SIZES = [
  [1024, 768],
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3360, 1890],
];

const html = readFileSync(SRC, 'utf8');
const occurrences = html.split('<body>').length - 1;
if (occurrences !== 1) {
  console.error(`expected exactly one <body> in ${SRC}, found ${occurrences}`);
  process.exit(1);
}

for (const [w, h] of SIZES) {
  const inject = `<script>window.AA_CANVAS_SIZE=[${w},${h}]</script>`;
  const out = html.replace('<body>', `<body>${inject}`);
  if (!out.includes(inject)) {
    console.error(`injection failed for ${w}x${h}`);
    process.exit(1);
  }
  const file = join(DIST, `res-${w}x${h}.html`);
  writeFileSync(file, out);
  console.log(`${file}  canvas ${w}x${h}  ${(w * h / 1e6).toFixed(2)} Mpx`);
}
