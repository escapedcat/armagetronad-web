# M5 task 2 — `-O2` and `ASSERTIONS` are separable, and `ASSERTIONS` is the half that matters

From M2 to M4 this port banned `-O` at link. `PLAN.md` ("Inherited from M2",
item 1) and `docs/porting/browser-runtime-notes.md` § 10 both give the same
reason: `ASSERTIONS` is on only because there is no `-O`, and `ASSERTIONS` is
the only thing that makes § 10's defect class — *one `glBegin`/`glEnd` block
gets one vertex format* — announce itself instead of drawing silent garbage.

**The ban was really a ban on losing `ASSERTIONS`.** `-O2 -sASSERTIONS=1` keeps
the assert and takes the size win. That claim is not argued here; it is fired.

## The 2×2

|  | `-O2 -sASSERTIONS=1` | bare `-O2` |
|---|---|---|
| **§ 10 bug present** | `cell-bug-assert` — **aborts** | `cell-bug-noassert` — **no abort, renders wrong** |
| **bug absent** (M5 task 1's fix) | `cell-fix-assert-SHIPPED` — clean, **this is what ships** | `cell-fix-noassert` — clean |

All four cells are real links of the same 102 objects, driven through the
identical script (`web/tools/viewport-menu-gate.steps`, task 1's committed
gate) in Chrome 152 headed against `python3 -m http.server 8000 --directory
web/dist-m1`.

**The bottom-right cell is the point of the table, not padding.** Without it,
"bug + bare `-O2` renders wrong" could be blamed on `-O2` itself or on
`ASSERTIONS=0`. With it, the only cell that misrenders is the one where the
defect and the missing assert coincide.

## What was measured

**Top-left — it still aborts.** Same message, same route, same stack as the
pre-task-1 build:

```
[  41094ms] [console.error] Assertion failed: `numVertices` must be an integer.
[  41095ms] [console.error] Aborted(Assertion failed: `numVertices` must be an integer.)
[  41096ms] [EXCEPTION] structured stack, 57 frames:
                abort @ …/armagetronad-bug-assert.js
                assert @ …
                flush @ …
                _emscripten_glEnd @ …
```

Thirteen screenshots from the crash point on collapse to **2** distinct images:
the tab is dead and stays dead.

**Top-right — it does not abort, and it draws the wrong thing.** Zero
`Aborted(`, zero `numVertices`, zero `[EXCEPTION]`, 20/20 distinct screenshots,
`glGetError` `0x0`, `still alive, canvas 1024x768` at the end of the route. And
the viewport panel's border is **gone**:

| cell | axis-aligned grey line-loop pixels in shot 08 |
|---|---|
| `cell-fix-assert-SHIPPED` | **716** — `V x=971 y423–729 (307 px)`, `H y=423 x563–971 (409 px)` |
| `cell-fix-noassert` | **716** — the same two segments, pixel for pixel |
| `cell-bug-noassert` | **0** |
| `cell-bug-assert` | **0** (it aborted mid-frame) |

Open `cell-fix-assert-SHIPPED/08-*.png` and `cell-bug-noassert/08-*.png` side by
side: the blue demo panel is there in both, and the grey rectangle that
`DemonstrateViewport`'s `GL_LINE_LOOP` draws around it is there in one of them.
Nothing in the console says so. That is § 10 failure mode 2, produced on demand.

### Why the border count and not a whole-frame diff

Because a whole-frame diff here measures the clock, not the rendering. The menu
background is a slowly drifting grid and boot timing varies by tens of
milliseconds between runs, so **two runs of the same build differ across up to
14% of the frame**. Measured, not assumed: `cell-fix-noassert` vs
`cell-fix-assert-SHIPPED` — which render identically — differ by 0 px on shot
01 and 82,268 px (10.5%) on shot 19.

What does not drift is the thing under test. `DemonstrateViewport` draws its
loop as **axis-aligned** mid-grey `(153,153,153)`; every background grid line is
rotated. Counting long axis-aligned runs in that one grey band isolates the loop
from everything else on screen, which is why the two clean cells agree to the
pixel while the buggy one reads zero.

## Which site, and why

`rViewportConfiguration::DemonstrateViewport`, **deliberately reintroduced**.

M5 recon fired the assert on this site; M5 task 1 then fixed it. It is not
merely the convenient choice, it is the only available one: the § 10 sweep
prints **18** regions and § 10 adjudicates every one of them as `uniform`,
safe-by-reachability, or compiled out of this build. None can be made to fire
without inventing a new defect, and an invented defect would prove less than the
one that actually shipped.

The reintroduction never touches the working tree. `build-assertion-proof.sh`
takes `git show ef342734^:src/render/rViewport.cpp` — literally the file one
commit before the fix — writes it under the object dir, and compiles it with the
**same** `CLIENT_CXXFLAGS`, source basename held constant. The link line is
taken verbatim from `make -n` and the bugged object is **substituted at its own
position**, never appended: task 1 measured that appending one object moves the
dedicated output by 8 bytes and changes its md5 completely, so substitution is
the only comparison that holds everything else fixed.

## The static half

`ASSERTIONS` is observable in the artefact, not just in the flag list. In the
assertions builds `flush()` reads

```js
var numVertices=4*GLImmediate.vertexCounter/GLImmediate.stride;
if(!numVertices)return;
assert(numVertices%1==0,"`numVertices` must be an integer.");
```

and in the bare-`-O2` builds the same function goes straight from
`if(!numVertices)return;` to the next statement. Same function, same variable,
assertion gone.

## Re-run it

```sh
source deps/emsdk/emsdk_env.sh
make -f web/Makefile client -j8
sh   docs/evidence/m5-o2-assertions/build-assertion-proof.sh

python3 -m http.server 8000 --directory web/dist-m1 &
for p in armagetronad armagetronad-bug-assert armagetronad-bug-noassert armagetronad-fix-noassert; do
  node web/tools/drive-browser.mjs --headed --url "http://localhost:8000/$p.html" \
       --out docs/evidence/m5-o2-assertions/CELL --script-file web/tools/viewport-menu-gate.steps
done
kill %1

python3 docs/evidence/m5-o2-assertions/check-2x2.py          # 23 checks, exit 0
python3 docs/evidence/m5-o2-assertions/prove-2x2-can-fail.py # 20 mutations, exit 0
```

`check-2x2.py` is stdlib-only — it carries its own PNG reader rather than
needing `pip install pillow`, because a checker with an install step is a
checker that stops being run. `prove-2x2-can-fail.py` applies one targeted
mutation per check to a throwaway copy and requires the set of checks that flip
to be **exactly** the set the mutation declares. Mutation 0 is the unmutated
control and must flip nothing; without it, a checker that failed everything
unconditionally would score 20/20.

Transcripts of both, as run: `check-2x2.asrun`, `prove-2x2-can-fail.asrun`.

## What is NOT claimed

- **Not that the 18 remaining sweep sites are safe.** This proves the *detector*
  survives `-O2`; § 10 is still where the adjudication of each site lives.
- **Not that `-O2` is optimal.** M5 recon measured `-O2`/`-O3`/`-Os`/`-Oz`
  within 10,728 bytes on the wire (0.9%), with the raw-size ordering inverting
  under gzip. `-O2` is emcc's default and was taken as such.
- **Not a Firefox result.** These four cells are Chrome only. The engine is
  irrelevant to the claim — the assert lives in Emscripten's JS glue, not in the
  browser — and Firefox coverage of this same route is in `gates/`.
- **`cell-bug-assert`'s final probe still prints `still alive, canvas 1024x768`.**
  That is the DOM canvas, which survives a wasm abort. Liveness of the *runtime*
  is what the screenshot collapse (13 → 2) shows; do not read that probe as one.
