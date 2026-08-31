#!/usr/bin/env python3
"""Arbiter for M5 task 2 step 2: -O2 and ASSERTIONS are separable, and
ASSERTIONS is the half that matters.

    python3 docs/evidence/m5-o2-assertions/check-2x2.py

Exits 0 if every check passes, 1 otherwise. Reads only committed artefacts:
the four cell directories written by drive-browser.mjs, and the four .js
loaders in web/dist-m1 when they are present (the JS checks skip, loudly, if
the build tree has been cleaned -- and the self-guard at the end fails if
anything skipped, so a skip can never be mistaken for a pass).

STDLIB ONLY, deliberately. The rest of this repo's harness is zero-dependency
Node; a checker that needs `pip install pillow` is a checker that stops being
run. The PNG reader below handles exactly what Chrome DevTools
Page.captureScreenshot emits: 8-bit non-interlaced RGB/RGBA.

WHAT IS BEING MEASURED, AND WHY IT IS NOT A WHOLE-FRAME DIFF. The menu
background is a slowly drifting grid, and boot timing varies by tens of
milliseconds between runs, so two runs of the SAME build differ across most of
the frame by up to 14% of pixels. A whole-frame comparison here measures clock
skew, not rendering. What does not drift is the thing under test:
rViewportConfiguration::DemonstrateViewport draws its GL_LINE_LOOP as
AXIS-ALIGNED mid-grey (153,153,153) segments, while every background grid line
is rotated. Counting long axis-aligned runs in that one grey band isolates the
line loop from everything else on the screen.
"""
import os, re, sys, zlib, struct, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHOT = '08-VIEWPORTS-HIGHLIGHTED-THIS-IS-THE-CRASH-POINT.png'
ASSERT_MSG = '`numVertices` must be an integer'

CELLS = {                       # dir -> (page basename, bug?, assertions?)
    'cell-fix-assert-SHIPPED':  ('armagetronad',              False, True),
    'cell-bug-assert':          ('armagetronad-bug-assert',   True,  True),
    'cell-bug-noassert':        ('armagetronad-bug-noassert', True,  False),
    'cell-fix-noassert':        ('armagetronad-fix-noassert', False, False),
}

results = []
def check(name, ok, detail):
    results.append((name, bool(ok), detail))
    print(('  PASS ' if ok else '  FAIL ') + name.ljust(6) + ' ' + detail)

# ------------------------------------------------------------------ png
def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat, ihdr = 8, [], None
    while pos < len(d):
        ln, typ = struct.unpack('>I4s', d[pos:pos+8])
        body = d[pos+8:pos+8+ln]
        if typ == b'IHDR': ihdr = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT': idat.append(body)
        elif typ == b'IEND': break
        pos += 12 + ln
    w, h, depth, ctype, comp, filt, interlace = ihdr
    assert depth == 8 and interlace == 0 and ctype in (2, 6), (path, ihdr)
    nch = 3 if ctype == 2 else 4
    raw = zlib.decompress(b''.join(idat))
    stride, out, prev = w * nch, bytearray(), bytearray(w * nch)
    p = 0
    for _ in range(h):
        ft = raw[p]; line = bytearray(raw[p+1:p+1+stride]); p += 1 + stride
        if ft == 1:
            for i in range(nch, stride): line[i] = (line[i] + line[i-nch]) & 255
        elif ft == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                b = prev[i]; c = prev[i-nch] if i >= nch else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line; prev = line
    return w, h, nch, bytes(out)

def loop_segments(path, lo=140, hi=170, minrun=60):
    """Long axis-aligned runs of neutral grey in [lo,hi] -- the line loop."""
    w, h, nch, px = read_png(path)
    grey = bytearray(w * h)
    for i in range(w * h):
        r, g, b = px[i*nch], px[i*nch+1], px[i*nch+2]
        if r == g == b and lo <= r <= hi: grey[i] = 1
    segs = []
    def scan(get, outer, inner, tag):
        for o in range(outer):
            n = 0
            for j in range(inner):
                if get(o, j): n += 1
                else:
                    if n >= minrun: segs.append((tag, o, j-n, j-1, n))
                    n = 0
            if n >= minrun: segs.append((tag, o, inner-n, inner-1, n))
    scan(lambda x, y: grey[y*w + x], w, h, 'V')
    scan(lambda y, x: grey[y*w + x], h, w, 'H')
    return sum(s[4] for s in segs), segs

def shots(cell):
    return sorted(glob.glob(os.path.join(HERE, cell, '*.png')))

def transcript(cell):
    return open(os.path.join(HERE, cell, 'console.log'), encoding='utf8', errors='replace').read()

# ---------------------------------------------------- A. the loud half
print('\nA. section-10 bug + -O2 -sASSERTIONS=1  -- MUST abort')
t = transcript('cell-bug-assert')
check('A1', ASSERT_MSG in t, 'transcript carries the assert message')
check('A2', 'Aborted(' in t, 'transcript carries Aborted(')
# The stack must implicate glEnd, not merely contain an abort from anywhere.
frames = re.findall(r'^\[\s*\d+ms\]\s+(\S+) @ ', t, re.M)
i = frames.index('abort') if 'abort' in frames else -1
check('A3', i >= 0 and frames[i:i+4] == ['abort', 'assert', 'flush', '_emscripten_glEnd'],
      'stack is abort <- assert <- flush <- _emscripten_glEnd: ' + str(frames[i:i+4] if i >= 0 else None))
