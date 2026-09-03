# M5 Task 6 — the exit, and Phase 1's close

> Mirrored out of `.superpowers/sdd/2026-08-30-m5-launch/task-6-report.md`, which is
> gitignored (`.gitignore` line 137) and would otherwise have stranded this report on
> disk with the claim not re-derivable — the same defect M5 task 1 hit and its
> controller fixed. `docs/evidence/m5-texture/REPORT.md` set the precedent.

**Status: COMPLETE.** Branch `m5-exit`, BASE `dfaecdc8`. Four commits, not merged,
no PR. The Demo is live and the published set is now clean.

| sha | what |
|---|---|
| `d38a1f78` | the deploy asserts its own published set; W7's clean-rebuild defect fixed |
| `ff2ff9ca` | `PLAN.md`: Phase 1 closed, annotated where M5 disproved it |
| `dd42ce68` | the M5 plan annotated, plus what the exit itself found |
| `39378ded` | the exit's evidence, and three stale claims in the front-page docs |

**One-line verification:** clean rebuild of both targets → dedicated **2,488,298 B
and md5 `9718a2a64978cb6e9b95ea2f0454cca5`**; `sh web/tools/live-gate.sh` **5/5
PASS, exit 0** against the public URL in real Chrome 152 and real Firefox 155;
both provers green (53/53 and 9/9); and **all five published files reproduce
byte-identically from that rebuild**.

---

## Step 1 — verified from a clean rebuild

`rm -rf web/build-m0 web/dist-m0 web/build-m1 web/dist-m1`, then `dedicated -j8`
and `client -j8`, both exit 0.

**Invariant: 2,488,298 bytes AND md5 `9718a2a64978cb6e9b95ea2f0454cca5`.** Both
halves, rebuilt rather than read off an artefact that was already there — which is
the plan's own warning, and it mattered: `web/dist-m0` had been deleted first.

**A result this project has never been able to state before — the deployment is
reproducible.** All five published files come back byte-identical from that
rebuild, compared per file against the `origin/gh-pages` blobs:

| file | md5 | |
|---|---|---|
| `armagetronad.wasm` | `6f835c849bbef4c77896030394cda7a5` | identical |
| `armagetronad.js` | `65a49a216a58cc05c9c0c6622e677033` | identical |
| `armagetronad.data` | `59d5aeadf06cc5ca956551250bd740c3` | identical |
| `armagetronad.html` | `c4384f76efc244155b513bdaabbc3b6d` | identical |
| `index.html` | `17e8535ca4170b561d2ba7813ef3ada8` | identical |

`PLAN.md` recorded that `armagetronad.js` is not byte-reproducible; `-O2` changed
that, and this is the first exit that could check it. `git diff` over `src/`,
`web/Makefile`, `web/shell.html`, `web/webdefaults/`, `config/` and every preloaded
data directory from the rebuild commit to HEAD is **empty**, so the claim still
holds at HEAD by construction as well as by measurement.

### Which gates I re-ran in a browser, and which I checked from committed transcripts

Full record: `docs/evidence/m5-exit/gates.asrun`.

**In a browser, against the public URL** — `sh web/tools/live-gate.sh`, 5/5 PASS,
exit 0:

| row | result | detail |
|---|---|---|
| wire facts | PASS | W1–W13 + WZ; 13 declared, 13 executed |
| gameplay chrome | PASS | M2's gate unmodified; 3/3 rounds, 3 AIs; **60 median / 58 min** fps |
| gameplay firefox | PASS | same; **59 / 57** fps |
| multiplayer chrome | PASS | X1–X11 + XZ |
| multiplayer firefox | PASS | X1–X11 + XZ |

Chrome 152.0.7977.75 headed; **Firefox 155.0** — one major version newer than the
154 this milestone was built against, passing with no change, which is the only
evidence this port has that it is not pinned to one browser build.

**From committed transcripts** (checker exit status only, no browser): M2 ×2, M3
×2 plus its negative control (exit 1, expected), `m4-persistence` ×2 plus its
negative (exit 1, expected), `m4-persist-settings` ×2, `m4-config-precedence` ×2,
`m4-persist` ×2. Both provers were re-run for real:
`prove-live-checks-can-fail.mjs` **53/53**, `prove-publish-set-check-can-fail.sh`
**9/9**.

**One gate is red and it is the known one.** See "corrections" below — running
*both* its transcripts said something sharper than the dispatch had.

## Step 2 — what shipped

