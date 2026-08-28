#!/usr/bin/env python3
"""Screen the tree for Emscripten-ragged immediate-mode batches.

    python3 web/tools/sweep-immediate-mode.py src

This is the script the M2 task-5 working notes called `sweep.py`, committed
verbatim (only this docstring is new) because it is the tool that produced the
site list in `docs/porting/browser-runtime-notes.md` section 10, and because
M5's inherited obligations require re-running it before any `-O` reaches
`CLIENT_LDFLAGS`. See section 10, "How to find these", for the three-step
method this implements step 2 of.

WHAT IT LOOKS FOR. Emscripten's `libglemu.js` derives ONE interleaved vertex
layout for a whole `glBegin`/`glEnd` block from the attribute calls it sees, so
every vertex in a block must emit the same attributes. A block that emits, say,
one colour per triangle instead of per vertex either aborts on `glEnd`'s
"`numVertices` must be an integer" assert or -- worse -- divides evenly by
accident and silently renders garbage. For every `Begin*()` ... `RenderEnd()`
region this counts the vertex, colour and texcoord emitters, INCLUDING the raw
`glColor*` / `glTexCoord*` / `glVertex*` forms (omitting those is the gap that
caused M2's misses), and prints a line for any region where the colour or
texcoord count is neither 0 nor equal to the vertex count, plus any region with
no `RenderEnd` within 120 lines.

HOW TO READ THE OUTPUT. Every line is a hit to inspect, not a verdict:

  * `RAGGED?` means the counts do not match, which for a block containing a
    loop, a macro, or a `/* */` comment is routinely a false alarm -- the
    counts are per source line, not per execution.
  * `NO RenderEnd within 120 lines` means the region was not closed textually.
    That is how shape (A), cross-batch contamination, shows up, but it is also
    what the `Begin*()` wrapper definitions in `rGLRender.cpp` look like.

The script's job is to make a MISS impossible, not to decide. Section 10
adjudicates the sites by name -- "Fixed", "Still latent", "Compiled out of this
build entirely" -- so the workflow is: run this, then find each hit in section
10. A hit that is not accounted for there is new and has to be read by hand,
and then reachability-checked in BOTH dimensions (does it compile at all, and
can an open batch reach it) before it is written down as anything.
"""
import re, sys, pathlib

BEGIN = re.compile(r'\bBegin(Quads|Triangles|Lines|LineStrip|LineLoop|QuadStrip|TriangleFan|TriangleStrip)\s*\(\s*\)')
END   = re.compile(r'\bRenderEnd\s*\(')
# vertex emitters, renderer-level and raw
VERT  = re.compile(r'\b(?:Vertex|Vertex3|glVertex[234][fisd]v?|RenderVertex)\s*\(')
TEXV  = re.compile(r'\bTexVertex\s*\(')
COL   = re.compile(r'\b(?:Color|glColor[34][fisd](?:v|ub)?)\s*\(')
TEX   = re.compile(r'\b(?:TexCoord|glTexCoord[234][fisd]v?)\s*\(')

roots = sys.argv[1:] or ['src']
files = []
for r in roots:
    files += sorted(pathlib.Path(r).rglob('*.cpp'))

for f in files:
    try:
        lines = f.read_text(errors='replace').splitlines()
    except Exception:
        continue
    for i, line in enumerate(lines):
        if line.lstrip().startswith('//') or not BEGIN.search(line):
            continue
        # walk forward to the closing RenderEnd (or 120 lines, whichever first)
        blk, j = [], i + 1
        while j < len(lines) and j < i + 120:
            if END.search(lines[j]):
                break
            blk.append((j, lines[j]))
            j += 1
        closed = j < len(lines) and j < i + 120 and END.search(lines[j])
        body = [(n, l) for n, l in blk if not l.lstrip().startswith('//')]
        nv = sum(len(VERT.findall(l)) for _, l in body)
        ntv = sum(len(TEXV.findall(l)) for _, l in body)
        nc = sum(len(COL.findall(l)) for _, l in body)
        nt = sum(len(TEX.findall(l)) for _, l in body)
        total_v = nv + ntv
        # texcoords contributed by TexVertex are implicit
        tex_eff = nt + ntv
        col_bad = nc not in (0, total_v)
        tex_bad = tex_eff not in (0, total_v)
        flag = 'RAGGED?' if (col_bad or tex_bad) else 'uniform'
        if flag == 'uniform' and closed:
            continue
        print(f'{flag:8} {f}:{i+1}  {BEGIN.search(line).group(0)}'
              f'  vertices={total_v} colours={nc} texcoords={tex_eff}'
              f'{"" if closed else "  *** NO RenderEnd within 120 lines ***"}')
