# M4 Task 2 evidence: a setting the player changed survives a reload

M4 Task 1 made `/persist` IndexedDB-backed and proved that **bytes** written
during one page load are readable after a `location.reload()`. Its gate says so
explicitly and says what it does not cover: *"Nothing about the game USING the
restored settings."* It also got its write for free — `rScreen.cpp`'s
`sr_InitDisplay` / `lowlevel_sr_InitDisplay` call `st_SaveConfig()`
unconditionally on every boot, as a crash detector.

This directory is about the thing that was missing: **a save caused by the
player**. Before this task, `st_SaveConfig` had eleven call sites and not one
of them ran because someone changed a setting. The in-memory config was
authoritative and got flushed at moments unrelated to when the player edited
it; in between, every edit was volatile.

The mechanism is `src/emscripten/eWebPersist.cpp`: a `uCallbackMenuLeave`
registration that calls `st_SaveConfig()`. `uMenu::OnEnter` fires
`uCallbackMenuLeave::MenuLeave()` on the way out of every menu.

---

## The one-paragraph result

On a fresh browser profile, typing five characters into the "Name:" field of
the First Setup menu changes what is on screen and changes nothing on disk —
`/persist/var/user.cfg` stays byte-identical, hash and all. Pressing Escape
prints one `[PERSISTSAVE] menu-leave` line and rewrites the file with
`PLAYER_1 web_userqzxjv`; a direct read of IndexedDB's `FILE_DATA` store, over
a connection the gate opens itself and **before any unload event has fired**,
finds the same 21 955 bytes. After a real reload, a page that has written
nothing reads the value back — and when the gate then destroys `user.cfg` from
JavaScript and leaves a menu again, the game rewrites the whole 22 763-byte
config from its own memory with the name intact, which bytes surviving on disk
cannot explain. (That last step shows `st_LoadConfig` parsed the value into the
running program. It is *not* attributable to this task's mechanism — see the
S13 note below.)

Separately, and closer to what a player would call settings: in
System Setup → Misc Stuff, toggling **Menu Wrap** leaves `WRAP_MENU 1` in the
file while the menu is open, writes `WRAP_MENU 0` on Escape, and the menu still
reads "Menu Wrap: Off" two page loads later.

---

## How to re-run it

```sh
source deps/emsdk/emsdk_env.sh
make -f web/Makefile client client-control -j8
node docs/evidence/m4-persist-settings/make-settings-control-pages.mjs

python3 -m http.server 8000 --directory web/dist-m1 &

# the gate, both engines
node web/tools/drive-browser.mjs --headed --out /tmp/set-chrome \
     --script-file web/tools/persist-settings-gate.steps
node web/tools/drive-firefox.mjs           --out /tmp/set-firefox \
     --script-file web/tools/persist-settings-gate.steps
node docs/evidence/m4-persist-settings/check-settings-transcript.mjs \
     /tmp/set-chrome/console.log

# every check can fail
node docs/evidence/m4-persist-settings/prove-settings-checks-can-fail.mjs

kill %1
```

`--headed` is required for Chrome: this script presses keys, and headless
Chrome 152 floods the page with thousands of spurious keydown events per real
keypress (see `web/tools/drive-browser.mjs`). Firefox headless is fine.

---

## The control matrix — measured, not predicted

Two independent mechanisms, so four pages. Every row was run; every transcript
is in this directory.

| page | menu-leave save | JS backstop | result |
| --- | --- | --- | --- |
| `armagetronad.html` (Chrome) | yes | yes | **PASS 18/18** |
| `armagetronad.html` (Firefox) | yes | yes | **PASS 18/18** |
| `armagetronad-nobackstop.html` | yes | **no** | **PASS 18/18** |
| `armagetronad-nomenusave.html` | **no** | yes | FAIL — S6 S7 S8 S12 S16 |
| `armagetronad-nomenusave-nobackstop.html` | **no** | **no** | FAIL — the above plus S10 S13 |

**Row 3 is the one that matters most**, and it proves a negative: the gate
passes with both unload handlers disabled. That is what "the backstop is not
load-bearing" means as a fact rather than an intention. Check S9 covers the
pre-reload half of that claim from a single transcript; only this control
covers the post-reload half.

