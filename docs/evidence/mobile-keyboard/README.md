# Mobile keyboard: evidence

What the phone text UI (name dialog, Name button, 💬 chat bar) was checked
against, how, and how to re-run it. The plan is
[docs/superpowers/plans/2026-09-30-mobile-keyboard.md](../../superpowers/plans/2026-09-30-mobile-keyboard.md).

## Against a real server: `net/`

An emulated phone (portrait, 412×915, touch) against the local
`aa-dedicated` container through a local relay:

```sh
python3 -m http.server 8008 --directory web/dist-m1 &
sh web/tools/run-text-net-gate.sh docs/evidence/mobile-keyboard/net
```

The server config is `bridge/test-server/text-var/autoexec.cfg`: it waits for
a second player, so the phone stays connected, and it writes chat and renames
to the ladder log, which the checks read from the server's output.

```
PASS N0: the saved name, no prompt after the reload
PASS N1: no chat button before joining
PASS N1 passed
PASS N2: chat button once connected
PASS the server saw the chosen name join
PASS the server logged the chat line
PASS the server logged the rename
PASS no Emscripten abort
--- text-net gate: ALL PASSED ---
```

The server's own lines (`net/server.log`):

```
[L] PLAYER_ENTERED phoneplayer 192.168.215.1 phoneplayer
[L] CHAT phoneplayer hello from a phone
[L] PLAYER_RENAMED phoneplayer phonerenamed 192.168.215.1 phonerenamed
```

**A rename while connected takes effect at the next round.** The server
stores the new name and applies it when a round starts (`UpdateName` in
`src/engine/ePlayer.cpp`). Desktop players get the same, so the gate waits
across a round change before it reads the log.

## The page on its own

- `web/tools/text-bridge-gate.steps`, T1–T3: a name set from the page reaches
  the player config and `user.cfg`, including latin-1 and an over-long name;
  chat without a server is dropped once, with a log line.
- `web/tools/default-name-gate.steps`, D1: a fresh profile gets a
  `web_NNNN` name instead of `web_user`.
- `web/tools/text-ui-gate.steps`, U1–U10, all passing in portrait
  (`--mobile 412,915,3`) and landscape (`--mobile 915,412,3`):
  U1 first-visit dialog, U2 keys stay in the dialog, U3 the name survives
  first setup, U4 the corner buttons in menus, U5 the Name button reopens it,
  U6 chat bar placement, U7 the keyboard overlays rather than resizes,
  U8 keys stay in the chat bar, U9 asks only once, U10 the bar closes when
  the connection drops.

## What emulation can't show

Headless Chrome opens no on-screen keyboard. U6 and U7 stand in for it:
U6 places the bar against a shrunken `visualViewport`, U7 resizes the viewport
and checks the game canvas keeps its size. The first check with a real
keyboard is on a real phone.
