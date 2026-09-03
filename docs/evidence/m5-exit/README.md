# M5 exit — Phase 1's close

What this directory holds, and what each file is entitled to claim.

| file | what it is |
|---|---|
| `REPORT.md` | the task's own report, mirrored out of the gitignored `.superpowers/` tree |
| `gates.asrun` | every gate re-run at the exit, split into **browser-verified** and **checked from committed transcripts** — with the one red gate named and diagnosed |
| `published-set.asrun` | the `gh-pages` tree before and after the cleanup, with the derivation of every number |
| `prove-publish-set-check-can-fail.asrun` | the 9-case prover for the new deploy assertion |
| `live-gate/` | the live-gate run against the public URL: the four console transcripts, the four driver logs, `wire-facts.json`, `summary.txt`, and two representative frames |

**The screenshots were trimmed on purpose, and the trim was verified.** The run
produced 72 PNGs and 16 MB; two frames are kept and the rest deleted, because
`docs/evidence/m2-gate/` and `docs/evidence/m5-camera/` already hold curated
frames and M5 has twice been caught leaving 16 MB of duplicate run artefacts in
the tree. What matters here is the transcripts, since **the checkers re-derive
every claim from a transcript alone**. All five were re-run after the trim and
still exit 0:

```sh
node docs/evidence/m2-gate/check-transcript.mjs        docs/evidence/m5-exit/live-gate/play-chrome/console.log
node docs/evidence/m2-gate/check-transcript.mjs        docs/evidence/m5-exit/live-gate/play-firefox/console.log
node docs/evidence/m5-launch/check-live-multiplayer.mjs docs/evidence/m5-exit/live-gate/mp-chrome/console.log
node docs/evidence/m5-launch/check-live-multiplayer.mjs docs/evidence/m5-exit/live-gate/mp-firefox/console.log
node docs/evidence/m5-launch/check-wire-facts.mjs       docs/evidence/m5-exit/live-gate/wire-facts.json
```

## What the exit claims

**The Demo is publicly reachable and playable, in desktop Chrome and Firefox, on
one maintainer's machine.** Nothing here supports a broader statement, and
`PLAN.md`'s "Phase 1 — closed" section enumerates twelve things that are open.

Three claims are worth separating because they are commonly conflated:

1. **"The live gate passes"** means five rows PASS and the script exits 0. It is
   evidence about the deployment as fetched from this machine, in these two
   browser builds, at this moment.
2. **"The invariant holds"** means the dedicated wasm is 2,488,298 bytes **and**
   md5 `9718a2a64978cb6e9b95ea2f0454cca5`. Quote both. The size alone does not
   catch this class of change — M4 task 3 measured an unguarded build hitting
   exactly that size with a different md5.
3. **"The deployment is reproducible"** means all five published files come back
   byte-identical from a clean rebuild. This is the strongest claim in the
   directory and it is new: `PLAN.md` recorded that `armagetronad.js` was not
   byte-reproducible, and `-O2` changed that.

## Two traps in reading anything under `docs/evidence/`

- **Screenshots taken before `m5-camera/` show the broken top-down camera.**
  Emscripten's `gluLookAt` was a no-op until M5 task 2b, so no frame committed in
  M1, M2, M3 or M4 shows a correct 3D view. Do not reuse one to illustrate the
  Demo.
- **Transcripts appear to show an abort before the keypress that caused it.**
  They do not — `drive-browser.mjs` logs its `key` line *after* keyDown + 30 ms +
  keyUp, so an abort can precede the key line while following that key's keydown.
  A property of the harness, not the game.

## Reproducing all of it

```sh
rm -rf web/build-m0 web/dist-m0 web/build-m1 web/dist-m1
source deps/emsdk/emsdk_env.sh
make -f web/Makefile dedicated -j8 && make -f web/Makefile client -j8

# the invariant, both halves
ls -l web/dist-m0/armagetronad-dedicated.wasm && md5 web/dist-m0/armagetronad-dedicated.wasm

# the deployment, end to end (~8 minutes; real browsers, public URL)
sh web/tools/live-gate.sh

# the provers
node docs/evidence/m5-launch/prove-live-checks-can-fail.mjs
sh web/tools/prove-publish-set-check-can-fail.sh

# what is actually published -- Pages serves no directory index
git fetch origin gh-pages && git ls-tree -r -l origin/gh-pages
```

**On this machine Firefox cannot reach any `*.github.io` host** — including
GitHub's own `pages.github.io` — while Chrome and `curl` reach the same URL in the
same second. `live-gate.sh` therefore routes Firefox through
`docs/evidence/m5-deploy/tunnel-proxy.mjs` by default; pass `--no-proxy` on a
machine that does not need it. The proxy tunnels CONNECT byte-for-byte and never
sees plaintext, so Firefox validates GitHub's real certificate and the document
origin is unchanged. **It does not prove Firefox reaches Pages on an unrestricted
machine** — nothing here could. Chrome and `curl` are what carry "this deployment
is reachable".
