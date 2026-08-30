# M4 task 1 — `/persist` is IndexedDB-backed, and a reload reads it back

Evidence for the first M4 task: the client's `/persist` mount survives a page
reload, and it is populated *before* the game can start.

## The claim, exactly

1. `/persist` is an IDBFS mount whose IndexedDB → MEMFS **populate finishes
   before `main()` can start**. Not "was started".
2. Booting the game, **with no player action beyond the Play click**, writes
   `/persist/var/user.cfg`, and that write reaches IndexedDB.
3. Bytes written during one page load are readable after a real
   `location.reload()`.
4. Both are checked against **two independent witnesses**: the MEMFS view the
   program sees (`FS.readdir`/`FS.readFile`), and IndexedDB itself, read over a
   connection the gate script opens for itself.

## What is *not* claimed

**Nothing about the game using what it read.** `user.cfg` surviving is a
filesystem fact. Whether `st_LoadConfig`'s values take effect — and whether key
bindings in particular do — is a later task's claim, and no check in
`check-persist-transcript.mjs` speaks to it. Quoting this directory as
"settings persist" over-claims; it says "the file persists".

Also not claimed: anything about quota, eviction, private-browsing modes, or
what happens when IndexedDB is unavailable. See "Known and accepted" below.

## Results

| run | page | script | checker |
|---|---|---|---|
| `chrome-console.log` | **the product** | `persist-gate.steps` | **PASS** (18/18) |
| `firefox-console.log` | **the product** | `persist-gate.steps` | **PASS** (18/18) |
| `negative-chrome-console.log` | the product | `persist-negative.steps` | **FAIL** (P10 P11 P12 P13) |
| `noautopersist-chrome-console.log` | mounted without `autoPersist` | `persist-gate.steps` | **FAIL** (P7 P9 P10 P11 P12 P13) |
| `slowungated-chrome-console.log` | populate slowed 3 s, gate deleted | `persist-gate.steps` | **FAIL** (P3 P4) |
| `slowgate-chrome-console.log` | populate slowed 3 s, gate kept | `persist-gate.steps` | **PASS** (18/18) |
| `ungated-chrome-console.log` | gate deleted, populate unchanged | `persist-gate.steps` | **PASS** — the control that fails to control |

Four of these are PASSes and only two are the product, so the checker names the
page it is scoring: any transcript that did not navigate to `armagetronad.html`
gets a `NOTE  this transcript is NOT the product page` line, and the wipe run
gets one naming its `[PERSISTWIPE]` step. Which green is which does not have to
be looked up here.

Measured, Chrome 152 and Firefox, localhost:

```
Chrome   boot 1  populate ok in  62 ms   boot 2  populate ok in 5 ms
Firefox  boot 1  populate ok in   8 ms   boot 2  populate ok in 3 ms
user.cfg 21950 bytes (Chrome), byte count and content hash identical across
the reload; sentinel nonce read back verbatim.
IndexedDB '/persist' holds 5 keys after boot 1:
  /persist/m4-probe.txt  /persist/var  /persist/var/ladderlog.txt
  /persist/var/scorelog.txt  /persist/var/user.cfg
```

## Reproducing

```sh
make -f web/Makefile client -j8            # needs: source deps/emsdk/emsdk_env.sh
python3 -m http.server 8000 --directory web/dist-m1 &

node web/tools/drive-browser.mjs --headed --out /tmp/persist-chrome \
     --script-file web/tools/persist-gate.steps
node web/tools/drive-firefox.mjs           --out /tmp/persist-firefox \
     --script-file web/tools/persist-gate.steps
node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/persist-chrome/console.log

# controls
node web/tools/drive-browser.mjs --headed --out /tmp/persist-negative \
     --script-file web/tools/persist-negative.steps
node docs/evidence/m4-persist/make-control-pages.mjs
node web/tools/drive-browser.mjs --headed --out /tmp/slowgate \
     --url http://localhost:8000/armagetronad-slowgate.html \
     --script-file web/tools/persist-gate.steps
node web/tools/drive-browser.mjs --headed --out /tmp/slowungated \
     --url http://localhost:8000/armagetronad-slowungated.html \
     --script-file web/tools/persist-gate.steps
node web/tools/drive-browser.mjs --headed --out /tmp/ungated \
     --url http://localhost:8000/armagetronad-ungated.html \
     --script-file web/tools/persist-gate.steps
node web/tools/drive-browser.mjs --headed --out /tmp/noautopersist \
     --url http://localhost:8000/armagetronad-noautopersist.html \
     --script-file web/tools/persist-gate.steps      # ~2.5 min slower, see below
kill %1

# and, needing no browser at all:
node docs/evidence/m4-persist/prove-checks-can-fail.mjs
```

`--headed` is used for Chrome only for consistency with the M2/M3 gates and
because a headed window uses the real GPU. This gate presses **no keys**, so it
is the one script in `web/tools/` that headless Chrome is also safe for — the
headless keydown flood both drivers warn about cannot reach it.