**The Demo is publicly reachable and playable, in desktop Chrome and Firefox, on
one maintainer's machine.** That is the whole claim; it is written that way in
`PLAN.md`, `README.md` and `CONTEXT.md`, each with an explicit warning against
reading "Phase 1 complete" as "done".

Measured against the deployment: **1,748,947 B = 1.668 MiB** on a first visit for
the four game files (5,380,255 B unpacked), **8.6× under** the 15 MB budget; 3/3
rounds in both engines. **The frame rate is stated as a range, not as a number** —
see corrections.

## Step 3 — `PLAN.md` and the M5 plan annotated, inline, nothing deleted

`PLAN.md`: the Hosting row (the deploy recipe published a site with no entry point
and exited 0), the Main loop row (the yield's placement is a visible-quality
decision), M1's `shell.html` line (the Play button's audio reason did not hold),
M2-inherited item 5 (the camera was two bugs), M4-inherited item 5 (the HUD
flicker was neither suspected cause, and the long stretches are open), M4's "not
done" pair (fullscreen half done, touch note never built), and Verification items
5 and 6. The `-O`/ASSERTIONS ban, `rViewport`'s "latent", brotli, the
`-fexceptions` figure and JSPI were already annotated by earlier M5 tasks and are
now also collected in one place in the new M5 exit block.

The M5 plan: its "no new subsystems" architecture line, recon 3 (1.63 MiB is a
local number the Demo does not serve), recon 8 (wrong twice — the 10.2 MB is
pre-`-O2`, and the recipe shipped no entry point), recon 9 (settled: the edge does
gzip 4.33 MB), task 2b step 4 and task 5 step 2, plus a new section recording what
the exit itself found.

## Step 4 — Phase 1 closed honestly

New `## Phase 1 — closed` section in `PLAN.md`: a clause-by-clause table of what is
**met**, then **twelve** open items ordered by who is hurt. Every item the dispatch
named is there and none of them reads as met — the touch note, the 20 s black
canvas, the dead *Window Size* row, `f` not reaching the handler, the three ~1.5 s
HUD stretches (explicitly "open, not resolved", with the maintainer's answer
recorded as outstanding), P11, the published-set problem, anisotropy as offered and
undecided, the deferred mouse binds, the steps files, and the two broken
generators. Two more I added: native demo playback was never run, and **nobody has
played this for fun**.

## Step 5 — Phase 2/3 inheritance

Ten items in `PLAN.md`'s Future work. The load-bearing one: **Pages is HTTPS-only,
so every `ws://` is blocked as mixed content — the bridge must be `wss://` with a
real certificate on day one**, not at M-C where the plan files TLS. Also: the
single-player no-sockets property (stated as the absence it is), the one-UDP-socket
demux design surviving five milestones, the master query's measured shape as a
timing budget, the Firefox `*.github.io` block any remote measurement will hit, and
that JSPI is not an escape from Asyncify's reentrancy rules.

## Step 6 — the published set

**Cleaned by construction, not by deletion.** The clean rebuild left `web/dist-m1`
holding exactly the four build outputs, so there was nothing to remove; `npm run
deploy` added `index.html` and published five files.

**Before:** 23 entries, 16,185,514 B. **After:** 6 entries, 5,382,608 B. **17
entries and 10,802,906 B removed**, and all 17 fetched back by name as **404**.

```
      0  .nojekyll
 687094  armagetronad.data
   4395  armagetronad.html
 357282  armagetronad.js
4331484  armagetronad.wasm
   2353  index.html
```

`gh-pages` tip `60433d16`, "Deploy dd42ce68". Enumerated with
`git ls-tree -r -l origin/gh-pages`, which is the only way to see it — Pages serves
no directory index.

