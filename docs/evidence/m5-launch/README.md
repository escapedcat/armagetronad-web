# M5 task 5 — the live gate

**Everything in this directory was measured against
<https://escapedcat.github.io/armagetronad-web/>, not against a local server.**
That is the whole point of it. Every gate this project built between M1 and M4
served `web/dist-m1` from `python3 -m http.server` on localhost, so not one of
them ever exercised a remote origin, an https scheme, a CDN choosing what to
compress, a MIME type chosen by someone else's server, or a 404 page that is
not ours.

Run the whole thing with:

    sh web/tools/live-gate.sh

## What it asserts, and where each part comes from

| part | script | checker | new? |
|---|---|---|---|
| the wire facts | `web/tools/wire-facts.sh` | `check-wire-facts.mjs` (W1–W13, WZ) | new |
| the game is playable | `web/tools/gameplay-gate.steps`, **unmodified** | M2's own `docs/evidence/m2-gate/check-transcript.mjs` | re-aimed |
| multiplayer fails gracefully over https | `web/tools/https-multiplayer.steps`, **unmodified** | `check-live-multiplayer.mjs` (X1–X11, XZ) | re-aimed, checker new |

Every new assertion is shown capable of failing by
`prove-live-checks-can-fail.mjs`, **by set equality** — a case is green only
when the observed failure set *equals* the ids it declared, so collateral is
declared rather than tolerated.

The prover: **53 cases, all green** — 19 over the wire checker, 16 over each of
the two multiplayer transcripts, and **2 that are not mutations at all** (see
"the real controls" below). Counted from the `ok` lines in
`prove-live-checks-can-fail.asrun`, which is 56 because the three baseline runs
are `ok` lines too.

## 1. The wire facts

`wire-facts.json` + `wire-facts.check.txt`. Measured at the deploy that is
live now (`gh-pages` tip `8fafc556`, "Deploy `a0aad048`").

| file | identity | on the wire | ratio | content-type |
|---|---|---|---|---|
| `armagetronad.html` | 4,395 | 2,078 | 47.3% | `text/html; charset=utf-8` |
| `armagetronad.js` | 357,282 | 87,938 | 24.6% | `application/javascript; charset=utf-8` |
| `armagetronad.wasm` | **4,331,484** | **1,274,267** | **29.4%** | **`application/wasm`** |
| `armagetronad.data` | 687,094 | 384,664 | 56.0% | `application/octet-stream` |
| **a first visit** | **5,380,255** | **1,748,947** | | **1.668 MiB** |
| `index.html` (root redirect) | 2,353 | 1,267 | 53.8% | `text/html; charset=utf-8` |

All five carry `content-encoding: gzip` and `vary: Accept-Encoding`, all five
are byte-identical by sha256 to `web/dist-m1`, and the first-visit total is
**8.6× under `PLAN.md`'s 15 MB budget**.

**These are not task 4's numbers and both are right.** Task 4 measured
4,331,548 → 1,274,294 and a four-file total of ~1.67 MiB. That was its own
deploy; the site was redeployed afterwards with the autostart/sizing build, and
the wasm, the js and the shell page all changed size. The MiB figure survives,
the byte counts do not. **Re-run `wire-facts.sh` rather than quoting any of
these numbers** — that is the entire reason the observation is recorded as JSON
and arbitrated by a program.

**Method** (unchanged from task 4, restated in the script): every size is
`%{size_download}` from a **real GET**, never a HEAD's `content-length`, and
the headers come from `-D` on that same response. Each file is fetched twice,
identity and gzip; the gzip body is gunzipped and sha256'd, so a wire number is
only ever reported for a body that provably decoded to the artefact.

### The negative control, and its trap

A name that does not exist answers **404 with `text/html`**. So:

- asserting "the bogus name was not 200" would pass on a host that had never
  heard of wasm;
- asserting "the bogus name returned HTML" is true of a healthy Pages too.

**W9 therefore asserts on `Content-Type` in both directions** — not the wasm's
type, and *is* the html error page — and prints the 404 while explicitly
declining to assert it. `prove-live-checks-can-fail.mjs` case `W9a` is the trap
made concrete: it gives the bogus name `application/wasm` and leaves the status
at 404, and W9 fires.

## 2. The game is playable, off the public URL

`live-chrome/`, `live-firefox/`. M2's `gameplay-gate.steps` **with no edits**,
arbitrated by M2's own `check-transcript.mjs`. **The pass/fail decision is its
exit status and both exited 0.**

| | rounds | AIs/round | median fps | worst whole second | GL errors | worst frame |
|---|---|---|---|---|---|---|
| Chrome 152 | 3/3 | 3 | 60 | 58 | 0 of 140 polls | 34.5 ms |
| Firefox 154 | 3/3 | 3 | 60 | 58 | 0 of 138 polls | 36.0 ms |

**What targeting a remote origin required: `--url`, and nothing else.** No
change to the steps file, no change to either driver. The gate was already
origin-agnostic because every asset path in `web/dist-m1` is relative — M5's
recon established that by serving every test from a subdirectory rather than
assuming it.

