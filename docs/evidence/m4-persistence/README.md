# M4 — the milestone gate

**The game a player leaves is the game they come back to.**

One script, three boots, twenty-one checks, both browsers, and a negative
control that destroys IndexedDB and takes exactly three of them down — one per
assertion.

Everything here is re-runnable. Nothing in it is an argument.

---

## Why this exists when three gates already do

`docs/evidence/` already holds three M4 gates, and each proves one *mechanism*:

| gate | proves |
|---|---|
| `m4-persist` | `/persist` is an IDBFS mount, populated **before** `main()` |
| `m4-persist-settings` | leaving a menu calls `st_SaveConfig`, and the value reaches IndexedDB before any unload event |
| `m4-config-precedence` | `autoexec.cfg` no longer overrides the player's saved choice |

None of them asserts the **milestone's** claim, which is not about any
mechanism. It is about what a returning player gets. This gate asserts that,
in three parts:

| | assertion | measured on |
|---|---|---|
| **A1** | the game comes back at the resolution the player picked | `canvas.width` / `canvas.height` — **outside the wasm** |
| **A2** | the boot after the first one skips the first-use path | a file **boot 3 itself wrote**, from its own memory |
| **A3** | the game still steers | the game's own `uActionTooltip` counters |

### A2 is not redundant with `m4-persist`, and this is the reason

`FS.syncfs(true, cb)` is asynchronous. If the populate is ever not awaited — a
future edit to the run dependency in `web/shell.html`'s `preRun`, say — then
`st_LoadConfig` reads an empty `/persist` and the first `st_SaveConfig` writes
a fresh file over the top.

**Saving keeps working.** Every `[PERSISTSAVE]` line still appears, the file
still lands in IndexedDB, and from inside the game the failure is
indistinguishable from success. What changes is that *every boot is a first
boot*. So A2 is checked on the game's behaviour, never on the save path.

### A3 is the only test of the keycode round trip in this project

`src/tools/tConfiguration.cpp` loads `default.cfg` only while `st_FirstUse` is
true, and `sg_StartupPlayerMenu` applies a `keys_*.cfg` template only on that
same path. **From boot 2 onward `user.cfg` is the sole source of every key
binding in the game.**

