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
