# M4 — Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's settings and key bindings survive a page reload, in Chrome and Firefox.

**Architecture:** No new subsystems and — for the persistence half — **no C++ at all**. Mount Emscripten's IDBFS at `/persist` with `autoPersist: true`; the game's existing `st_SaveConfig` already writes `/persist/var/user.cfg` through a `std::ofstream`, and that stream's destructor closes the fd, which is exactly IDBFS's persist trigger. The work is a mount, an awaited populate, two link flags, one new save point, and a config-precedence fix that is unrelated to persistence but becomes a live bug the moment persistence works.

**Tech Stack:** Unchanged — Emscripten 6.0.8, SDL 1.2 emulation, Asyncify, `-lidbfs.js`.

## Global Constraints

- **`make -f web/Makefile dedicated` must still produce EXACTLY 2,488,298 bytes AND md5 `9718a2a64978cb6e9b95ea2f0454cca5`.** **Size alone is not sufficient and never was** — corrected in Task 3, by measurement rather than argument: an *unguarded* build of Task 3's change links to **exactly 2,488,298 bytes with md5 `830a19dcd0687ad1a1f4101a457349f0`, size delta zero**, because both edits rewrite `i32` initialisers that already exist so nothing changes length. The recorded control is `docs/evidence/m4-config-precedence/byte-identity.asrun`. Every milestone since M0 has quoted this tripwire as a size; **always quote the md5 with it.**
- Guard game-source changes: `#ifdef __EMSCRIPTEN__`, or `#if !defined(DEDICATED) && defined(__EMSCRIPTEN__)` where the file **also compiles into the dedicated build**. `web/Makefile` wildcards all six source directories for both targets, so assume any `src/` file does unless proven otherwise. Verify by compiling the object to a scratch path **at the same path with the same flags** and comparing md5 — a different path changes the md5 on its own.
- **Do NOT add `-O` at link.** `ASSERTIONS` is what makes this port's defect classes announce themselves.
- **Never call `SDL_Delay` in the client** — only sleeps in `ASYNCIFY_IMPORTS` (`docs/porting/browser-runtime-notes.md` §8).
- New files ONLY under `src/emscripten/`, `web/`, `deps/`, `docs/`.
- **Same-file citations in comments name a symbol, not a line number.** Line-number rot bit this project twice in M3; `eSound.cpp` states the rule inline.
- No automated test suite exists and none is to be created. Verification is command output and browser evidence.
- Work in `.worktrees/m4-persistence` on branch `m4-persistence`. Commit after every green step.

## What reconnaissance refuted — do not rebuild the plan's assumptions

`PLAN.md`'s M4 entry and `web/README.md` are wrong in five places. All measured.

1. **"`st_SaveConfig()` never runs on tab close" implies settings are never saved. The implication is false.** `st_SaveConfig` has eleven call sites; `sr_InitDisplay` and `lowlevel_sr_InitDisplay` (`rScreen.cpp`) call it **unconditionally twice on every boot**, and again on every resolution change — it is a deliberate crash-detector persisting `FAILED_ATTEMPTS`. The `SDL_QUIT` path in `filter` is one lost site out of eleven. **The real gap is narrower: no save follows a settings-menu change.** Restate the cause, do not repeat it.
2. **The key-name table is NOT a deferred item.** `su_EmscriptenKeyName` has been in `uInput.cpp` since M2 task 6 (`422dfb2b`, 2026-08-27 19:46), wired into `keyname()` under the correct guard. `web/README.md` declared it outstanding in `5f09142e` at 21:31 the same day — **1h45m after the fix landed in the same tree.** The line was never true. Delete it.
3. **`pagehide` is NOT the safer unload hook — it is strictly worse.** Measured twice: the handler provably runs (proved with `sessionStorage`), the write reaches MEMFS, and the data is **lost**, because `queuePersist`'s `setTimeout(0)` never gets serviced. `beforeunload` works where `pagehide` does not. Do not "improve" this later.
4. **`autoPersist` does not cover the unload path reliably.** It survives at 50 KB and 500 KB of delta and loses **everything in the batch** at 2 MB — including small files written in the same handler, because `queuePersist` batches the whole mount into one transaction. An explicit `FS.syncfs` does **not** rescue it. It is the *delta* that matters, not the mount size (2 MB written mid-run persists fine, and a later small write on top of it survives).
5. **The resolution menu works.** Measured: four mode changes, canvas resizes, GL context and textures survive (`texAlive=1`), `glGetError()` clean, `SDL_VideoModeOK` returns 32, and `SDL_ListModes` returning −1 makes the menu populate correctly. **Do not hide it.**

## Known landmines — measured, not inferred

