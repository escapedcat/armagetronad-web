# M5 task 2 step 3 — every existing gate, re-run in a browser against the `-O2` build

`-O2` at link changes codegen and minifies the JS glue and the shell page, so a
committed transcript proves nothing about this build. **Every gate below was
re-driven in a real browser.** Nothing here is inherited.

Chrome 152 headed (`--headed` is required for anything that presses a key — see
`web/tools/drive-browser.mjs`), Firefox 154 headless, both against
`python3 -m http.server 8000 --directory web/dist-m1`.

| gate | steps | arbiter | Chrome | Firefox |
|---|---|---|---|---|
| M5 task 1 viewport | `viewport-menu-gate.steps` | shot/transcript checks in `../check-2x2.py` (cell D) | **PASS** | **PASS** |
| M2 gameplay | `gameplay-gate.steps` | `m2-gate/check-transcript.mjs` | **PASS** | **PASS** |
| M3 audio | `audio-gate.steps` | `m3-audio/check-audio-transcript.mjs` | **PASS** 25/25 | **PASS** 25/25 |
| M4 persist | `persist-gate.steps` | `m4-persist/check-persist-transcript.mjs` | **FAIL — P11** | **FAIL — P11** |
| M4 persist-settings | `persist-settings-gate.steps` | `m4-persist-settings/check-settings-transcript.mjs` | **PASS** 17/17 | **PASS** 17/17 |
| M4 config-precedence | `maxfps-precedence.steps` | `m4-config-precedence/check-maxfps-transcript.mjs --expect real` | **PASS** | **PASS** |
| M4 persistence milestone | `persistence-milestone-gate.steps` | `m4-persistence/check-milestone-transcript.mjs` | **PASS** 21/21 | **PASS** 21/21 |

M2's frame rate on the optimised build: **median 60 fps, minimum 49** over
39.56 s / 2363 frames against the ≥30 bar, 0 GL errors in 126 `glGetError`
polls, 3 rounds against 3 AIs. (M2 recorded 60/53; the minimum is a per-run
figure, and 49 is not a regression claim.)

---

# The one failure: `m4-persist` P11 — pre-existing, and NOT caused by `-O2`

```
PASS  P10  boot 2 read user.cfg back at the SAME byte count (21950 -> 21950)
FAIL  P11  boot 2 read user.cfg back with the SAME content hash (a579ed3e -> 12176ddd)
```

## It is not `-O2`. Proved with a byte-identical control build.

`p11/` holds four runs: two builds × two runs each, same script, same machine,
minutes apart.

| build | wasm | run 1 | run 2 |
|---|---|---|---|
| `armagetronad-noO` — the link line with `-O2 -sASSERTIONS=1` removed | 8,879,522 / `f99c2be7abbdaffb47bafb6c02e0d9e5` | **FAIL P11** | **FAIL P11** |
| `armagetronad` — as shipped | 4,331,138 / `ece6e0fd…` | **FAIL P11** | **FAIL P11** |

The control is not "similar to" the pre-task-2 client: relinking the same
objects with those two flags removed reproduces **the exact wasm M5 task 1 left
behind, byte for byte** — same size, same md5. So the only variable between the
two rows is the two link flags, and the failure does not move with them.

## What actually differs, and why P10 passes while P11 fails

Instrumented directly rather than inferred: boot 1 stashes `user.cfg` in
`localStorage`, boot 2 diffs against it line by line. **All four runs, both
builds, gave the identical answer — 3 lines out of 527:**

```
184:  FLOOR_DETAIL 2  ->  FLOOR_DETAIL 3
489:  SWAP_MODE    1  ->  SWAP_MODE    2
503:  TEXT_OUT     0  ->  TEXT_OUT     1
```

Three single-digit changes, which is exactly why the byte count is unchanged and
only the hash moves.

Those three are not arbitrary. They are precisely the three assignments
`sr_LoadDefaultConfig()` (`src/render/rScreen.cpp`) makes to variables whose
*static* initialisers hold the lower value:

