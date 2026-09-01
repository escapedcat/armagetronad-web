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
for (const line of log.split('\n')) {
  const m = /\[harness\] eval window\.AA_GLPROBE\.dump\((\d+)\) => "data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(line);
  if (!m) continue;
  const file = join(out, `tex-${String(m[1]).padStart(2, '0')}.png`);
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  console.log(`${file}  ${Buffer.from(m[2], 'base64').length} bytes`);
  n++;
}
console.log(`${n} textures extracted`);