## 3. Multiplayer over https — task 3's handover, settled

`live-mp-chrome/`, `live-mp-firefox/`, and three further samples in
`live-mp-{chrome-2,firefox-2,firefox-3}/`. All five pass
`check-live-multiplayer.mjs` (X1–X11, XZ).

Task 3 decided this behaviour ships unchanged, and closed by asking task 5 to
run `https-multiplayer.steps` against the public URL, because **no number in
that task came from a real deployment** — every one came from a self-signed rig
at `https://localhost:8443`.

**It reproduces.** Same screens, same order, same ~20 s, same four masters,
and the client alive with `glGetError` 0x0 afterwards:

| run | engine | attempts | per master | span |
|---|---|---|---|---|
| `live-mp-chrome` | Chrome 152 | **100** | 25 25 25 25 | 20.01 s |
| `live-mp-chrome-2` | Chrome 152 | **98** | 25 24 25 24 | 20.00 s |
| `live-mp-firefox` | Firefox 154 | **96** | 24 24 24 24 | 20.04 s |
| `live-mp-firefox-2` | Firefox 154 | **98** | 25 24 25 24 | 20.01 s |
| `live-mp-firefox-3` | Firefox 154 | **99** | 25 25 24 25 | 20.00 s |

### CORRECTION — the band is 96–100, not 97–100

Four of the five live runs land inside task 3's stated 97–100. One does not:
Firefox returned **96**, and 96 is not an anomaly, it is the floor of the
mechanism.

**Counted on this basis:** every https run this project holds — task 3's four
on the local rig plus this task's five against Pages, **nine** transcripts,
**36** per-master observations — queries four masters and makes **24 or 25**
attempts to each, with no other value ever seen. So the reachable totals are
4×24 = 96 through 4×25 = 100, and task 3's floor of 97 was the minimum of four
samples rather than the minimum of the mechanism.

Widening it by one does not loosen the check. What X2 asserts — ~25 blocked
retries per master, four masters, nothing else — is unchanged, and the `http:`
figure (19) or a silent zero still fail it.

### The two existing pass criteria this route breaks, handled by name

Task 3 flagged both and both bit exactly as predicted.

1. **Firefox logs every blocked attempt as `[EXCEPTION]`** — 192 lines in
   `live-mp-firefox` — and every gate this project has written forbids the tag.
   **X8 does not drop the rule.** It permits exactly two texts, quoted
   verbatim, and only on lines that also name a `ws://` endpoint. Prover cases
   `X8a` (a third text), `X8b` (a permitted text on a line with no `ws://`) and
   `X8c` (an ordinary hazard) all fire.

2. **Firefox prints no mixed-content message at all.** `live-mp-firefox` has
   **0** lines matching `/mixed content/i` while 96 attempts were stopped — so
   a gate that grepped for "Mixed Content" would conclude Firefox is *not*
   blocking. **X9 asserts that absence positively** rather than grepping, and
   says so in its own output. Chrome, in the same directory, prints 100.

   X3 and X9 deliberately read **different substrings** of what is, in Chrome,
   the same line: X3 counts the clause saying the endpoint was refused, X9
   counts the phrase alone. Welding them to one substring would have made
   neither separately provable — the defect M4 task 3's review found. Because
   they are separate, **no multiplayer case declares any collateral at all**.

## The real controls — stronger than any mutation

Two entries in the prover are not mutations. They are **task 3's own
transcripts**, run against the local rig, fed to this checker unmodified. Each
fails **exactly X1** and passes everything else — which is both a witness that
X1 works and a precise statement of what task 3 was missing.

Three more live controls are in `wire-facts.json`, recorded in the same run as
the facts they control for: the bogus filename, `Accept-Encoding: br` alone
(still identity at 4.3 MB, so recon's "Pages is gzip-only" holds at this size),
and a real browser's `Accept-Encoding`.

## Firefox went through a local proxy, and here is the control set

`firefox-github-io-still-blocked.txt`, re-measured in this session rather than
carried forward from task 4: `example.com` loads; our deep link fails
`NS_ERROR_FAILURE`; **GitHub's own `pages.github.io` fails the same way**; the
deep link through `docs/evidence/m5-deploy/tunnel-proxy.mjs` loads with
`location.host` read back as `escapedcat.github.io`. Control C is the one that
settles attribution — a browser that cannot reach GitHub's own Pages demo site
has a local outbound restriction, and Chrome and curl were fetching the same
URL in the same minute.

The proxy tunnels `CONNECT` byte-for-byte and never sees plaintext, so Firefox
validated GitHub's real certificate and the document origin is unchanged. **It
does not prove Firefox reaches Pages on an unrestricted machine.** Nothing here
could, and nothing needs to.

## Re-running any of this

    sh web/tools/live-gate.sh                    # the whole thing, ~8 minutes
    sh web/tools/live-gate.sh --only wire        # just the curl assertions
    node docs/evidence/m5-launch/prove-live-checks-can-fail.mjs