**Rows 4 and 5 need a second link, not a page edit**, because the mechanism
they remove lives in the wasm. `web/Makefile`'s `client-control` target builds
`armagetronad-nomenusave.{html,js,wasm,data}` with the `uCallbackMenuLeave`
registration compiled out — a real browser running a real game without this
task's mechanism. Both rows are slow on purpose: four of the gate's `until:`
steps can never be satisfied, so budget ~2 minutes of deliberate timeout, which
is itself check S16.

### Two things rows 4 and 5 measured that had not been predicted

**S10 passes on `nomenusave`.** With no in-game save at all, the player's name
still survives the reload — because `beforeunload` caught it. That is the
backstop working, in a real browser, with nothing synthetic about it, and it is
the only place in this evidence set where it is seen to do so end to end.

**S13 also passes on `nomenusave`, and should not be read as evidence for this
task.** S13 says the restored value is in the running program's *memory*, and
any save at all will demonstrate that once the file has been clobbered. On that
page the backstop had persisted `FIRST_USE 0`, so boot 2 opens on the main
menu — and Escape on the top-level main menu is *Quit*: `MainMenu()` returns
and the shutdown path that follows calls `st_SaveConfig()` unconditionally, a
pre-existing call site, so the clobbered file is rewritten whether or not this
task exists. **S12**, which counts `[PERSISTSAVE] menu-leave` lines between two
marks, is the check that is about the mechanism. On row 5, where boot 2 opens
on the language menu instead, S13 does flip.

That shutdown is also why the gate's screenshots `08` and `09` are a **black
canvas** on the main-menu branch. It is the program having exited cleanly, not
a crash — the transcript carries `SDL_QuitSubSystem called (and ignored)` and
`SDL_Quit called (and ignored)` immediately after the menu-leave save, and
every assertion the gate makes has already been made by then. The
last-rendered-frame illusion is worth naming too: with `preserveDrawingBuffer`
on, a screenshot taken ~1.5 s after the Escape can still show the main menu,
because the buffer has not been cleared yet. An earlier revision of the gate
read that stale frame as "the menu was re-entered".

---

## Which setting the gate uses, and why that one

The player's **name**, typed into "Name:" in the First Setup menu. It is a
`uMenuItemString` bound directly to `ePlayer::name`, which is the target of the
`tConfItemLine` `PLAYER_1` (`src/engine/ePlayer.cpp`), so it is a real
configuration item written into `user.cfg` by `tConfItemBase::SaveAll`.

* **Its menu path does not already save.** Nothing between leaving First Setup
  and the end of the first-use flow calls `st_SaveConfig`. Not an assumption —
  the `nomenusave` control loses the name entirely.
* **The resolution menu was excluded for the opposite reason.**
  `lowlevel_sr_InitDisplay` saves on every mode change, so a resolution test
  would pass whether or not this task's work exists.
* **The display settings submenu is never visited**, because it leads to the
  viewport configuration screen, a latent abort in this port
  (`src/render/rViewport.cpp`).
* **It is two keystrokes from a fresh profile**, so the gate is two page loads
  and about a minute with no gameplay. Reaching the real main menu instead
  would mean driving the entire first-use tutorial match first
  (`gArmagetron.cpp` runs `sg_SinglePlayerGame` before `welcome()` returns).

The generalisation to other menus rests on the fact that every
configuration-editing `uMenuItem` in this tree holds a raw pointer to the same
variable its `tConfItem` wraps — and on the Misc Stuff demonstration below,
which does it on a menu a player would actually call "settings".

---

## The known limitation, stated plainly

**A menu whose caller applies the player's choice AFTER the menu closes is not
covered by a menu-leave save.** In this tree that is exactly one menu: First
Setup. `sg_StartupPlayerMenu` reads its Colour, Controls and Connection items
out of *local variables* after `firstSetup.Enter()` returns, so the save that
fires on the way out has not seen them. Its Name field — the one the gate uses
— binds straight to `ePlayer::name` and is covered. Every other configuration
menu in the game binds directly too.

The same gap swallows `FIRST_USE`. `gArmagetron.cpp`'s `welcome()` sets
`st_FirstUse = false` only after `sg_StartupPlayerMenu` returns, and the next
screen is a `uMenu::Message` — which is a static function with its own event
loop and never fires `uCallbackMenuLeave`. Measured, on the real page:

