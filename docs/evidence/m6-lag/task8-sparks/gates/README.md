# The gates for the sparks change

Two runs against the build that ships `SPARKS 0` on touch devices, both on the
same relink of `web/dist-m1` (`web/shell.html` is embedded at link time, so the
binary under both runs is the one the change produced).

    python3 -m http.server 8007 --directory web/dist-m1 &
    node web/tools/drive-browser.mjs --headed --mobile 915,412,3 \
         --out /tmp/m6c-touch   --url http://localhost:8007/armagetronad.html \
         --script-file web/tools/touch-gate.steps
    node web/tools/drive-browser.mjs --headed \
         --out /tmp/m6c-desktop --url http://localhost:8007/armagetronad.html \
         --script-file web/tools/menu-gate.steps
    kill %1

The change is touch-only, so **neither run proves it alone**: one says the
setting arrives on a phone, the other says it does not arrive anywhere else.
Both assert it by reading `/data/webdefaults/autoexec.cfg` back through
`Module.FS` — what the game's config parser will see — rather than by trusting
the branch that wrote it.

| file | what it proves |
|---|---|
| `touch-gate-console.log` | the whole touch run: four boots, `T1b` plus every check the gate already had (`T2b`, `T3b`, `P1`–`P6`), ten rounds. Two `[EXCEPTION]` lines, both the script's own positive control; every 404 is `/favicon.ico`. |
| `desktop-menu-gate-console.log` | the desktop gate, `D1` included: ten screenshots, all ten different, zero `[EXCEPTION]`, one 404 and it is `/favicon.ico`. |
| `touch-00-language-menu-with-touch-controls.png` | the touch boot after the append — the game starts and the menus are up with `SPARKS 0` in the config. |
| `touch-03-round1-driving-with-sparks-off.png` | a round running under `SPARKS 0`. |

## T1b — the touch side

    [    286ms] [SPARKS] SPARKS 0 written to /data/webdefaults/autoexec.cfg before main() (touch device)

    [SPARKSGATE] T1b sparks-off-on-touch {"read":true,"err":null,"bytes":12746,
      "sparks_lines":1,"ends_with_sparks_0":true,
      "tail":"ROMSPEED 0.2\n\n# appended at runtime by web/shell.html: crash sparks off (touch device)\nSPARKS 0\n",
      "PASS":true}

`sparks_lines` counts `/^SPARKS\b/gm` and is **one**, so the append did not run
twice behind a last-one-wins parser; `ends_with_sparks_0` is the file ending
`\nSPARKS 0\n`, i.e. the setting is the last word on the subject. The line is
printed on **all four** boots of this run (286, 56020, 69036 and 82488 ms) —
each load starts from the pristine preloaded file and appends once.

## D1 — the desktop side

    [    278ms] [SPARKS] stock sparks, nothing written

    [SPARKSGATE] D1 desktop-autoexec-untouched {"read":true,"err":null,"bytes":12376,
      "sparks_occurrences":0,
      "tail":"time visitor sees.\nSP_NUM_AIS 3\nSP_AUTO_AIS 0\nSP_LIMIT_ROUNDS 3\n",
      "PASS":true}

Zero occurrences of `SPARKS` anywhere in the file — not the setting and not the
comment the touch path writes above it — and the file ends on
`SP_LIMIT_ROUNDS 3`, which is the last line `web/webdefaults/autoexec.cfg`
ships. The 370-byte difference between the two runs (12746 against 12376) is
the camera block and the sparks block, both of which exist only on touch.

## Everything else the two gates check, unchanged

All nine `PASS` flags in the touch run are true — `T1b`, `T2b`, `T3b`, `P1`,
`P2/P3`, `P5`, `P4`, `P6 precondition`, `P6 ask-dropped` — and the steering
witness is spent the way it always is: `CYCLE_TURN_LEFT_TOOLTIP` and
`CYCLE_TURN_RIGHT_TOOLTIP` both reach `0 0 1 1 1` by round 3, from taps alone.
The desktop run's ten screenshots have ten distinct checksums.

**What these runs do not show.** They are correctness, not performance: the
frame-time numbers this change was made for are in the directories beside this
one, and they were measured on a desktop rig at a phone's pixel count. Nothing
here is a phone.

---

# Round 2: `?sparks=1` had to write, and T1c is the proof