| item | static initialiser | `sr_LoadDefaultConfig()` sets |
|---|---|---|
| `sr_floorDetail` | `rFLOOR_TEXTURE` = **2** | `rFLOOR_TWOTEXTURE` = **3** |
| `rSysDep::swapMode_` | `rSwap_glFlush` = **1** (`rSysdep.cpp`) | `rSwap_glFinish` = **2** |
| `sr_textOut` | `false` = **0** | `true` = **1** |

So boot 1's `user.cfg` was written **before** the renderer defaults were applied
and boot 2's **after**. Two different writers, two different moments.

## Why the gate was green at M4 and is red now — the second writer arrived later

`m4-persist` is **M4 task 1**. When its evidence was recorded the only thing
that ever wrote `user.cfg` was the game's own save at boot, so "the file boot 2
reads is the file boot 1 wrote" was true by construction and P11 was a fair
check.

**M4 task 2 then added a second writer** — the `beforeunload` backstop in
`web/shell.html` — and nobody re-ran task 1's gate afterwards. Boot 2 now
legitimately reads a *newer* file than the one boot 1's snapshot captured.

Checkable in one command, and this is the load-bearing observation:

```sh
grep -c "PERSISTSAVE\|backstop\|beforeunload" docs/evidence/m4-persist/chrome-console.log   # -> 0
grep -o "\[PERSISTSAVE\][^\"]*" docs/evidence/m5-o2-assertions/p11/O2-shipped-2/console.log # -> [PERSISTSAVE] js-backstop n=1
```

The committed M4 transcript contains **no** backstop save at all. Today's
contains one. The gate did not rot and the checker is not wrong — its premise
stopped holding one task after it was written.

Boot timing is not the explanation and was checked: the boot-1 snapshot lands at
7,747 ms in the committed M4 run and 7,537 ms today.

## Not a product defect

The divergence converges *upward*: the later write carries the higher-detail
values, so the settings the player ends up with are the ones
`sr_LoadDefaultConfig()` intends. Nothing is lost across a reload — P10, P12,
P13 and the whole M4 persistence-milestone gate (21/21, both engines) still
pass.

## Deliberately not fixed here

P11 is detecting something real. Loosening it to compare "the last file written"
instead would make it green, and would also be a change to an M4 gate made by
the task whose build it is failing — which is the wrong shape. The fix belongs
with whoever owns the persistence gates, with its own evidence. **Task 2's claim
is only that `-O2` did not cause this, and that claim is measured above.**

## Re-run

```sh
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --url http://localhost:8000/armagetronad-noO.html \
     --out /tmp/p11 --script-file <persist-gate.steps + the two-line localStorage diff>
node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/p11/console.log
```

The instrumented steps file is `p11/persist-diff.steps` — `persist-gate.steps`
with exactly two `eval:` lines inserted (stash in boot 1, diff in boot 2) and
nothing else changed.

---

## What is in these directories

Every run keeps its full `console.log` (the transcript every arbiter above
actually reads), its `checker.txt` (the arbiter's verdict as run) and
`driver.txt`. `gates.asrun` is the whole suite's console output.

**Screenshots are sampled, not complete, for the M2/M3/M4 re-runs** — four
evenly-spaced frames per run instead of all of them. Those six arbiters are
transcript-only; the frames are here so a reader can see the game really drew
something (§ 10's other failure mode is silent, so "the checker passed" is not
by itself proof that the screen was right), not because anything parses them.
The full 13 MB of frames was not worth committing to make that point.

**`viewport-firefox/` keeps all 20** — that gate's claim *is* the frames, and
`check-2x2.py` counts pixels in one of them. Its Chrome counterpart is not
duplicated here: it is `../cell-fix-assert-SHIPPED/`, the shipped cell of the
2×2, driven with this same steps file.

Firefox on the viewport route: 20 shots, **20 distinct**, 0 `Aborted(`, 0
`numVertices`, 0 `[EXCEPTION]`, `glGetError` `0x0`, `still alive, canvas
1024x768`.
