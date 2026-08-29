# M4 Task 3 — `autoexec.cfg` stops overriding the player

Two claims, two gates, two controls.

1. **A setting the player changes in the menu is still there after a reload.**
   It was not before this task: `autoexec.cfg` loads *after* `user.cfg`, so its
   `MAX_FPS 60` silently overwrote the saved choice on every load.
2. **The M0 dedicated server is still byte-identical** — 2,488,298 bytes,
   md5 `9718a2a64978cb6e9b95ea2f0454cca5`. This is the only part of M4 that
   could have broken that, because the two files it edits are in the six
   directories `web/Makefile`'s `$(SRCS)` wildcards.

Everything here is re-runnable. Nothing in it is an argument.

---

## The change

`web/webdefaults/autoexec.cfg` lost two lines:

| setting | was | is now |
|---|---|---|
| `MAX_FPS 60` | a line in `autoexec.cfg`, i.e. a hard override | the compiled default of `sr_maxFPS` in `src/render/rSysdep.cpp` |
| `SOUND_BUFFER_SHIFT 1` | a line in `autoexec.cfg` | the compiled default of `buffer_shift` in `src/engine/eSound.cpp` |

`INFINITY_PLANE 0` and `USE_DISPLAYLISTS 0` **stay** in `autoexec.cfg`. They
are correctness settings — M2 established that a WebGL vendor-string sniff
would otherwise turn them on and break rendering — and a saved `user.cfg` must
not be able to re-enable them. The distinction the file now records is: *may
the player change this and keep the change?* If yes it is a preference and
belongs in the binary; if no it is an override and belongs in `autoexec.cfg`.

Both moved settings are guarded with

```c
#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )
```

and both halves matter. `__EMSCRIPTEN__` alone would not do: `em++` defines it
for *both* wasm builds this repo produces, so the dedicated server would have
picked the new values up too.

**M3's measured `SOUND_BUFFER_SHIFT` reasoning moved with the value, it was not
deleted with the line.** The frames-per-shift table, the four-row
latency/starvation measurement from three full Chrome rounds, the argument that
latency and starvation tolerance are the same quantity, the margin comparison
that chose 1 over 0, and the note that upstream's non-WIN32 default of 0 does
not transfer to a single-threaded device — all of it is now the comment on
`buffer_shift` in `src/engine/eSound.cpp`, and `autoexec.cfg` points at it.

`autoexec.cfg` is preloaded, so editing even its comments moves the bundle.
M3 measured a comment-only edit at +3,829 bytes; this task's net edit takes
**`armagetronad.data` from 688,393 to 686,898 bytes (−1,495)**.

The client `.wasm` is measured, not assumed: relinking the pre-task
(`56df579d`) sources with the flags and **object order** `make -n -B` prints
gives 8,879,411 bytes / `ee5820c4dbcdffb6ded9b30b3b9aa166`, against the current
8,879,411 / `caabe85d931539b3b4d4109eb75b5a90`. Same size, different content —
the same length-neutral effect that makes CONTROL 1b's dedicated wasm come out
at exactly 2,488,298 below.

> A third trap, found while taking that measurement. **Object order on the link
> line changes the output.** A first attempt appended the two rebuilt objects
> instead of substituting them in place and got 8,880,111 bytes — a 700-byte
> difference caused entirely by link order, which would have been misread as
> the edit's cost. Any control link must substitute, never append;
> `check-dedicated-byte-identity.mjs` does.

---

## Gate 1 — behaviour: the player's choice survives

```
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out docs/evidence/m4-config-precedence \
     --script-file web/tools/maxfps-precedence.steps
node docs/evidence/m4-config-precedence/check-maxfps-transcript.mjs --expect real \
     docs/evidence/m4-config-precedence/chrome-console.log
```

The script boots three times. Boot 1 walks the first-use flow so `FIRST_USE 0`
persists. Boot 2 walks **System Setup → Display Settings → Screen Mode**, moves
down seven rows to *FPS Limit*, and presses Left twice — 60 → 40 → **30**. Boot
3 reloads and goes back to the same row.