1. **`FS.syncfs(true, …)` — the populate — is asynchronous, and `web/shell.html` calls `Module.callMain(...)` synchronously from the Play button.** Mount without awaiting the populate and `st_LoadConfig` reads an empty `/persist` on every boot: saves keep working, nothing is ever read back, **and the failure looks exactly like success from the inside.** Measured populate times were 3–160 ms, so the bug is intermittent rather than absent — the worst kind. Task 4's A2 assertion is what catches it.
2. **Re-entering wasm from a JS event handler is safe only for non-yielding exports.** Measured `Asyncify.state == 0` (`State.Normal`) while the module is parked in `emscripten_sleep`, in both engines, including from inside `beforeunload`. `st_SaveConfig` does not yield — `std::ofstream` plus `tConfItemBase::SaveAll`, nothing sleeps. **If anything on that path ever sleeps it would start a second unwind on top of a live one and corrupt Asyncify.** Whatever wrapper M4 adds must carry that warning.
3. **From boot 2, `user.cfg` is the sole source of key bindings**, because `default.cfg` only loads while `st_FirstUse` is true and `/data/webdefaults` replaces rather than merges. Combined with `sr_InitDisplay` re-persisting unconditionally, **an incomplete save is self-perpetuating**. Escape hatch if a run wedges: `$misc_initial_menu_title` re-runs First Setup.
4. **Every boot-1 save happens *before* `welcome()` sets `st_FirstUse = false`.** So a mount alone is not enough — boot 2 would still replay the first-use wizard.
5. **The `autoexec.cfg` precedence problem cannot be fixed by re-ordering.** `Load( var, "user.cfg" )` is the **first** load in `st_LoadConfig`; `autoexec.cfg` is the **last**. There is no earlier slot for `user.cfg`. Verified by reading the load order.
6. **`rViewport.cpp:246` is a latent abort reachable via the viewport-configuration screen in the settings menu.** M4 makes the settings menu the most-travelled screen in the gate. Avoid the viewport screen, or expect to meet it.
7. **`EXPORTED_RUNTIME_METHODS` is a plain assignment.** Extend the existing `=callMain`; adding a second `-s` flag drops `callMain` and the Play button aborts. The Makefile's own comment records that failure mode.

---

### Task 1: Mount `/persist`, and prove a reload reads it back

**Files:** Modify `web/Makefile`, `web/shell.html`

**Interfaces:** Produces a client whose `/persist` is IndexedDB-backed and populated before `main()` runs. Consumes nothing. Produces the mount that every later task depends on.

- [ ] **Step 1: Add the link flags**

`-lidbfs.js` and an **extension** of the existing `EXPORTED_RUNTIME_METHODS` to include `FS` and `IDBFS`, both in `CLIENT_LDFLAGS` only. Verify `CLIENT_LDFLAGS` is not used by the `dedicated` target before you touch it, and say so in your report.

- [ ] **Step 2: Mount before `callMain`, and await the populate**

`web/shell.html:150` already carries a comment saying `/persist` becomes an IDBFS mount in M4 — M1 left the hook deliberately. Mount with `autoPersist: true`, then `FS.syncfs(true, …)` and **await it** before `Module.callMain(...)`. Landmine 1 is the whole point of this step: a synchronous `callMain` after an un-awaited populate is a silent, intermittent no-op.

- [ ] **Step 3: Prove the round-trip**

Write something to `/persist`, reload, read it back. The drivers can reload (`eval:location.reload()`); the transcript is cumulative, so partition at a `mark:`.

- [ ] **Step 4: Prove it can fail**

`Module.IDBFS.quit(); indexedDB.deleteDatabase('/persist')` → the assertion must fail. **Without the `quit()` the delete returns `BLOCKED` and the test passes by a race** — do not write it that way.

- [ ] **Step 5: Verify the invariants and commit**

Dedicated wasm still exactly 2,488,298 bytes. No `src/` file was touched in this task; say so.

---

### Task 2: Save when the player changes something

**Files:** Modify `src/ui/` or `src/tron/` (the settings-menu exit path), `web/shell.html`

**Interfaces:** Consumes Task 1's mount. Produces a client where a setting changed in a menu is durable.

- [ ] **Step 1: Find the menu-exit path and add the save**

The honest primary mechanism, because it runs while the game is live and needs no browser guarantee. This is the regime that measured reliable. Guard it; find out whether the file compiles into the dedicated build and use the right guard form.

- [ ] **Step 2: Add the backstop, and do not rely on it**

`visibilitychange` → hidden is the one hook that fires before a mobile tab is discarded, while the page is still fully alive. Add `beforeunload` too. **Reject `pagehide`** — refutation 3. Neither may be load-bearing in the gate, and the code comment must say why.

- [ ] **Step 3: Carry landmine 2's warning into the wrapper**

Whatever the shell calls must not yield. Say it where someone would add a sleep.

- [ ] **Step 4: Verify**

Change a setting, reload, confirm it survived — without touching the resolution menu, which already saves and would mask the result.

---

### Task 3: Stop `autoexec.cfg` overriding the player

