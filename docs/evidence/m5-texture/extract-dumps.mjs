#!/usr/bin/env node
// Turn the `AA_GLPROBE.dump(id)` lines in a texture-probe transcript into PNGs.
//
//   node docs/evidence/m5-texture/extract-dumps.mjs docs/evidence/m5-texture/run-chrome
//
// Each dump is level 0 of one live WebGLTexture, read back through a
// framebuffer -- i.e. THE TEXELS THE GAME UPLOADED, after SDL's decode and
// after gTextureCycle::ProcessImage's recolour. Comparing one of these against
// the shipped textures/*.png tests the whole decode path in one step.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: extract-dumps.mjs <run-dir>'); process.exit(1); }
const log = readFileSync(join(dir, 'console.log'), 'utf8');
const out = join(dir, 'textures');
mkdirSync(out, { recursive: true });
let n = 0;
let gen = null;
for (const line of log.split('\n')) {
  // dump(id) -- level 0 of one texture, read back through a framebuffer
  const d = /\[harness\] eval window\.AA_GLPROBE\.dump\((\d+)\) => "data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(line);
  if (d) { emit(`tex-${String(d[1]).padStart(2, '0')}`, d[2]); continue; }
  // crop('name') -- a rectangle of the drawing buffer at 1:1. These are the
  // ones to LOOK at: a CDP screenshot of a canvas larger than the window is a
  // downscale, and a downscale cannot answer a question about sharpness.
  // A run may crop the same rect several times (the mid-run anisotropy flip
  // takes three generations of each). The `mark:` line that most recently
  // preceded a crop names its generation, so crops keep their identity instead
  // of overwriting one another.
  const g = /\[harness\] === (.+) ===\s*$/.exec(line);
  if (g) { gen = g[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'); continue; }
  const c = /\[harness\] eval window\.AA_GLPROBE\.crop\('([a-z_]+)'\) => "data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(line);
  if (c) { emit(gen ? `${gen}__${c[1]}` : `crop-${c[1]}`, c[2]); continue; }
}
function emit(name, b64) {
  const buf = Buffer.from(b64, 'base64');
  const file = join(out, `${name}.png`);
  writeFileSync(file, buf);
  console.log(`${file}  ${buf.length} bytes`);
  n++;
}
console.log(`${n} images extracted`);
