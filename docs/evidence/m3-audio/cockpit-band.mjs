#!/usr/bin/env node
// Count bright pixels in the bottom band of a PNG screenshot, where the game's
// cockpit instrument panel is drawn.
//
//   node docs/evidence/m3-audio/cockpit-band.mjs docs/evidence/m3-audio/m2-rerun/*.png
//
// WHY THIS EXISTS. "The HUD is missing from these screenshots" is a claim about
// binary files, and a reviewer reading a diff cannot check it -- the M3 review
// said exactly that. This turns each frame into one number, so the claim can be
// re-derived instead of taken on someone's eyesight. Zero dependencies: Node's
// zlib is enough to inflate a PNG, and the filter reconstruction below is the
// whole of the format Chrome and Firefox screenshots use (8-bit, RGB or RGBA,
// non-interlaced).
//
// HOW TO READ THE NUMBER. It is not calibrated in the abstract; it separates
// frames WITHIN one engine, because the two cameras leave different amounts of
// grid in the band. Measured over the frames in this directory:
//
//   Chrome    1242 = grid lines only, no cockpit    >= 2300 = cockpit present
//   Firefox      0 = empty band, no cockpit         >= 2200 = cockpit present
//
// Both ends were confirmed by eye before the thresholds were written down, and
// the metric agrees with M2's own prose about M2's own evidence: that README
// says firefox-04 has no cockpit in it, and this scores that frame 0.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(path) {
  const b = readFileSync(path);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9];
      if (depth !== 8 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported ${depth}/${ctype}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const c = prev ? prev[x] : 0;
      const d = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += c;
      else if (f === 3) v += (a + c) >> 1;
      else if (f === 4) {
        const pp = a + c - d, pa = Math.abs(pp - a), pb = Math.abs(pp - c), pc = Math.abs(pp - d);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? c : d);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, bpp, stride, out };
}

// The cockpit band: the bottom 110 rows, where Scores / Rubber / Speed /
// Brakes / Enemies are drawn. Without the cockpit this region holds only grid
// lines, which are dim; the cockpit's text is near-white or saturated colour.
for (const f of process.argv.slice(2)) {
  const { w, h, bpp, stride, out } = decode(f);
  let bright = 0;
  for (let y = h - 110; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp;
      if (out[i] + out[i + 1] + out[i + 2] > 330) bright++;
    }
  console.log(`${String(bright).padStart(6)}  ${f.split('/').slice(-2).join('/')}`);
}