And the encoding changes in transit. `config/keys_cursor.cfg` spells the left
arrow `276` (SDL 1.2); `su_TranslateSDL12Keysym` in `src/ui/uInput.cpp`
re-encodes it to `1104` (SDL 2, as Emscripten's shim delivers it);
`tConfItem_key::WriteVal` writes back whatever is in `keymap[]`, i.e. the *new*
number. That function's comment claims the translation is idempotent and
therefore "survives M4's `user.cfg` round trip". **That claim had never been
tested.** M7 and M17 are the test, and the prover's M7 mutation is exactly the
failure it would have: `276` coming back instead of `1104`, in a file that
still looks perfectly well formed, on a key no keystroke can ever reach.

Measured, both browsers:

```
boot 1, after first setup:  59 KEYBOARD lines, left_binds [],              tooltips "0 2 1 1 1" / "0 3 1 1 1"
boot 2, before play:        79 KEYBOARD lines, left_binds ["1104","117"],  right_binds ["1103","111"]
```

---

## How A3 is observed, and the two ways that did not work

"The cycle turned" is easy to see and hard to assert. Three candidates were
considered and rejected, and all three reasons are recorded in
`web/tools/persistence-milestone-gate.steps` so nobody re-derives them.

* **Pixels.** A 32×24 grayscale thumbnail of the canvas at 10 Hz, scored as
  mean absolute difference between consecutive frames. A turn yaws the chase
  camera ~90° and does spike — but a round boundary, an explosion and a menu
  opening do too, and those alone already occupy the range a turn would have to
  be picked out of. In reconnaissance the series reached **23.9** in a window
  where *no key was pressed at all*, and **31.6** in one where a round boundary
  landed. Telling a turn from that needs a tuned threshold, which is not an
  observation.
* **`DEATH_SUICIDE`.** Steering into your own wall is logged (`gCycle.cpp`,
  `sg_deathSuicideWriter`). Rejected for a reason about the *signal*, not about
  the odds: **it is not a signature of turning at all.** `gCycle::KillAt`
  attributes a death to the player themself whenever no enemy influenced them
  recently — so driving straight into the rim is a suicide too. The event means
  "nobody else killed you", not "you turned". It is also one-shot and
  geometry-dependent, and the human's lifetime is not fixed: across five
  reconnaissance rounds, `NEW_ROUND` to death measured **6.5 s four times and
  9.4 s once** (`DEATH_FRAG` all five times, never `DEATH_SUICIDE`, in rounds
  where no key press landed while the cycle was alive).
* **The tutorial match**, which is gentle enough to steer in comfortably, is
  unreachable: `welcome()` runs it only while `st_FirstUse` is true, which is
  precisely the boot A3 is not about.

### What is used instead

`uActionTooltip` (`src/ui/uInput.h`) is a `tConfItemBase` holding one
activations-left count per player. `config/default.cfg` ships
`CYCLE_TURN_LEFT_TOOLTIP 0 2 1 1 1` and `CYCLE_TURN_RIGHT_TOOLTIP 0 3 1 1 1` —
2 and 3 for player 1. `uBindPlayer::DoActivate` decrements it, and **only when
the action was accepted**:

```c
ret = uPlayerPrototype::PlayerConfig(ePlayer-1)->Act(act,x);
if( ret && act && act->GetTooltip() && x > 0 )
    act->GetTooltip()->Count(ePlayer);
```

`uActionTooltip::WriteVal` writes it into `user.cfg`, so it is readable from
JavaScript. A decrement therefore means a key press reached `keymap[1104]`,
resolved to `CYCLE_TURN_LEFT` for player 1, **and was taken by a live cycle**.
A3 becomes a comparison of two integers rather than a judgement about a
picture — and it fails, rather than degrading, if the binding did not survive:
with no bind on 1104 there is no activation, no decrement, and the counter is
still 2. It also registers the turn **itself**, whether or not the cycle then
dies, which is what the two rejected candidates could not do.

`0 2 1 1 1` / `0 3 1 1 1` → **`0 0 1 1 1` / `0 0 1 1 1`** in both browsers.

**The game corroborates this on screen, in its own words.** The tooltip
mechanism exists to *show* the player which key does what, and it names the key
it read out of `keymap[]`. Before the counters were spent, a reconnaissance run
showed *"Press &lt;right&gt; or &lt;o&gt; to turn right."* — `275` and `111`
from `keys_cursor.cfg`, round-tripped. After they were spent,
`chrome-15-boot2-round1-after-steering.png` shows the *next* tooltip in the
queue instead: *"Press &lt;v&gt; or &lt;c&gt; to switch camera modes."* Neither
is machine-checkable — the tooltip is rendered, not printed — so no check
depends on it. It is a second pair of eyes on the same fact.

### The counters are also what makes A2's strongest check possible

`config/default.cfg` is the only source of the unspent `0 2 1 1 1`, and
`st_LoadConfig` loads it **only** under `st_FirstUse`. So a boot that has spent
the counters to 0, reloaded, and then **saved 0 again from its own memory** has
demonstrated that `default.cfg` was not re-read — i.e. that the first-use path
was skipped — from inside the running program, rather than by reading
`FIRST_USE` out of a file the game might have ignored. That is **M16**.

---

## The run

```
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out /tmp/mile-chrome \
     --script-file web/tools/persistence-milestone-gate.steps
node web/tools/drive-firefox.mjs           --out /tmp/mile-firefox \
     --script-file web/tools/persistence-milestone-gate.steps
node docs/evidence/m4-persistence/check-milestone-transcript.mjs \
     /tmp/mile-chrome/console.log
kill %1
```

`--headed` is required for Chrome and only for Chrome — headless Chrome 152
floods the page with spurious keydown events per real one, and this script is
made of key presses. Firefox ran headless. ~113 s per browser.

| boot | what happens | what it establishes |
|---|---|---|
| **1** | fresh profile, Play, language menu, Escape out of First Setup | the baseline: no `user.cfg` at all beforehand; afterwards `FIRST_USE 1`, 59 `KEYBOARD` lines, **no turn key bound yet**, counters unspent |
| **2** | main menu → System Setup → Display Settings → Screen Mode → pick 320×200 → Escape ×3 → Play Game → Start New Game → three rounds, steering with the arrow keys → in-game menu in and out | `FIRST_USE 0` read back; the arrow binds are there in the SDL-2 encoding; the choice is written by the menu exit; the counters are spent by live turns; **the canvas never changes** |
| **3** | Play, then Enter/Escape through the Play Game submenu to force a save | the canvas is **320×200**; the counters are still spent in a file boot 3 wrote |

### The choice is made by clamping, not by counting

`uMenuItemSelection::LeftRight` (`src/ui/uMenu.h`) **clamps** at both ends — it
does not wrap. The Screen Resolution list has fourteen entries — `rScreen.cpp`
offers fifteen rows and exactly one pair of them collapses, see below — sorted
ascending with the `0×0` "desktop" row last (`rScreenSize::Compare` treats
`width==0` as greater than everything), and the game boots on that row. So
twenty Lefts land on the *first* entry for any count from thirteen up, and a
run that loses a keystroke to a slow frame still selects the same resolution.

**What gets saved is the row, not the pixels**, and the transcript shows it:
`ARMAGETRON_SCREENMODE` comes back as **14**, `ArmageTron_Custom`, not the `1`
of `ArmageTron_320_200`. That is not a mis-selection.
`config/settings_visual.cfg` ships `CUSTOM_SCREEN_WIDTH 320` /
`CUSTOM_SCREEN_HEIGHT 200`, so the custom row *is* 320×200 here; `Compare`
deliberately ignores the `res` enum, so the two rows are equal and the
`std::set` keeps the one inserted first — and `gResMenEntry`'s loop runs from
`ArmageTron_Custom` downward.

`ARMAGETRON_SCREENMODE_W` and `_H` are saved too, but
`lowlevel_sr_InitDisplay` calls `res.UpdateSize()` before using them, which
overwrites both from the compiled table indexed by the enum. So the quantity
that crosses the reload is the player's **choice of row**, and the pixel count
is re-derived on the other side. Stable across runs because
`config/settings.cfg` — which includes `settings_visual.cfg` — is loaded on
*every* boot; only `default.cfg` is gated on `st_FirstUse`.

**Nothing presses "Apply Changes"**, so `sr_ReinitDisplay` never runs and boot
2's canvas stays 1024×768 (M11 asserts that across all five of its phases).
The only thing that ever resizes the canvas is boot 3's own startup. The menu
says as much on screen — see `chrome-09-boot2-resolution-now-320x200.png`:
*"Changes will be applied the next time you start Armagetron Advanced."*

---

## The result

| transcript | browser | page | verdict |
|---|---|---|---|
| `chrome-console.log` | Chrome 152, headed | `armagetronad.html` | **PASS 22/22** |
| `firefox-console.log` | Firefox 154, headless | `armagetronad.html` | **PASS 22/22** |
| `negative-chrome-console.log` | Chrome 152, headed | `armagetronad.html` | **FAIL 3 of 22** — M14 M16 M17 |

22 = 21 declared checks plus `MZ`, which is a guard on the checker's own source
rather than a check on the transcript.

The one-line payoff, from `chrome-console.log`:

```
PASS  M14  THE GAME CAME BACK AT THE RESOLUTION THE PLAYER PICKED:
           the canvas is 320x200 (320x200, was 1024x768 moments earlier)
```

### Which check belongs to which assertion

| | checks |
|---|---|
| **A1** | M9 M10 M11 M13 **M14** |
| **A2** | M6 M8 M15 **M16** |
| **A3** | M4 M5 M7 **M12** M17 |
| structure | M1 M2 M3 |
| run hygiene | M18 M19 M20 M21 |

The three in bold carry the most weight, and none is the obvious one:
**M14** is measured on the DOM, outside the wasm, against a 1024×768 baseline
taken moments earlier in the same page load. **M12** is A3 as an integer
comparison. **M16** reads a file boot 3 itself wrote.

---

## How every check is shown to be able to fail

An assertion never seen to fail is not evidence. Two mechanisms:

**1. A real negative control.**
`web/tools/persistence-milestone-negative.steps` is this same script with
**one executable line changed out of 132**: the `eval:location.reload()` before
boot 3 becomes a step that destroys the IndexedDB database. Same page, same
browser, same probes, same marks.

Verify the relationship rather than believing it — and do *not* use a plain
`diff`, which reports a dozen-odd hunks because the two header comments
interleave wherever a bare `#` line coincides:

```sh
strip() { grep -v '^[[:space:]]*#' "$1" | grep -v '^[[:space:]]*$'; }
diff <(strip web/tools/persistence-milestone-gate.steps) \
     <(strip web/tools/persistence-milestone-negative.steps)
```

which prints exactly one changed line, executable line 108 of 132.

**The wipe is recorded, not assumed.** `indexedDB.deleteDatabase('/persist')`
on its own does *not* work — the page still holds a connection, the request
fires `onblocked`, and the "negative" control passes for entirely the wrong
reason (measured in M4 task 1). So the step calls `Module.IDBFS.quit()` first
and prints what happened. From `negative-chrome-console.log`:

```
[MILEWIPE] {"quit":true,"queuePersist_neutered":true,"delete":"deleted","databases_after":[]}
```

`"deleted"`, not `"BLOCKED"`, and no databases left. The checker quotes that
line back **before** it prints a single verdict.

Boots 1 and 2 are untouched, so every check about them still passes and the
three that flip are attributable:

| check | assertion | what the control does to it |
|---|---|---|
| **M14** | A1 | canvas comes up 1024×768 — the chosen resolution is gone |
| **M16** | A2 | `default.cfg` is loaded again, **refilling** the counters to `0 2 1 1 1`, and boot 3's own save writes them back |
| **M17** | A3 | the bindings are gone: `left_binds []`, `right_binds []` |

The milestone's claim, falsified in all three of its parts, by one change to
one input. `negative-20-boot3-first-use-again.png` is the picture: the
**Language Settings** menu, at full 1024×768, where
`chrome-20-boot3-main-menu-at-320x200.png` has a 320×200 main menu.

**2. Transcript mutation**, for the eighteen checks the control cannot reach
and for the three it knocks out collaterally — a control that flips three
checks at once does not show that any *one* of them is wired to the field it
names.

```
node docs/evidence/m4-persistence/prove-milestone-checks-can-fail.mjs
```

**25 mutations for 21 checks**, all flipping exactly the set they declare, on
both the Chrome and the Firefox transcript. M4, M6, M7 and M10 each assert two
independent things and get **one mutation per conjunct** — because a mutation
that trips a *neighbouring* conjunct leaves the named predicate unexercised,
which is the defect M4 task 3's review found one level up.

The prover requires the observed failure set to **equal** the declared set, so
collateral must be declared. Exactly one mutation declares any, and it is a
real dependency rather than sloppiness: **M12 reads boot 1's unspent counters
as well as boot 2's spent ones**, because `0 0 1 1 1` is only evidence of a
*change* if the run is also shown to have started somewhere else. So falsifying
M5 necessarily takes M12 with it. The alternative — M12 asserting a bare
`0 0 1 1 1` — would pass on a build where the counters had never been anything
else.

`MZ` is not coverable and says so: all twenty-one `check()` calls in the
checker are unconditional top-level statements, so no input can stop one
running.

---

## The byte tripwire

This task adds no `src/` file and edits none, so the M0 dedicated server cannot
have moved — but "cannot have" is not a measurement. `byte-tripwire.asrun` is
the run, and it deletes the outputs first so a real link happens rather than a
`make` that reports itself up to date:

```
2488298
9718a2a64978cb6e9b95ea2f0454cca5
```

**2,488,298 bytes and md5 `9718a2a64978cb6e9b95ea2f0454cca5`.** Both are
quoted because M4 task 3 measured that the size alone is not sufficient — an
unguarded change linked to exactly that size with a different md5.

---

## What is not claimed

* **Nothing about which save mechanism did it.** This gate does not separate
  the menu-leave callback from the `beforeunload` backstop, and no check here
  may be read as doing so. `FIRST_USE 0` in particular reaches the file through
  the backstop: `gArmagetron.cpp` flips `st_FirstUse` after
  `sg_StartupPlayerMenu` returns and the next thing that runs is a
  `uMenu::Message`, which fires no `uCallbackMenuLeave`. That separation is
  `m4-persist-settings`'s job and it does it with a control **build**, which is
  stronger than anything this gate could do. The milestone's outcome depends on
  both mechanisms, and this gate is about the outcome.
* **One resolution, one keyboard template, one player.** Nothing here sweeps
  other menus, other `keys_*.cfg` layouts, or a second player's bindings.
* **Nothing about IndexedDB quota.** `/persist` also collects
  `var/ladderlog.txt` and `var/scorelog.txt`, which grow without bound;
  `web/shell.html` records that as known and unsolved.
* **A3 proves the arrow keys steer, not that every bound action works.** The
  two keys pressed in game are the arrows and Escape. Escape reaching the
  in-game menu (`chrome-18-boot2-ingame-menu.png`) is a second bind surviving
  the round trip — `default.cfg` binds keysym 27 to `INGAME_MENU` and
  `default.cfg` is not loaded on boot 2 — but no check asserts it.

### One idea that looked good and is not here

`sr_LoadDefaultConfig()` runs only on the first-use path and sets
`rSysDep::swapMode_` to `glFinish`, whose default is `glFlush`. Counting
`glFlush` against `glFinish` calls from JavaScript would have been a lovely
externally-observable A2 discriminator — the M2 gate already wraps both.

It does not work, and the reason is worth recording so it is not re-attempted:
`swapMode_` is itself a persisted setting (`gMenus.cpp`,
`tConfItem<rSysDep::rSwapMode> swapModeCI("SWAP_MODE", ...)`). Boot 1 saves
`glFinish` and boot 2 restores it, so the two boots are indistinguishable on
that measure — for the same reason the milestone works at all.

---

## Files

| file | what it is |
|---|---|
| `check-milestone-transcript.mjs` | the checker; exit 0/1, reads only the transcript |
| `prove-milestone-checks-can-fail.mjs` | 25 mutations, set-equality on the failure set |
| `chrome-console.log` | Chrome, headed — **PASS 22/22** |
| `firefox-console.log` | Firefox, headless — **PASS 22/22** |
| `negative-chrome-console.log` | the wipe — **FAIL 3 of 22**, and supposed to |
| `byte-tripwire.asrun` | the forced relink of the M0 dedicated server |
| `persistence-milestone-gate.steps.asrun` | the script exactly as run |
| `chrome-*.png` (12) | boot 1 first setup → boot 3 at 320×200 |
| `firefox-*.png` (3) | the three that carry A1 and A3 |
| `negative-20-boot3-first-use-again.png` | first setup, all over again |