# After the abort the tab is dead: the remaining 13 shots stop changing.
after = [open(p, 'rb').read() for p in shots('cell-bug-assert')[7:]]
check('A4', len(set(after)) <= 3, f'{len(after)} shots from the crash point collapse to {len(set(after))} distinct images')

# -------------------------------------------------- B. the silent half
print('\nB. the SAME bug + bare -O2 -- MUST NOT abort, and MUST render wrong')
t = transcript('cell-bug-noassert')
check('B1', 'Aborted(' not in t, 'no Aborted( anywhere in the transcript')
check('B2', ASSERT_MSG not in t, 'no assert message anywhere in the transcript')
check('B3', '[EXCEPTION]' not in t, 'no uncaught exception')
sh = shots('cell-bug-noassert')
check('B4', len(sh) == 20 and len({open(p, 'rb').read() for p in sh}) == 20,
      f'{len(sh)} shots, {len({open(p,"rb").read() for p in sh})} distinct -- the tab kept running to the end')

print('\n   the line loop itself, counted rather than eyeballed:')
px = {}
for cell in CELLS:
    n, segs = loop_segments(os.path.join(HERE, cell, SHOT))
    px[cell] = (n, segs)
    print(f'     {cell:<26} {n:>4} px  {segs}')
check('B5', px['cell-fix-assert-SHIPPED'][0] > 400,
      f"SHIPPED build draws the loop ({px['cell-fix-assert-SHIPPED'][0]} px in "
      f"{len(px['cell-fix-assert-SHIPPED'][1])} axis-aligned segments)")
check('B6', px['cell-bug-noassert'][0] == 0,
      'bug + bare -O2 draws NO line loop at all -- silent wrong geometry, exactly failure mode 2')

# --------------------------------------- C. attribution: the 4th cell
print('\nC. the control that makes B6 attributable to the DEFECT')
check('C1', px['cell-fix-noassert'][0] == px['cell-fix-assert-SHIPPED'][0]
        and px['cell-fix-noassert'][1] == px['cell-fix-assert-SHIPPED'][1],
      'fixed objects at bare -O2 draw the SAME loop, pixel for pixel -- so dropping '
      'ASSERTIONS does not by itself change rendering')
t = transcript('cell-fix-noassert')
check('C2', 'Aborted(' not in t and '[EXCEPTION]' not in t, 'and it does not abort either')

# ------------------------------------- D. the shipped build still passes
print('\nD. the SHIPPED build (fix + -O2 -sASSERTIONS=1) on task 1\'s gate')
t = transcript('cell-fix-assert-SHIPPED')
sh = shots('cell-fix-assert-SHIPPED')
check('D1', len(sh) == 20 and len({open(p, 'rb').read() for p in sh}) == 20, f'{len(sh)} shots, all distinct')
check('D2', 'Aborted(' not in t and ASSERT_MSG not in t and '[EXCEPTION]' not in t, 'no abort, no assert, no exception')
check('D3', 'alive, gl err=0x0' in t, 'glGetError at the crash point reads 0x0')
check('D4', 'still alive, canvas 1024x768' in t, 'still running at the end of the route')
bad404 = [l for l in t.splitlines() if '404' in l and 'favicon' not in l]
check('D5', not bad404, f'no non-favicon 404 ({len(bad404)} found)')

# ------------------------- E. the static half: what -O2 does to the glue
print('\nE. static: the assert is present/absent in the glue exactly as claimed')
skipped = []
for cell, (page, bug, assertions) in CELLS.items():
    p = os.path.join(ROOT, 'web/dist-m1', page + '.js')
    if not os.path.exists(p):
        skipped.append(page); print(f'  SKIP  E-{page}: {p} absent (build tree cleaned?)'); continue
    has = ASSERT_MSG in open(p, encoding='utf8', errors='replace').read()
    check('E-' + page[:20], has == assertions,
          f'assert message {"present" if has else "absent"}, ASSERTIONS={"1" if assertions else "0"}')

# ------------------------------------------------------- Z. self-guard
print('\nZ. self-guard')
names = {n for n, _, _ in results}
expect = {'A1','A2','A3','A4','B1','B2','B3','B4','B5','B6','C1','C2','D1','D2','D3','D4','D5'}
check('Z1', expect <= names, f'all {len(expect)} browser-evidence checks actually ran')
check('Z2', not skipped, 'no static check was skipped' + (f' (skipped: {skipped})' if skipped else ''))

failed = [n for n, ok, _ in results if not ok]
print(f'\n{len(results)-len(failed)}/{len(results)} passed' + (f'; FAILED: {failed}' if failed else ''))
sys.exit(1 if failed else 0)