```
boot1-after-menu-leave   21955 bytes  FIRST_USE 1   <- the menu-leave save
[PERSISTSAVE] js-backstop                           <- fires on location.reload()
boot2-before-play        22763 bytes  FIRST_USE 0   <- the backstop's save
```

The extra ~800 bytes are the keyboard template `sg_StartupPlayerMenu` applies
after the menu closes. So `armagetronad.html` opens boot 2 on the **main
menu** and `armagetronad-nobackstop.html` opens it on the **language menu**.
The gate is written so that this does not matter: after the reload it presses
no key but Escape, and Escape leaves whichever menu is up.

This is not self-perpetuating in the way M4's recon warned about. The keyboard
template lands in memory immediately before `FIRST_USE` flips, so every save
that could write `FIRST_USE 0` also writes the bindings; there is no state in
which the game skips first setup *and* has no keys.

---

## Files

| file | what it is |
| --- | --- |
| `check-settings-transcript.mjs` | the checker. 17 transcript checks (S1–S17) plus SZ, a guard on the checker's own source. Exit 0 or 1. |
| `prove-settings-checks-can-fail.mjs` | 18 targeted transcript mutations, one per check plus a second for S8's timing clause, each declaring the full set of ids it expects to flip. Runs the real checker as a child process. |
| `make-settings-control-pages.mjs` | writes the two backstop-disabled control pages by literal text substitution on the generated HTML. |
| `chrome-console.log` | the gate on the real page, Chrome. PASS 18/18. |
| `firefox-console.log` | the gate on the real page, Firefox. PASS 18/18. |
| `nobackstop-chrome-console.log` | the gate with both unload handlers disabled. PASS 18/18 — the control that must pass. |
| `nomenusave-chrome-console.log` | the gate against a build without the menu-leave save. FAIL. |
| `nomenusave-nobackstop-chrome-console.log` | both removed. FAIL, harder. |
| `settingsmenu-chrome-console.log` | the Misc Stuff → Menu Wrap demonstration, three page loads. |
| `backstop-chrome-console.log` | the `visibilitychange` demonstration. |
| `persist-settings-gate.steps.asrun` | the gate script exactly as run for the transcripts here. |
| `chrome-*.png` | the gate's screenshots, Chrome. `08` and `09` are black on purpose — see the shutdown note above. |
| `firefox-0*.png` | the three that carry the claim in Firefox. |
| `settingsmenu-*.png` | the Misc Stuff toggle, before / after / after a reload. |
| `backstop-*.png` | the game still running after being re-entered from a JS event handler. |

---

## The supplementary demonstrations, and what they are not

Neither has a checker, on purpose. The gate is the gate; giving these a
pass/fail verdict would invite someone to start treating the backstop as
load-bearing.

### `web/tools/persist-settings-menu.steps` — the real Settings menu

Three page loads. Boot 1 walks the first-use flow far enough to get
`FIRST_USE 0` persisted; boot 2 navigates main menu → System Setup → Misc Stuff
and toggles Menu Wrap; boot 3 checks it stuck.

```
boot2-main-menu            WRAP_MENU 1
before-toggle              WRAP_MENU 1
toggled-menu-still-open    WRAP_MENU 1   <- the toggle is in memory only
[PERSISTSAVE] menu-leave                 <- Escape leaves Misc Stuff
after-menu-leave           WRAP_MENU 0
--- reload ---
boot3-before-play          WRAP_MENU 0
```

and the menu itself reads "Menu Wrap: Off" in boot 3
(`settingsmenu-12-boot3-menu-wrap-still-off.png`).

It is **not** the gate because getting to the main menu at all requires
`FIRST_USE 0`, which on this build only boot 1's `beforeunload` backstop
writes — so it works on `armagetronad.html` and would behave differently on
`armagetronad-nobackstop.html`. The gate must not have that property; a
demonstration may.

Menu Wrap was chosen because toggling it has no side effect beyond cursor
behaviour, unlike its neighbours Moviepack (reloads textures) and Text Output
(turns on console rendering).

### `web/tools/persist-backstop.steps` — the visibility path

