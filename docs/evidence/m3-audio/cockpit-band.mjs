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
// THE THRESHOLD, AND HOW IT WAS SET. Scored over all 30 driving frames in
// docs/evidence/m2-gate/ and docs/evidence/m3-audio/, the two classes do not
// overlap and are nowhere near each other:
//
//   no cockpit   0 (x3), 110, 1242 (x9)                    highest: 1242
//   cockpit      2228 2229 2233 2271 2288 2299 2302 2326
//                2365 2380 2690 3536 3542 3549 3632 3641
//                3669                                       lowest: 2228
//
// One threshold at 1800 therefore serves BOTH engines, with 45% headroom over
// the highest negative and 19% under the lowest positive. An earlier revision
// of this comment said "Chrome >= 2300, Firefox >= 2200" and was falsified by
// its own table: M2's committed chrome-12 (2299), chrome-13 (2288) and
// chrome-14 (2271) all have the cockpit and all sit under 2300. The rule had
// been placed one point above one of the two frames it was eye-anchored on.
// Changing it to 1800 reclassifies NOTHING -- every frame keeps the label it
// already had.
//
// The two engines' negatives differ (Chrome's camera leaves 1242 pixels of grid
// in the band, Firefox's leaves 0-110) but that only widens the margin, so the
// per-engine split the earlier revision used bought nothing.
//
// EYE ANCHORS, both ends, both engines -- because a threshold nobody looked
// through is just a number:
//   cockpit      m2-rerun/chrome-run3-round1-cockpit.png     2365
//                m2-gate/chrome-12-round3-...png             2299
//                m2-rerun/firefox-round1-cockpit.png         2302
//   no cockpit   m2-rerun/chrome-run1-round1-NO-cockpit.png  1242
//                m3-audio/chrome-05-round3-driving.png       1242
//                m2-rerun/firefox-round3-NO-cockpit.png         0
// It also agrees with M2's own prose about M2's own evidence, which says
// firefox-04 has no cockpit in it: this scores that frame 0.
//
// WHAT IT IS NOT CALIBRATED FOR. All 30 frames come from one machine at
// 1024x768 with Chrome 152 and Firefox 154. The band is a fixed 110 rows and
// the count is an absolute pixel total, so BOTH scale with resolution: at a
// different canvas size these numbers mean nothing and the threshold has to be
// re-anchored by eye. It will print a confident verdict anyway -- it has no way
// to know -- so check the frame size before believing it on frames from
// anywhere but docs/evidence/.
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
const THRESHOLD = 1800;
let bad = 0;
for (const f of process.argv.slice(2)) {
  const { w, h, bpp, stride, out } = decode(f);
  let bright = 0;
  for (let y = h - 110; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp;
      if (out[i] + out[i + 1] + out[i + 2] > 330) bright++;
    }
  // The verdict is printed, not left to the reader, so the rule cannot go stale
  // separately from the numbers the way the 2300 one did. A filename claiming
  // the opposite of the score is flagged rather than quietly disagreed with:
  // the frames in this directory carry their label in their name, which makes
  // that a free consistency check on the evidence.
  const verdict = bright >= THRESHOLD ? 'cockpit' : 'no cockpit';
  const claimed = /NO-cockpit/.test(f) ? 'no cockpit'
                : /cockpit/.test(f)    ? 'cockpit' : null;
  const clash = claimed && claimed !== verdict ? '   <- DISAGREES WITH FILENAME' : '';
  console.log(`${String(bright).padStart(6)}  ${verdict.padEnd(10)}  `
            + `${f.split('/').slice(-2).join('/')}${clash}`);
  if (clash) bad++;
}
process.exit(bad === 0 ? 0 : 1);
