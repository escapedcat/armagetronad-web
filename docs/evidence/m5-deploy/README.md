# M5 task 4 — the deploy

**The Demo is live at <https://escapedcat.github.io/armagetronad-web/>** and both
target browsers played three complete rounds off that URL. This directory is the
evidence, and it also records the one thing that went wrong on the way, because
it will go wrong again for anyone who follows the plan's recipe literally.

Everything here was measured against the deployed site, not a local server.

## What is deployed

`npm run deploy` (in `web/`) publishes `web/dist-m1/` to the repository's
`gh-pages` branch. The published tree is exactly six entries:

| path | bytes | source |
|---|---|---|
| `armagetronad.html` | 3,120 | emcc, from `web/shell.html` (minified by `-O2`) |
| `armagetronad.js` | 355,549 | emcc |
| `armagetronad.wasm` | 4,331,548 | emcc |
| `armagetronad.data` | 687,094 | emcc `--preload-file` |
| `index.html` | 2,353 | `web/index.html`, the site-root redirect |
| `.nojekyll` | 0 | written by `gh-pages --nojekyll` |

The four generated files are byte-identical to what `make -f web/Makefile
client` emitted — checked per file with `git hash-object` against the blobs on
the branch, not by size.

The published commit's message names the source commit it was deployed from
(`Deploy 2e5f76c9`). Commits after it on this branch are documentation and
evidence only and change no artefact, so a `gh-pages` tip that names an
earlier commit than `HEAD` is expected — re-run `measure-wire.sh`, which
compares the served bytes against `web/dist-m1`, rather than reading the two
SHAs against each other.

**Counted on this basis:** the four-file figure is `git ls-tree -r
origin/gh-pages` minus `.nojekyll` and `index.html`; the totals below are the
sum of those four, from `stat`.

## THE ARTEFACT SET IS 5,377,311 B, NOT THE ~10.2 MB THE PLAN STATES

The plan's §8 and this task's dispatch both say "four files, ~10.2 MB". That was
true at recon and is not true at HEAD: it is the **pre-`-O2`** build. The `noO`
artefacts that M5 task 2 left in `web/dist-m1` summed to 10,239,970 B and were
removed by this task's `make clean`. Task 2's `-O2 -sASSERTIONS=1` link cut the
set to **5,377,311 B (5.128 MiB)** and no durable reference restated the total.

## The wire cost, measured on the deployed site

`measure-wire.sh` + `measure-wire.asrun`. **Recon's open question — does the
Pages edge gzip a file larger than ~4 MB? — is answered: yes.**

| file | identity | on the wire | ratio | content-type |
|---|---|---|---|---|
| `index.html` | 2,353 | 1,267 | 53.8% | `text/html; charset=utf-8` |
| `armagetronad.html` | 3,120 | 1,507 | 48.3% | `text/html; charset=utf-8` |
| `armagetronad.js` | 355,549 | 87,271 | 24.5% | `application/javascript; charset=utf-8` |
| `armagetronad.wasm` | **4,331,548** | **1,274,294** | **29.4%** | `application/wasm` |
| `armagetronad.data` | 687,094 | 384,664 | 56.0% | `application/octet-stream` |

**Game set: 1,747,736 B = 1.667 MiB on the wire.** All five with
`content-encoding: gzip` and `vary: Accept-Encoding`.

Three things about how that table was produced:

- **Not from `curl -I`.** A HEAD response's `content-length` is a claim about a
  body nobody sent. Every number is `%{size_download}` from a real GET. curl
  only auto-decodes when it set `Accept-Encoding` itself (`--compressed`), so
  with the header set by hand `size_download` is the wire count.
- **Each gzip body was gunzipped and compared byte-for-byte with the local
  build**, so the rows also prove the edge's compression is lossless and that
  the deployed file is the built file.
- **1.667 MiB, not the 1.63 MiB carried by `PLAN.md` and this plan.** That
  figure is local `gzip -9` (1,707,824 B for these four). The edge's gzip is
  3.0% worse on the wasm. Both are right about different things; only one of
  them is what a visitor pays.

Controls in the same run: `Accept-Encoding: br` alone still returns identity, so
recon's "Pages serves gzip only" holds at this size too; a browser's real
`Accept-Encoding` gets gzip; and a missing file is **404 with `text/html`**,
which is why a wire check must assert on `Content-Type` and not on status.

## THE FIRST DEPLOY PUBLISHED NO ENTRY POINT

`first-deploy-broken.txt` is that commit, verbatim: 18 entries, **0 html
files**, `.wasm`/`.js`/`.data` present, **fourteen** stray dotfiles from the source
tree — counted as the published paths that are dot-prefixed at any segment,
minus `.nojekyll`, which gh-pages wrote itself. `gh-pages` printed `Published` and exited 0. The only symptom was a 404 on
the page.

`gh-pages-remove-pattern.sh` (+ `.asrun`) reproduces it on a local rig and
proves the fix. Three parts, all three needed:

1. gh-pages clears the branch by globbing its own checkout with the `-v` pattern
   and `git rm`-ing the result — and passes no `dot` option to globby, so
   **no dotfile is ever in that list**.
2. With the branch absent it creates it via `git checkout --orphan`, so the
   checkout starts as a full copy of the default branch — **root `.gitignore`
   included**, and by (1) it survives the clearing.
3. `git add .` then honours that `.gitignore`, whose line 63 is a bare `*.html`
   aimed at the generated docs under `src/doc/`. It matches both html files, and
   `git add` says nothing when it skips an ignored path.