| phase | `MAX_FPS` in `user.cfg` | |
|---|---|---|
| `boot1-nothing-chosen-yet` | 60 | the compiled default, before anyone chooses |
| `before-change` | 60 | still the default at the menu row |
| `changed-menu-still-open` | 60 | the change is in memory only |
| `after-menu-leave` | **30** | leaving the menu writes it (M4 task 2) |
| `boot3-before-play` | **30** | survived the IndexedDB round trip |
| `boot3-in-menu` | **30** | **survived the game's own config load** |

That last row is the whole task. Every row above it is also true on the control
page; only that one separates the two builds.

`13-boot3-max-fps-still-30.png` is the picture: after two page reloads, the
Screen Mode menu reads **FPS Limit: 30**. The menu item renders live
`sr_maxFPS`, so this is the value the game is actually capped at, not a file.

Chrome and Firefox both pass — `check-chrome.asrun`, `check-firefox.asrun`.

### The `SOUND_BUFFER_SHIFT` half

It is *not* driven through the menu, on purpose: changing it from the Sound
menu tears the audio device down and re-opens it (`se_SoundMenu` calls
`se_SoundExit`/`se_SoundInit` when the shift changed), which is real behaviour
but an unrelated risk to take inside a precedence test. It is verified the
other way round — the device the game actually opened:

```
[SND] device opened: 22050 Hz, 2 ch, 16-bit, 1024 frames/callback
      (46.4 ms per callback, SOUND_BUFFER_SHIFT 1)
```

on all three boots, while `autoexec.cfg` names no `SOUND_BUFFER_SHIFT` and
neither does anything under `config/` (`grep -rn 'MAX_FPS\|SOUND_BUFFER_SHIFT'
config/` is empty). The compiled default is the only remaining source.

---

## The control: the same script against the same wasm with the fix undone

`make -f web/Makefile client-oldautoexec` builds
`armagetronad-oldautoexec.html`: **the same wasm, byte for byte**
(`caabe85d931539b3b4d4109eb75b5a90` for both pages), differing only in its
preloaded `autoexec.cfg`, to which the Makefile appends `MAX_FPS 60` and
`SOUND_BUFFER_SHIFT 1`. The control file is *derived* from the shipped one at
build time, so it cannot drift away from it.

Holding the wasm constant is the point: the two runs differ in exactly one
input, and a difference in outcome cannot be blamed on anything else.

The identical steps file runs to completion on it, and:

| phase | real page | control page |
|---|---|---|
| `after-menu-leave` | 30 | 30 |
| `boot3-before-play` | 30 | 30 |
| `boot3-in-menu` | **30** | **60** |

The control's reversion happens **between** `boot3-before-play` and
`boot3-in-menu` — the saved file was fine until the game loaded its config.
That is the load order doing exactly what the bug report said it did.
`oldautoexec-13-boot3-max-fps-reverted-to-60.png` is the same screen as
`13-boot3-max-fps-still-30.png` with one number different.

`check-maxfps-transcript.mjs` classifies a transcript from its own contents —
every `[MAXFPS]` probe records what `autoexec.cfg` held at runtime — and says
which page it is scoring *before* it prints any check. Scoring the control
transcript with `--expect real` exits 1.

## Proving the checker can fail

```
node docs/evidence/m4-config-precedence/prove-maxfps-checks-can-fail.mjs \
     docs/evidence/m4-config-precedence/chrome-console.log
```

14 cases: one **control that is expected to pass** (the unmutated transcript —
without it, every "the mutation caused this" claim below would be unfounded)
and 13 mutations, one per check, each of which must make the checker name *that
specific check* in its FAILED list. `prove.asrun` is the output. Every input it
feeds the checker is fabricated; it establishes that the instrument has a
needle that moves, and nothing else.

---

## Gate 2 — bytes: the dedicated server is unchanged

```
source deps/emsdk/emsdk_env.sh
node docs/evidence/m4-config-precedence/check-dedicated-byte-identity.mjs
```

10 checks, 8 controls, output in `byte-identity.asrun`. It builds the server,
then compares each edited object against a base compiled **from the pre-task
source at `56df579d`, with the flags extracted from `web/Makefile` itself** via
`make -n -B`. Nothing about the flags is hardcoded, and no object md5 is
hardcoded — those are properties of whichever emsdk sits in `deps/`.