**The deploy now asserts its own published set.** `web/tools/check-publish-set.mjs`
runs between the `cp` and `npx gh-pages`, asserts **set equality** against a
declared release list, and exits 1 on a stray *or* a missing file, so a bad set
stops locally instead of being force-pushed. **Proven capable of failing**:
`web/tools/prove-publish-set-check-can-fail.sh`, **9 cases, all as declared** — a
clean set passes; a stray probe build fails; a stray generated page fails; **a
stray one directory down** fails; **a stray dotfile** fails (both of those are
inside gh-pages' own `-v "{**/*,**/.*}"` pattern, so both would ship); a missing
`index.html` fails; a missing `armagetronad.wasm` fails; a stray and a missing
together are both named; and a nonexistent directory is exit 2 rather than a silent
pass.

`sh web/tools/live-gate.sh` re-run after the redeploy: **5/5 PASS, exit 0.**

---

## Where the dispatch was wrong, with the measurement

1. **"Confirm the gates still pass" could not be done as written.** From a clean
   rebuild the live gate **fails W7** on `index.html` — and it is the gate's defect,
   not the deployment's. `wire-facts.sh` looked for every local file in `$DIST`, but
   `index.html` is not a build output: nothing in `web/Makefile` emits it, and it
   only reaches `dist-m1` via the `cp` at the front of `npm run deploy`. W7 was
   asserting on **a side effect of the last deploy**. Fixed to fall back to
   `web/index.html` and to report which path it compared in a new `local_path` field.
2. **The cleanup was 22 files in `dist-m1`, not 17.** The dispatch's "remove the 17
   unintended files … plus the five the texture work added" reads as 17 total; 17 is
   the count of unintended entries **on the published branch**, and `dist-m1` held
   **22** strays (the same 17 plus the texture work's five). Moot in the end — the
   clean rebuild removed all of them — but the two numbers are different things.
3. **"3/3 rounds at 60 fps median in both engines" is not reproducible as a
   number.** Three runs of the same script, same build, same URL: Chrome **60 / 60 /
   60**, Firefox **60 / 57 / 59**. Chrome's median was 60 every time; Firefox's moved
   across three values. Both clear the ≥30 bar roughly twice over. "60 fps" is not a
   property of this port and is no longer written as one.
4. **"`m4-persist` P11 is red" understates it.** Running *both* committed
   transcripts rather than one: `chrome-console.log` was re-recorded at M5 task 5
   (`d7214876`), carries 1 `[PERSISTBACKSTOP]` and 2 `autostart` lines, and fails
   exactly P11; `firefox-console.log` is untouched since M4 task 1 (`e3c93e72`), has
   0 of each, and **passes**. The pair is internally inconsistent and the Firefox
   half passes *only because it is older than the build* — it certifies a page that
   still has a Play button. So the decision is not "re-run it": re-scope P11,
   re-record both and accept red until it is, or delete it as superseded by
   `m4-persist-settings` (same property, control build, green on both engines).
5. **"Nine gate steps files"** — eight now. `https-multiplayer.steps` has since been
   driven live in both engines by the live gate. Counted by name from task 5's own
   list minus the one since exercised.

## My own errors, caught and recorded

- **Commit `ff2ff9ca`'s subject says "the eight places M5 disproved it".** The block
  it added enumerates **ten**, and "places `PLAN.md` itself was wrong and this exit
  corrected inline" is **seven** (items 1 and 2 were annotated by earlier M5 tasks;
  item 10 is a process finding). The message is immutable; the correction is written
  into `PLAN.md` beside the list, with the basis stated.
- **I drafted a claim that the gameplay gate's "in-page WebSocket counter reads 0".
  It installs no counter** — that belongs to `https-multiplayer.steps`. Rewritten as
  the absence it is: `ws://` and `websocket` appear 0 times in both live gameplay
  transcripts while the same driver in the same session produced 98 and 97 such
  lines on the multiplayer route.
- **I edited `web/tools/live-gate.sh` while a run of it was in flight**, which made
  that run exit 1 with a nonsense error about a file on a line it should never have
  reached — the shell reads scripts incrementally by byte offset. Every check in it
  had passed. Recorded in the plan so the next person does not read such an exit
  status as evidence.

## Concerns

1. **P11 needs a human decision** (correction 4). It is the only red gate and it has
   now been red across two milestones.
2. **The three ~1.5 s HUD stretches are unanswered, not fixed.** The maintainer was
   asked whether the flicker they saw was the long kind or the short kind and has not
   replied. Everything is written so that this reads as open.
3. **A phone visitor still gets a canvas they cannot play and no explanation.** It is
   the cheapest open item in the project and the only one that harms someone who did
   nothing wrong.
4. **Anisotropy is still undecided** and needs a yes or no, not more measurement.
5. **Every Firefox number in this project came through a CONNECT proxy**, because
   Firefox on this machine cannot reach any `*.github.io` host. Chrome and `curl` are
   what carry "this deployment is reachable".
6. **The live-gate screenshots were trimmed** from 72 PNGs / 16 MB to two frames. The
   trim was verified — all five checkers re-run against the kept transcripts still
   exit 0 — but if anyone wants the full frame set they must re-run the gate.
7. **`check-publish-set.mjs` checks names, never contents.** A stale build with the
   right names passes it. `check-wire-facts.mjs` W7 is the content check and it runs
   against the deployment afterwards, so the pair covers it — but neither alone does.