Fix: `-v "{**/*,**/.*}"`, now in `web/package.json`'s `deploy` script. It matches
dotfiles at every level and still does not descend into `.git`, because the `**`
segments keep globby's `dot: false` so no path through a dot-directory is
generated. The A/B runs both gh-pages code paths — branch absent and branch
present — because only the first is the first-deploy case.

## Playability, against the public URL

`live-chrome/` and `live-firefox/`: M2's gameplay gate
(`web/tools/gameplay-gate.steps`), unmodified, pointed at
`https://escapedcat.github.io/armagetronad-web/armagetronad.html`. Both fresh
throwaway profiles — the drivers `mkdtemp` one per run, so neither is a
returning visitor.

`checker.txt` in each is `docs/evidence/m2-gate/check-transcript.mjs` on that
run's transcript. **The pass/fail decision is its exit status, and both exited
0.**

| | rounds completed | AIs per round | median fps | worst whole second | GL errors | worst single frame |
|---|---|---|---|---|---|---|
| Chrome 152 | 3 | 3 | 60 | 58 | 0 of 126 polls | 34 ms |
| Firefox 154 | 3 | 3 | 59 | 56 | 0 of 122 polls | 50 ms |

`visitor-path/` is the other half of "playable": Chrome opened the **bare Pages
URL**, `web/index.html` redirected it to `armagetronad.html`
(`location.href` read back after the redirect), and Play reached the first-run
Language Settings screen.

### The Firefox run went through a local proxy, and here is why

`firefox-cannot-reach-github-io.txt` is four navigations, back to back, on the
machine this was verified on:

    https://example.com                          -> loads
    https://escapedcat.github.io/...             -> NS_ERROR_FAILURE
    https://pages.github.io/  (GitHub's own)     -> NS_ERROR_FAILURE
    http://escapedcat.github.io/...  (no TLS)    -> NS_ERROR_FAILURE

A Firefox that cannot reach **GitHub's own Pages demo site** is a Firefox with a
local outbound restriction, not a symptom of this deployment — Chrome and curl
were fetching the same URL at the same moment. The first attempt hung 26 s and
every later one failed in ~15 ms, which is the shape of an interactive firewall
(Little Snitch runs here) prompting once, timing out unanswered, and caching the
denial; its rules need root to read and this port has no business changing them.

So the Firefox gate ran with `--pref` pointing at `tunnel-proxy.mjs`, a local
CONNECT proxy. TLS stays end to end — the proxy tunnels bytes and never sees
plaintext — so Firefox validated GitHub's real certificate and the document's
origin was still `https://escapedcat.github.io`. The only thing that changed is
which process opened the TCP connection. **It does not prove Firefox on an
unrestricted machine reaches Pages**; nothing here could, and nothing needs to,
since Chrome and curl did. It proves Firefox plays the deployed bytes, fetched
live from the deployment, over https, from that origin.

`--pref name=value` is a new repeatable option on `web/tools/drive-firefox.mjs`,
written into the throwaway profile's `user.js`. Task 5 will need it on this
machine for the same reason.

## The turn-flicker report: NOT REPRODUCED, and what was actually measured

Added mid-task: the maintainer reported that "every time the bike turns the
screen flickers a bit". `turn-flicker/` is a targeted probe against the public
URL in Chrome — not a gate, and not a diagnosis.

It samples what the one-shot-per-step gates cannot: `glGetError` on **every**
frame instead of every 30th, the frame-time series with the turns timestamped in
the same clock (a `keydown` listener in the page), and six **consecutive**
screenshots spanning one LEFT turn.

    frames 1791   p50 16.7 ms   p99 20.2 ms   max 208.7 ms
    glGetError: 1791 polls, 0 non-zero
    six turns, worst frame within -200/+700 ms of each: 19.6 22.7 22.2 19.1 24.1 25.2 ms
                                     frames over 40 ms:  0    0    0    0    0    0
    away from turns: 1466 frames, max 208.7 ms, 3 frames over 40 ms

**The long frames are anticorrelated with turning**: every frame over 40 ms,
including the 208.7 ms worst, happened away from a turn. `frame-stats.py` over
the six burst frames shows no outlier — in particular the top fifth of the image,
where the sky/ceiling band lives, stays at 29.8–33.5 mean brightness across the
turn, and a frame rendered top-down (the §11 degenerate-`gluLookAt` failure mode)
could not do that.

Neither hypothesis got a positive signal. **This is not an all-clear**, and two
limits are why: the driver turns roughly once per 1.5 s where a person turns far
more often, and §10's own thesis is that a wrong-but-evenly-dividing vertex count
draws garbage **silently** — M2 recorded exactly such a site corrupting sparks
with no error at all. So "0 GL errors" cannot exclude the `gWall.cpp`
`RenderNormal` hypothesis; it only says nothing fired.

## Re-running any of this

    # the wire table and its controls
    sh docs/evidence/m5-deploy/measure-wire.sh

    # the deploy defect and its fix, on a local rig, no network
    sh docs/evidence/m5-deploy/gh-pages-remove-pattern.sh

    # the gate against the public URL (add the --pref block for Firefox here)
    node web/tools/drive-browser.mjs --headed --out /tmp/live-chrome \
         --url https://escapedcat.github.io/armagetronad-web/armagetronad.html \
         --script-file web/tools/gameplay-gate.steps
    node docs/evidence/m2-gate/check-transcript.mjs /tmp/live-chrome/console.log