`user.cfg`'s hash differs between runs (the game writes a random player name
and colour on first use). The checker only ever compares boot 1 against boot 2
*within one transcript*, never against a stored constant.

## The controls, and one that did not work

### The round trip — `persist-negative.steps`

The same gate script with one step changed: between the two boots it wipes
IndexedDB, and boot 2 then finds nothing. P10–P13 flip to FAIL; everything else
still passes, so the failure is attributable.

Writing the wipe as a bare `indexedDB.deleteDatabase('/persist')` **does not
work and passes for the wrong reason**: the page still holds an open
connection, so the request fires `onblocked`, the database survives, boot 2
reads the data back, and the "negative" control is green. The step therefore
calls `Module.IDBFS.quit()` first — which closes every connection libidbfs.js
has cached — and records the outcome in the transcript, so a `BLOCKED` delete
can never be mistaken for a wipe:

```
[PERSISTWIPE] {"quit":true,"queuePersist_neutered":true,"delete":"deleted","databases_after":[]}
```

### The ordering — `make-control-pages.mjs`

P3/P4 are the checks that matter most, because the bug they exclude is silent.
`FS.syncfs(true, cb)` is asynchronous; if `main()` starts before that callback
fires, `st_LoadConfig` reads an empty `/persist` and the next save writes a
fresh file over the top. Saving keeps working, nothing is ever read back, and
from inside the game it is indistinguishable from success.

**The obvious control does not work, and that is itself the finding.** Deleting
the run dependency and re-running left P3/P4 *passing* — `ungated-chrome-console.log`
is that run, kept and re-runnable, and the checker scores it PASS 18/18:

```
[   152ms] [PERSIST] populate ok in 38ms
[   485ms] [PERSIST] runtime initialized, Play enabled
```

Emscripten's `run()` does `await new Promise(r => setTimeout(r, 1))` between
`preRun()` and `initRuntime()`, and `initRuntime()` then takes ~300 ms of
synchronous wasm work here. So with the gate removed the ordering is a race
between a 1 ms timer plus ~300 ms of constructors on one side and a ~38 ms
IndexedDB round trip on the other — and on this machine IndexedDB happened to
win. **That is exactly the intermittency that makes this bug dangerous**, and
it is why the real control widens the window instead.

`make-control-pages.mjs` therefore delays the `FS.syncfs` *callback* by 3000 ms
(the populate still really runs; its completion is reported and acted on three
seconds later). Of the four control pages it emits, three bear on the ordering:

| | run dependency | populate | `[PERSIST] populate ok` | `[PERSIST] runtime initialized` |
|---|---|---|---|---|
| real page | kept | normal | 201 ms | 508 ms |
| `armagetronad-ungated.html` | deleted | normal | 152 ms | 485 ms |
| `armagetronad-slowgate.html` | kept | +3 s | **3149 ms** | **3227 ms** |
| `armagetronad-slowungated.html` | deleted | +3 s | 3124 ms | **474 ms** |

Row 2 is the control that fails to control. Row 3 is the positive
demonstration: no accident of timing delays `onRuntimeInitialized` — and with
it the Play button — by three seconds. Only the run dependency does. Row 4 is
the control that makes P3/P4 falsifiable: the runtime came up 2.7 s before the
filesystem it was supposed to read.

All three control pages still PASS P10–P13, because the gate script waits for
the populate line before it clicks Play and so never enters the race itself.
Between `slowgate` and `slowungated`, exactly two checks move; that isolation
is the point.

### The instrumentation — a fourth control page

`armagetronad-noautopersist.html` mounts with `{}` instead of
`{ autoPersist: true }`. Nothing else changes: the populate still runs, the run
dependency is still held, the game still writes `user.cfg`. What is gone is the
write-*back* — `libidbfs.js` only wraps the mount's `node_ops.mknod` when
`autoPersist` is set, so nothing ever queues a MEMFS → IndexedDB sync.

It is the strongest control here, because it is neither a doctored transcript
nor a timing trick: it is a real browser running the real game against a mount
that genuinely does not persist. It flips **P7 P9 P10 P11 P12 P13**.

**It does not flip P6, and the review that asked for this page predicted it
would.** P6 asserts that booting the game *wrote* `/persist/var/user.cfg`, and
it reads the MEMFS payload — which is still true without `autoPersist`, because
the game's write lands in memory exactly as before. That is P6 being correctly
scoped, not P6 being weak: "the file reached IndexedDB" is P9's claim, and P9
does flip. P6's own falsifier is a transcript mutation in the prover.

The run is deliberately slow: `until:1:90000:[PERSISTSYNC] start 1` and
`until:1:60000:PROBE-PERSISTED` can never be satisfied on this page, so both
time out in full — about 2.5 minutes more than the other runs. The timeouts are
recorded as harness lines, which is the point of `until:` over `wait:`.

### Coverage

Every check has been *seen* to fail except PZ, which cannot.