### Two things this gate measured that were not known before

**1. What actually perturbs an object's md5 is the source *filename*, not the
path.** The task brief warned that "a different path changes the md5 on its
own". Measured, at `-O2` with no `-g`:

| compiled as | md5 | size |
|---|---|---|
| `src/render/rSysdep.cpp` | `1022f9ec…` | 20567 |
| `<scratch>/a/rSysdep.cpp` | `1022f9ec…` | 20567 |
| `<scratch>/deep/deeper/rSysdep.cpp` | `1022f9ec…` | 20567 |
| `<scratch>/a/rSysdeq.cpp` | `950e1256…` | 20567 |
| `<scratch>/a/zzzzzzz.cpp` | `1542354c…` | 20567 |

The directory does not matter and neither does `-o`; the basename does, at
identical size. This is not pedantry — an earlier draft of the checker named
its scratch copies `unguarded-sr_maxFPS.cpp`, which made its control differ
from base for two reasons at once and made its byte delta meaningless. CONTROL
2 and CONTROL 2b re-measure both halves of this on every run. The practical
consequence is good: controls can be built entirely in a scratch directory, so
a crashed run can never leave `src/` modified.

**2. The size half of the invariant would not have caught this bug.** CONTROL
1b weakens the guard to `#if defined( __EMSCRIPTEN__ )` — the mistake a hurried
version of this task would actually make, since `__EMSCRIPTEN__` reads like
"the web build" — and relinks the server with the resulting objects. The
result is a wasm of **exactly 2,488,298 bytes with a different md5**. Both
edits rewrite the initialiser of an `i32` that already exists in the data
segment, so nothing changes length.

> **Quote the invariant as "2,488,298 bytes *and* md5 `9718a2a6…`".** A
> size-only check passes a dedicated server that has silently had its frame cap
> and audio buffer changed.

---

## What is still an override, and why

`grep -vE '^\s*#|^\s*$' web/webdefaults/autoexec.cfg` now yields six settings:

| setting | why it is allowed to stay |
|---|---|
| `INFINITY_PLANE 0`, `USE_DISPLAYLISTS 0` | correctness, not preference. A saved config must not turn them on. |
| `CONSOLE_LADDER_LOG 1`, `SP_LIMIT_ROUNDS 3` | `tSettingItem`, so never written back to `user.cfg` — there is no player choice for them to overwrite. |
| `SP_NUM_AIS 3`, `SP_AUTO_AIS 0` | **same defect, left in place deliberately.** |

The last row is a real finding and not a clean one. Both are `tConfItem`
(`gGame.cpp`), and `gGameSettings::Menu()` is reachable on the `singlePlayer`
object through `GameSettingsSP()`, so a player who changes the opponent count
keeps it only until the next load — exactly the bug this task fixed for
`MAX_FPS`. They are left as hard overrides because they are what pins the M2/M3
gates to "three AIs" regardless of the saved profile a run starts from, and a
gate whose opponent count depended on a persisted config would not be a fixed
experiment. If the `SP_*` settings ever stop being gate scaffolding, they
should move the same way these two did.

---

## Files

| file | what it is |
|---|---|
| `check-dedicated-byte-identity.mjs` | gate 1 of 2: the server is unchanged. 10 checks, 8 controls. |
| `check-maxfps-transcript.mjs` | gate 2 of 2: scores a transcript, real or control. |
| `prove-maxfps-checks-can-fail.mjs` | 1 passing control + 13 mutations against the checker. |
| `chrome-console.log`, `firefox-console.log` | the real runs. |
| `oldautoexec-chrome-console.log` | the control run — fix undone, same wasm. |
| `01…14-*.png` | every navigation step of the Chrome run. |
| `13-boot3-max-fps-still-30.png` | the headline: FPS Limit 30 after two reloads. |
| `oldautoexec-13-boot3-max-fps-reverted-to-60.png` | the same screen on the control: 60. |
| `firefox-13-boot3-max-fps-still-30.png` | Firefox agrees. |
| `*.asrun` | the recorded output of each of the above. |
| `maxfps-precedence.steps.asrun` | the steps file as it was when these ran. |
