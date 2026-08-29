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
| `chrome-console.log` | real | `persist-gate.steps` | **PASS** (18/18) |
| `firefox-console.log` | real | `persist-gate.steps` | **PASS** (18/18) |
| `negative-chrome-console.log` | real | `persist-negative.steps` | **FAIL** (P10 P11 P12 P13) |
| `slowgate-chrome-console.log` | populate slowed 3 s | `persist-gate.steps` | **PASS** (18/18) |
| `slowungated-chrome-console.log` | populate slowed 3 s, gate deleted | `persist-gate.steps` | **FAIL** (P3 P4) |
| `ungated-chrome-console.log` | gate deleted, populate unchanged | `persist-gate.steps` | **PASS** — the control that fails to control |

Measured, Chrome 152 and Firefox, localhost:

```
Chrome   boot 1  populate ok in  32 ms   boot 2  populate ok in 4 ms
Firefox  boot 1  populate ok in   5 ms   boot 2  populate ok in 3 ms
user.cfg 21950 bytes (Chrome) / 21646 bytes (Firefox), byte count and content
hash identical across the reload; sentinel nonce read back verbatim.
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
kill %1
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
[   108ms] [PERSIST] populate ok in 34ms
[   379ms] [PERSIST] runtime initialized, Play enabled
```

Emscripten's `run()` does `await new Promise(r => setTimeout(r, 1))` between
`preRun()` and `initRuntime()`, and `initRuntime()` then takes ~280 ms of
synchronous wasm work here. So with the gate removed the ordering is a race
between a 1 ms timer plus ~280 ms of constructors on one side and a ~34 ms
IndexedDB round trip on the other — and on this machine IndexedDB happened to
win. **That is exactly the intermittency that makes this bug dangerous**, and
it is why the real control widens the window instead.

`make-control-pages.mjs` therefore delays the `FS.syncfs` *callback* by 3000 ms
(the populate still really runs; its completion is reported and acted on three
seconds later). It emits three control pages in all:

| | run dependency | populate | `[PERSIST] populate ok` | `[PERSIST] runtime initialized` |
|---|---|---|---|---|
| real page | kept | normal | 102 ms | 373 ms |
| `armagetronad-ungated.html` | deleted | normal | 108 ms | 379 ms |
| `armagetronad-slowgate.html` | kept | +3 s | **3106 ms** | **3186 ms** |
| `armagetronad-slowungated.html` | deleted | +3 s | 3116 ms | **380 ms** |

Row 2 is the control that fails to control. Row 3 is the positive
demonstration: no accident of timing delays `onRuntimeInitialized` — and with
it the Play button — by three seconds. Only the run dependency does. Row 4 is
the control that makes P3/P4 falsifiable: the runtime came up 2.7 s before the
filesystem it was supposed to read.

All three control pages still PASS P10–P13, because the gate script waits for
the populate line before it clicks Play and so never enters the race itself.
Between `slowgate` and `slowungated`, exactly two checks move; that isolation
is the point.

### Coverage, stated honestly

P1, P2, P5–P9, P14–P17 and PZ are **not** individually proven-failable. They
are structural (a payload is present and well formed, the deliberate control
error was seen, every declared id produced a verdict). Only P3/P4 and P10–P13
have a committed run in which they fail.

## Known and accepted: `/persist` collects more than `user.cfg`

`--userdatadir /persist` is also where the game puts `var/ladderlog.txt` and
`var/scorelog.txt` (`CONSOLE_LADDER_LOG` is `1` in
`web/webdefaults/autoexec.cfg`), and where `tPathScreenshot` resolves. Both
appear in the IndexedDB key list above. They grow without bound during play and
IndexedDB quota does not. This is **noted, not solved** — solving it means
either redirecting those paths or excluding them from the mount, and neither
belongs in the task that creates the mount.

Also unaddressed here: what the page does when IndexedDB is unavailable
(private windows, storage disabled). `web/shell.html` reports the error and
releases the run dependency anyway, so the game still starts without
persistence rather than hanging on "Loading…" — but that path has not been
exercised in a browser.

## Files

| file | what it is |
|---|---|
| `check-persist-transcript.mjs` | the arbiter. P1–P17 + PZ, exit 0/1, transcript-only. |
| `make-control-pages.mjs` | builds the two ordering-control pages from the generated HTML. |
| `persist-gate.steps.asrun` | the gate script exactly as run for the transcripts here. |
| `persist-negative.steps.asrun` | the wipe control, exactly as run. |
| `chrome-*.png`, `firefox-*.png` | boot 1 ready / language menu, boot 2 ready / language menu, and the deliberate error banner. |
| `*-console.log` | the six transcripts in the results table. |