| check | falsified by |
|---|---|
| P1 P2 P5 P6 P8 P14 P15 P16 P17 | `prove-checks-can-fail.mjs` (transcript mutation) |
| P3 P4 | mutation **and** `armagetronad-slowungated.html` (real browser) |
| P7 P9 | mutation **and** `armagetronad-noautopersist.html` (real browser) |
| P10 P11 P12 P13 | mutation **and** `noautopersist` **and** `persist-negative.steps` |
| PZ | nothing — see below |

`prove-checks-can-fail.mjs` takes a passing transcript, applies one targeted
mutation per check, runs the **real** checker as a child process, and requires
that the observed set of failures equals the declared set exactly — so a
mutation that quietly knocked out four unrelated checks is a failure of the
prover, not a success. It needs no browser and takes about a second:

```
ok   baseline: the unmutated transcript passes (exit 0, 18 checks, 0 failures)
ok   P9   drop user.cfg from the keys IndexedDB reported after boot 1
       expected FAIL: P9   observed: P9   exit 1
...
RESULT: PASS -- all 17 mutations flipped exactly the checks they declared
```

A mutation proves a check is **wired up** — that it reads the field it claims
to read and fails when that field is wrong. It does not prove the field means
what the check's prose says. Only a browser doing the wrong thing shows that,
which is why the control pages exist and why `noautopersist` is worth 2.5
minutes.

**PZ is not a check on the transcript.** It compares the ids that produced a
verdict against the declared list, and all seventeen `check()` calls in
`check-persist-transcript.mjs` are unconditional top-level statements — so no
input, however mutilated, can stop one from running, and PZ cannot fail. It is
a regression guard on the checker's own source, against a future edit that puts
a check behind an `if` and so makes it *vanish* rather than fail. (M3's `AZ` was
the same idea and *was* reachable, because its checks sat inside guards.) The
prover reports PZ as `NOT COVERABLE, by design` with that reason rather than
skipping it silently.

## Known and accepted

### `/persist` collects more than `user.cfg`

`--userdatadir /persist` is also where the game puts `var/ladderlog.txt` and
`var/scorelog.txt` (`CONSOLE_LADDER_LOG` is `1` in
`web/webdefaults/autoexec.cfg`), and where `tPathScreenshot` resolves. Both
appear in the IndexedDB key list above. They grow without bound during play and
IndexedDB quota does not. This is **noted, not solved** — solving it means
either redirecting those paths or excluding them from the mount, and neither
belongs in the task that creates the mount.

### `[PERSISTSYNC] idle` means drained, not durable

The gate uses `IDBFS.onAutoPersistStateChanged`'s falling edge to decide when
it is worth looking at IndexedDB. That edge means **the queue drained**, not
that the writes succeeded. In
`deps/emsdk/upstream/emscripten/src/lib/libidbfs.js`, `queuePersist`'s
`onPersistComplete()` takes **no error parameter** and is handed straight to
`IDBFS.syncfs(mount, false, …)`, whose callback is the one that receives the
reconcile error — so a write-back that failed on quota or revoked storage still
produces `onAutoPersistStateChanged(false)`. Nothing in `libidbfs.js` surfaces
that error to a caller at all.

Nothing here leans on it: the claim that bytes reached IndexedDB is carried by
`[PERSISTIDB]` (P9, P13), which opens its own connection and reads the keys
back. **M4's quota work must not lean on it either** — it will need the error
out of `IDBFS.syncfs` directly, or its own read-back.

### Failing to start

`web/shell.html` wraps the whole `preRun` body in a `try`/`catch` and releases
the run dependency through a `held`-guarded helper, so *every* path that can
throw — `FS.mkdir`, `FS.mount`, a synchronous throw out of `FS.syncfs` —
degrades to "the game starts with an in-memory `/persist`" rather than to a
page parked on "Loading…" for ever. An earlier version registered the
dependency *after* the mount, which made that promise path-dependent: a
`mkdir`/`mount` throw escaped with nothing held (noisy, but not a hang) while a
throw out of `FS.syncfs` hung the page, since the dependency was already held
and nothing would release it.

The failure is not silent: the `[PERSIST]` line reads `FAILED`, and P2 ("two
populate lines, both ok") fails on it. **This path has still not been exercised
in a browser** — no run here disables IndexedDB — so it is reasoned, not
measured, and should be described that way.

## Files

| file | what it is |
|---|---|
| `check-persist-transcript.mjs` | the arbiter. P1–P17 + PZ, exit 0/1, transcript-only. |
| `prove-checks-can-fail.mjs` | mutates a passing transcript once per check and re-runs the real checker; no browser needed. |
| `make-control-pages.mjs` | builds the four control pages from the generated HTML. |
| `persist-gate.steps.asrun` | the gate script exactly as run for the transcripts here. |
| `persist-negative.steps.asrun` | the wipe control, exactly as run. |
| `chrome-*.png`, `firefox-*.png` | boot 1 ready / language menu, boot 2 ready / language menu, and the deliberate error banner. |
| `*-console.log` | the seven transcripts in the results table. |
