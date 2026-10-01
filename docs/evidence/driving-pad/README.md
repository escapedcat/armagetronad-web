# The driving pad: evidence

While a cycle of ours is alive (portrait), the pad is two big turn halves, a
brake bar and a small Esc that needs a long press. In menus the Game Boy pad
comes back. This was option B on the comparison page the maintainer chose
from.

## The gate: `web/tools/drive-pad-gate.steps`

An emulated phone (412×915, touch) in the first-run tutorial round.

- **D1:** the Game Boy pad in menus.
- **D2:** while driving, the driving pad, with no cross and no Enter/Esc. The
  legend reads only `hold picture: look around`.
- **D3:** a real touch tap on the left half turns the cycle left. The proof
  is the game's own per-player turn counter, which moved 2 → 1.
- **D4:** a real tap on the right half sends exactly `+Right -Right`. It runs
  in the countdown, so no turn can steer into a wall first.
- **D5:** a thumb down on the left half that slides into the right half sends
  `+Left -Left +Right -Right`.
- **D6:** holding the brake bar keeps ↓ held until the thumb lifts.
- **D7:** a short tap on Esc does nothing: no menu, no Escape sent.
- **D8:** a long press on Esc (700 ms, more than the 500 ms threshold) opens
  the in-game menu.

8/8, two runs in a row. Log: `console.log`.

The round opens with a countdown in which the game ignores turns: `ePlayer::Act`
passes them on only once `se_GameTime() >= 0`. Any turn check has to wait it
out.

## Other gates, updated for the new pad

- **`portrait-boot-gate`:**
  - PB4/PB8 tap the halves (two real turns, two haptic pulses);
  - PB7 checks there is no Enter in a round;
  - PB5 opens the menu with a long Esc;
  - PB3 measures only the Game Boy buttons.

  10/0.
- **`run-text-net-gate.sh`:** each Chat tap now waits until the Chat button is
  visible. The label can say Chat up to one poll before the pad switches back
  from the driving layout. 15/15, two runs in a row.
- **Look gate** 8/8, **keyboard gate** 10/10.
