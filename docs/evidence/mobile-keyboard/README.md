# Phone keyboard: evidence

The phone keyboard types into the game's own text fields
([plan](../../superpowers/plans/2026-09-30-game-text-keyboard.md)). This is
what it was checked against, how, and how to re-run it.

## In the menus: `web/tools/game-keyboard-gate.steps`

An emulated phone (portrait, 412×915, touch) on First Setup:

```sh
python3 -m http.server 8008 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --out /tmp/kbd --mobile 412,915,3 \
  --url http://localhost:8008/armagetronad.html \
  --script-file web/tools/game-keyboard-gate.steps
grep -c '\[KBDGATE\] .*"PASS":true' /tmp/kbd/console.log    # 7
```

- **K1:** no keyboard while Accept is highlighted.
- **K2:** ▼ onto Name opens it.
- **K3:** "Zoë" typed into it lands in the game's own field, and in `user.cfg`.
- **K4:** a suggestion that rewrites "h" → "hi" → "Hi" ends up exact.
- **K5:** a real key typed into the field arrives exactly once.
- **K6:** the keyboard's Enter closes it.
- **K7:** ▲ off the field closes it.

All 7 pass.

## Against a real server: `net/`

The same phone joins the local `aa-dedicated` container through a local
relay. Enter during the round opens the game's chat line and the keyboard. A
line is typed, and the keyboard's Enter sends it.

```sh
sh web/tools/run-text-net-gate.sh docs/evidence/mobile-keyboard/net
```

The server's own lines (`net/server.log`):

```
[L] PLAYER_ENTERED web_8226 192.168.215.1 web_8226
[L] CHAT web_8226 hello from a phone
```

All 6 checks pass (`net/verdict.txt`).

## Default name: `web/tools/default-name-gate.steps`

A fresh profile starts as `web_NNNN`, not `web_user`. D1 passes.

## What emulation can't show

Headless Chrome opens no on-screen keyboard. Focus on the hidden field stands
in for it. Before this was built, the maintainer tried a throwaway version on
an Android phone: the keyboard opens on Name, typing appears in the game's
field, and folding the keyboard away keeps it closed.

## Known edge

The game's text fields refuse characters past their length limit without
telling the page. A suggestion that rewrites a word which ran into the limit
can then delete one character too many.