**The defect, from the maintainer's phone: "`?sparks=1` does not bring the
sparks back."** The version above shipped `?sparks=1` as *silence* — skip the
touch default, write nothing — on the model of `?cam=1`. That is wrong for this
setting, and the reason is a one-word difference in the C++:

- `SPARKS` is a `tConfItem`, and `tConfItemBase::Save()` returns **true**
  (`src/tools/tConfiguration.h:296`), so `st_SaveConfig` writes it into
  `/persist/var/user.cfg`. `SaveAll` right-aligns the title in a 28-column field
  (`tConfiguration.cpp:473`), so the line reads `"                      SPARKS 0"`.
  This page saves on every menu leave, so **one** touch session is enough to put
  `SPARKS 0` in the player's own config.
- `st_LoadConfig` reads `user.cfg` **first** (`tConfiguration.cpp:975`) and the
  userconfigdir `autoexec.cfg` near the **end** (line 992). So silence is not an
  override: it leaves the saved `0` standing and the sparks stay off forever.
- The `CAMERA_*` items are `tSettingItem`s, whose `Save()` returns **false**
  (`tConfiguration.h:497`); they never reach `user.cfg`, which is exactly why
  `?cam=1`'s silence really is stock. The two functions are not the same shape.

**The fix**: `?sparks=1` appends `SPARKS 1`, on any device. `?sparks=0` appends
`SPARKS 0`, on any device (unchanged). No parameter: touch appends `SPARKS 0`,
desktop writes nothing (unchanged).

| file | what it proves |
|---|---|
| `override-touch-gate-console.log` | the touch run on the fixed build: `T1b` and the two `T1c` checks, plus every check the gate already had. |
| `override-desktop-menu-gate-console.log` | the desktop gate on the same build: `D1` still true, ten screenshots, all ten different. |
| `override-15-booted-with-sparks-1.png` | the fifth boot of the touch run, entered at `?sparks=1`. |

## T1c, and why it is two checks and not one

The bug is invisible on a machine that has never saved anything, so the gate
establishes the precondition **before** it tests the override. T1c runs last,
after a session that has already left several menus with the touch append in
effect:

    [SPARKSGATE] T1c precondition saved-config-holds-sparks-0 {"read":true,"err":null,
      "bytes":22765,"line":"                      SPARKS 0","value":"0","PASS":true}

That is the state the maintainer was in. Then the page is reloaded at
`?sparks=1` (`eval:location.search='?sparks=1'`, as P4 does), and the check
**asks the game rather than the page**: it forces `st_SaveConfig` through
`Module._aa_web_save_config()`, which writes every `tConfItem`'s *live* value,
and reads `SPARKS` back out of `user.cfg`:

    [   91626ms] [SPARKS] SPARKS 1 written to /data/webdefaults/autoexec.cfg before main() (from ?sparks=1)
    [SPARKSGATE] T1c sparks-1-overrides-the-saved-0 {"save":"saved","autoexec_read":true,
      "autoexec_bytes":12747,"autoexec_sparks_lines":["SPARKS 1"],"ends_with_sparks_1":true,
      "live_sparks_in_user_cfg":"1",
      "tail":"EED 0.2\n\n# appended at runtime by web/shell.html: crash sparks on (from ?sparks=1)\nSPARKS 1\n",
      "PASS":true}

`live_sparks_in_user_cfg":"1"` is the load-bearing field: the running game's own
value for `SPARKS` is 1, in the very session whose saved config said 0 a moment
earlier. Forcing the save is also what makes it deterministic — the game saves
on its own schedule and a gate must not race it.

## The rest of both runs, on the fixed build

Eleven `PASS` flags in the touch run, all true — `T1b`, `T2b`, `T3b`, `P1`,
`P2/P3`, `P5`, `P4`, `P6 precondition`, `P6 ask-dropped`, and the two `T1c`
checks. Ten rounds; `CYCLE_TURN_LEFT_TOOLTIP` and `CYCLE_TURN_RIGHT_TOOLTIP`
both reach `0 0 1 1 1` from taps alone; the two `[EXCEPTION]` lines are the
script's own positive control; every 404 in both runs is `/favicon.ico`. The
desktop run: `D1` `"sparks_occurrences":0` on a 12376-byte file, zero
`[EXCEPTION]`, ten screenshots with ten distinct checksums.

**Still not a phone.** These are correctness runs under device emulation, and
the frame-time numbers remain the ones measured on this desktop rig.