**Files:** Modify `web/webdefaults/autoexec.cfg`, `src/render/rSysdep.cpp`, `src/engine/eSound.cpp`

**Interfaces:** Consumes nothing. Independent of Tasks 1–2, but only becomes a *visible* bug once they land.

**This is the only part of M4 that touches the byte constraint — not persistence.** Say so in your report.

- [ ] **Step 1: Delete the two settings from `autoexec.cfg`**

`MAX_FPS 60` and `SOUND_BUFFER_SHIFT 1`. Both are menu-reachable, both currently unchangeable by the player, and `autoexec.cfg` loads last (landmine 5). Leave `INFINITY_PLANE` and `USE_DISPLAYLISTS` — those are *meant* to be hard overrides.

- [ ] **Step 2: Set them as compiled defaults under the guard**

`#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )`. Then they are defaults: they apply absent a `user.cfg`, and the player's choice wins the moment one exists. Keep M3's measured `SOUND_BUFFER_SHIFT` reasoning findable from the new site — the table lives in `autoexec.cfg` today and must not be lost with the line.

- [ ] **Step 3: Verify byte-identity, twice**

Both files compile into the dedicated server. Compile each object with the same flags to a scratch location, compare md5 against base, and confirm the dedicated wasm is still exactly 2,488,298 bytes **and md5 `9718a2a64978cb6e9b95ea2f0454cca5`** — see the Global Constraints for why the size alone would not catch this.

> **CORRECTED IN TASK 3 — the original wording here said "compile each object at the **same path**", and that reason was wrong.** Measured, twice, independently: two different `-o` paths produce **identical** object md5s, so the output path is irrelevant. What perturbs the object is the **source basename** — the same content compiled under a different filename gives a different md5 at an identical size. Keeping the same path happened to work because it keeps the basename; but anyone who followed the stated reason by copying the source to a scratch *file* would have silently measured the rename instead of the change. Task 3's first control did exactly that and caught it. **Hold the basename constant; the directory and the `-o` do not matter.**

- [ ] **Step 4: Verify the behaviour**

A player-chosen `MAX_FPS` must survive a reload now. That is the whole point of the task.

---

### Task 4: The gate

**Files:** `web/tools/` (a steps file, driver changes if needed); create `docs/evidence/m4-persistence/`

**Interfaces:** Consumes Tasks 1–3. Produces the milestone's evidence.

- [ ] **Step 1: Assert three things, and say what none of them prove**

**A1** — canvas dimensions after reload match the resolution chosen before it. Externally observable, and the save path already exists. **A2** — boot 2 skips the first-use path (this is what catches landmine 1's intermittent no-op). **A3** — the game still steers on boot 2, which is the **only** test of the keycode round-trip, since `default.cfg`/`keys_*.cfg` no longer load from boot 2 (landmine 3).

- [ ] **Step 2: Build the negative control**

`Module.IDBFS.quit(); indexedDB.deleteDatabase('/persist')`, measured working: returns `"deleted"`, `databases() === []`, assertion fails. Follow M3's pattern — `docs/evidence/m3-audio/check-audio-transcript.mjs` and `prove-checks-can-fail.mjs`. **Prove every assertion can fail** before trusting it.

- [ ] **Step 3: Both browsers**, and avoid the viewport screen (landmine 6).

- [ ] **Step 4: Commit the evidence**, labelled as what it actually shows.

---

### Task 5: M4 exit

**Files:** `web/README.md`, `README.md`, `PLAN.md`, `src/tron/gArmagetron.cpp`; this plan

- [ ] **Step 1: Verify from a clean rebuild** — dedicated still 2,488,298 bytes **and md5 `9718a2a64978cb6e9b95ea2f0454cca5`** (size alone would not catch Task 3's class of change — see Global Constraints), gate passes in both browsers.

- [ ] **Step 2: Delete the two false items in `web/README.md`** — the key-name item (refutation 2, never true) and the stated *cause* of "nothing persists" (refutation 1). Restate the latter as: the save runs, there was nowhere durable for it to land, and no save point followed a settings change.

- [ ] **Step 3: Correct the comment in `gArmagetron.cpp`'s `SDL_SetEventFilter` block.** It says the `st_SaveConfig` in `filter` "is what saves settings when the window closes", which seeded this plan's wrong premise. It also cites a bare line number, which this milestone's rules forbid — name `filter` instead.

- [ ] **Step 4: Annotate `PLAN.md` and this plan wherever M4 proved them wrong.** Inline, never delete.

- [ ] **Step 5: Record what M5 inherits.** At minimum: the `beforeunload` payload cliff, the latent `rViewport.cpp` abort now sitting in a well-travelled screen, and M3's open items.

- [ ] **Step 6: Commit, then STOP.** Do not merge or open a PR — a whole-branch review runs first, then the integration decision goes to the user.