The one case the primary mechanism cannot cover: the player changes a setting
and never leaves the menu.

```
typed-menu-still-open              PLAYER_1 web_user      21950 bytes
[PERSISTSAVE] js-backstop
[PERSISTBACKSTOP] visibilitychange-hidden
after-synthetic-visibilitychange   PLAYER_1 web_userbkw   21953 bytes
```

**The event is dispatched synthetically here** — the script overrides
`document.visibilityState` and fires the event itself. That is an honest test
of the *handler*: that it calls into wasm, that the call does not corrupt the
Asyncify state the module is parked in, and that a save really lands. It is
**not** a test of the browser's page-lifecycle behaviour, in the same way that
a synthetic click is not a user gesture. Whether a real hidden or discarded tab
services the `setTimeout(0)` that carries the write to IndexedDB remains
**reasoned** — `hidden` fires while the page is still fully alive and still has
an event loop — not measured. `web/shell.html` says so too.

The run also presses two more keys afterwards and screenshots the result, which
is the only way a transcript can check the Asyncify claim: the module keeps
rendering and keeps responding to input after being re-entered from a JS event
handler.

---

## Why `pagehide` is rejected, and why `beforeunload` is only a backstop

Both are M4 recon measurements, carried into `web/shell.html` as comments so
they are not re-litigated:

* **`pagehide` is strictly worse than `beforeunload`, not safer** — the usual
  advice inverted. Measured twice: the handler provably runs (proved with
  `sessionStorage`), the write reaches MEMFS, and the data is **lost**, because
  `queuePersist`'s `setTimeout(0)` never gets serviced.
* **`beforeunload` has a payload cliff.** 50 KB of changed data survives;
  500 KB survives; **2 MB loses the entire batch**, including small files
  written in the same handler, because `libidbfs.js` syncs the whole mount in
  one transaction. An explicit `FS.syncfs` does not rescue it. It is the size
  of the *delta* that matters, not the mount. `user.cfg` is ~22 KB today, with
  no guarantee a future `/persist` stays on the safe side.

---

## The Asyncify rule, and why re-entering wasm here is safe

`aa_web_save_config` is the only thing the page calls into the module from an
event handler, and **nothing reached from it may yield**. This is a correctness
rule, not a style one, and getting it wrong produces no error message.

The client links `-sASYNCIFY=1`, so at the moment a JS handler runs the module
is almost always parked inside `emscripten_sleep` with a whole game call stack
saved in the Asyncify buffer. Re-entering is nevertheless safe for a
non-yielding export, and that was measured rather than assumed: M4 recon read
`Asyncify.state` during a `beforeunload` handler in both engines while the
module was parked, and found `0` (`State.Normal`) in both. A normal-state call
runs to completion on a fresh stack and returns.

A *yielding* call from there would start a second unwind on top of a live one.
Asyncify has one rewind buffer and one state word; the second unwind overwrites
both, and the first sleep then rewinds into a stack that no longer describes
the frames it saved. Silent corruption or an `unreachable` trap far from the
cause.

`st_SaveConfig` satisfies the rule today, and the reason is written down in
`src/emscripten/eWebPersist.cpp` so it can be re-checked rather than
re-assumed: its whole body is a `tPath::Open` and `tConfItemBase::SaveAll`, and
its one console-writing path is the `$config_file_write_error` else-branch.

---

## The dedicated server is untouched, and it was verified rather than argued

`web/Makefile`'s `$(SRCS)` wildcards six source directories into **both**
targets, so the new translation unit is named in `CLIENT_OBJS` only, and guards
its whole body with `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)` on top
of that. Editing `web/Makefile` invalidates every object in both trees, so the
check is a full rebuild rather than a relink:

```
rm -rf web/build-m0 web/dist-m0
make -f web/Makefile dedicated -j8      # all 100 translation units, from nothing
web/dist-m0/armagetronad-dedicated.wasm  2,488,298 bytes
md5                                      9718a2a64978cb6e9b95ea2f0454cca5
```

Byte-identical to the pin, and to the md5 taken before any of this task's
edits. This is stronger than the object-level md5 comparison the brief
suggested — that one exists because a partial rebuild can hide a change, and a
clean rebuild of the whole target cannot.
