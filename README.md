# Armagetron Advanced → in the browser

<img src="docs/screenshots/phone-portrait-play.gif" alt="A round on a phone in portrait: the cycle drives, turns with the two big pad halves, and crashes into a wall" width="200" align="right">

**▶ Play now: <https://escapedcat.github.io/armagetronad-web/>** on a
desktop or a phone, with no install and no account.
Something wrong? [Report a problem](https://github.com/escapedcat/armagetronad-web/issues/new?template=bug-report.yml).

This is a fork of [Armagetron Advanced](https://www.armagetronad.org/), the
classic 3D lightcycle game, with one goal: run the real game in a web browser
and play on the existing community servers. It is not a rewrite or a
look-alike: the original C++ engine, physics, AI and network protocol are
compiled to WebAssembly with [Emscripten](https://emscripten.org/).

**Contents**
- **Players**
  - [Play it](#play-it)
  - [Controls](#controls)
  - [How online play works](#how-online-play-works)
  - [Log in with a Global ID](#log-in-with-a-global-id-recommended)
  - [FAQ](#faq)
  - [Known limitations](#known-limitations)
- **Server owners**
  - [For server owners](#for-server-owners)
- **Developers**
  - [For developers](#for-developers)
  - [Why this approach](#why-this-approach)
  - [License](#license)

## Play it

**<https://escapedcat.github.io/armagetronad-web/>**

<img src="docs/demo-qr.png" alt="QR code linking to https://escapedcat.github.io/armagetronad-web/" width="180" align="right">

Scan the code to open it on a phone. It needs no install and no account.

- **First visit:** about **1.7 MiB**. After that the game is cached, and your
  settings and key bindings are kept in the browser.
- **Starting:** the game starts on load; there is no Play button.
- **Desktop and Android:** tested in Chrome and Firefox on desktop, and in
  Chrome and Brave on Android.
- **iPhone / Safari:** untested.

<table>
<tr>
<td align="center"><img src="docs/screenshots/desktop.jpg" alt="Desktop: a round against three AI opponents, with the HUD" width="520"><br><sub>Desktop</sub></td>
<td align="center" rowspan="2"><img src="docs/screenshots/phone-portrait.jpg" alt="Phone in portrait, driving: the game in a square, below it two big turn halves, a brake bar and a small Esc" width="180"><br><sub>Phone, portrait: driving</sub></td>
<td align="center" rowspan="2"><img src="docs/screenshots/phone-portrait-menu.jpg" alt="Phone in portrait, in a menu: the Game Boy pad with a cross, Enter and Esc" width="180"><br><sub>Phone, portrait: menus</sub></td>
</tr>
<tr>
<td align="center"><img src="docs/screenshots/phone-landscape.jpg" alt="Phone in landscape: tap the left or right half to turn" width="520"><br><sub>Phone, landscape</sub></td>
</tr>
</table>

### Controls

**Desktop:**

| key | action |
|---|---|
| ← → | turn |
| ↓ | brake |
| Escape | in-game menu |
| `n` | fullscreen |

The upstream default also binds `b` to **Toggle Spectator**. If you press it by
accident you only watch from then on, until you set *Player Setup → Spectator
Mode* back to Off.

**Phone:**
- **Portrait:** the game sits in a square at the top, with controls below.
  - **In menus**, a Game Boy pad: a cross, Enter and Esc.
  - **While driving**, two big halves: left thumb turns left, right thumb
    turns right, and sliding from one half into the other switches the turn.
    The bar along the bottom brakes while held. The small esc in the corner
    opens the menu.
  - **Hold the game picture to look around** while driving: the left or right
    half looks that way, the bottom quarter looks back, and letting go looks
    ahead. The line under the pad says so.
- **Landscape:** tap the left or right half of the screen to turn. In menus a
  tap is Enter, and there are small Up, Down and Escape buttons.
- **The layout is chosen when the game starts.** The rotate button in the
  menus switches it with a short reload.
- **Typing:** the phone keyboard opens by itself when a text field is
  highlighted, such as the name in *Player Setup*, and closes when you move
  off it. Its Enter confirms. If you fold the keyboard away, tap the game to
  bring it back. New players start as `web_` plus four digits. On a server a
  new name takes effect at the next round, as on desktop.
- **Chat:** on a server, once you've crashed, between rounds or while
  watching, the pad's Enter says **Chat**: tap it and the game's chat line
  opens with the keyboard. The keyboard's Enter sends; an empty line just
  closes. While your cycle is alive the pad's Enter does nothing, so a stray
  tap can't turn your arrows into typing. A tap on the picture never opens
  chat. Putting the keyboard away, by folding it or with a tap on the
  picture, closes the chat line without sending. Pasting works from
  the keyboard's clipboard (on Android, the clipboard chip above the keys).
- **Single player** against the AI, on desktop and on phones, with sound.
- **Online multiplayer on the real community servers.** Play → Multiplayer →
  Online Multiplayer lists the live servers, and you join like any desktop
  player.
- **Maps you don't have yet download automatically** when you join a server
  that uses them, and are cached. A few popular server maps come with the page.
- **Settings persist** across visits: keys, player name, display and sound.

## How online play works

A browser cannot send the UDP packets the game speaks. So the page talks
WebSocket to a small **relay** (`bridge/`, on [Fly.io](https://fly.io/)), and
the relay exchanges the UDP datagrams with the game servers. The servers are
unmodified and don't know a browser is involved.

- **No sign-up.** The relay accepts visitors of the published page. It limits
  each player's connections, traffic and requests, and refuses private
  addresses, so it can't be used against anything else.
  See [bridge/README.md](bridge/README.md).
- **Maps go through the same relay.** Its `/resource` route fetches them from
  the official map repository, `resource.armagetronad.net`.
- **All web players share one address.** Servers see every browser player as
  the relay's single IP. A server that autobans an address for too many kicks
  (for example idle kicks) therefore locks out *every* web player for a while.
  This has happened on a busy server.
  - **After 60 s with the tab hidden, the page leaves the server.** It does
    this with a regular logout, which isn't a kick: a background tab or a
    phone that switched apps would otherwise be idle-kicked.
  - **A player who keeps the tab visible but sits idle** can still be kicked,
    so don't park on a server.

### Log in with a Global ID (recommended)

You can play without an account. But if you play online regularly, log in
with a free **Global ID**, the game's own player account.

**Why we recommend it:**
- **Servers can't tell web players apart otherwise.** Every browser player
  reaches a server from the relay's one address, and anyone can pick any name.
  A login is the one thing that says "this is really me".
- **It protects every web player.** Without a login, the only tool a server
  owner has against one troublemaker is banning the relay's address, and that
  locks out *all* web players. Logged-in players can be recognised, and dealt
  with, one by one, which makes it easier for owners to keep welcoming web
  players.
- **Servers can treat logged-in players better.** Some give them extra rights,
  and stats pages list logged-in players under their account (`name@lt`), so
  your scores stay yours whatever name you play under. A server owner who
  blocks data-center addresses could also let logged-in web players through.

**How to get one:**
- **The official forums no longer accept new sign-ups.** Register instead at
  **[Lightron](https://lightron.org/)** ("Don't have an account?" under Log
  In). Your Global ID is then `yourname@lt`.
- In the game, open **Player Setup → Player 1**, set **Global ID** to
  `yourname@lt` and turn on **Auto Login**. On a server that supports it, the
  game asks for your Lightron password when you join. On a phone, the keyboard
  opens in private mode, without suggestions.
- Or log in by hand on a server: type `/login yourname@lt` into the chat.
- **Your name and your login are separate.** The login doesn't change the name
  you play under; set that under **Name** in Player Setup.
- **Not every server has logins switched on.** On those, you just play
  without one.

## FAQ

**A server kicked me, or says my network is banned. Why?**
Every web player reaches servers through the relay's one address, a
data-center address, and some servers block those to keep out VPNs. Others
autoban an address after several kicks, which then hits every web player for
a while. Try another server. Logging in with a Global ID (above) helps
servers tell you apart, and server owners can find out how to let web players
in under "For server owners".

**Why am I called `web_1234`?**
That's the default name for new players. Change it under
**Player Setup → Player 1 → Name**. On a phone the keyboard opens by itself
on the name field.

**How do I chat on a phone?**
On a server, once you've crashed, between rounds or while watching, the pad's
Enter turns into **Chat**: tap it, type, and send with the keyboard's Enter.
While your cycle is alive chat is off, so a stray tap can't turn your arrows
into typing. In landscape, tap the screen instead (after a crash or between
rounds).

**How do I look around on a phone?**
In portrait, while driving, hold the game picture: the left or right half
looks that way, the bottom strip looks back.

**My settings and name are gone.**
They're stored in your browser for this site, so a private window, clearing
site data or another browser starts fresh.

**Does it work on an iPhone?**
Not tested yet. If you try it, tell us how it went:
[report a problem](https://github.com/escapedcat/armagetronad-web/issues/new?template=bug-report.yml),
even if everything worked.

**How do I quit?**
Close the tab. There's no Exit in the menu, because a web page can't close
itself.

## For server owners

**Do you need to do anything?** No. Web players are ordinary game clients
speaking the normal protocol, and your server needs no changes. This section
is for when you notice them, or want to handle them differently.

**How to recognise a web player:**
- **They all come from the relay's address**, currently `89.222.108.19`.
  ipinfo.io reports its network as **`AS60068 Datacamp Limited`**, the
  upstream of the Fly.io Frankfurt region the relay runs in. That's why VPN
  filters matching "Datacamp" or "DataPacket" catch it, though it isn't a VPN.
  The address can change when the relay is redeployed.
- **Many play under a default name** like `web_1234`, unless they picked one.
- **Some log in with a Global ID.** The README asks them to (see "Log in with a
  Global ID" above). That login is the only thing that tells one web player
  from another.

**If you block VPN or data-center addresses** and want to let web players in:
- Allow the relay's address in your filter, or let it through only for
  players who log in.
- For now the address isn't fixed, so an allowance can stop working after a
  redeploy. If you'd rely on one, say so in an issue: a fixed address is
  possible.

**If one web player causes trouble:**
- **Don't ban the relay's address.** That locks out every web player, the same
  as an autoban after repeated kicks of web players.
- **If they're logged in,** ban or restrict their Global ID, like any other
  player.
- **If they aren't,** report them (see below). The relay sees each player's
  real address and can block that one person.

**What you can ask for**, with the [server owner form](https://github.com/escapedcat/armagetronad-web/issues/new?template=server-owner.yml):
- **Opt out:** the relay stops sending to your server, and web players see
  that it doesn't take them.
- **Block one player:** give their name, the time (with time zone) and your
  server's address. Real addresses are never posted publicly; the block
  happens on the relay.
- **A question,** or a fixed address for your allowlist.

**What the relay does on its side:**
- only pages from this project's site may use it;
- it sends only to public game servers on ports 4533–4599;
- it limits each player to 4 connections and caps packets and bytes per
  second;
- the page leaves a server with a regular logout after its tab has been
  hidden for a minute, so web players don't sit idle until they're kicked.

**Privacy:** to trace a report, the relay logs which player address plays on
which server, in Fly's short-lived logs, and nothing else about the game.

## Known limitations

- **Things a browser can't do:**
  - LAN games and hosting a server. LAN Multiplayer is hidden; "Host Game"
    explains why it can't work.
  - Leaving the game: closing the tab is how you quit, so the main menu has no
    Exit Game.
- **Typing on a phone:** a word suggestion that rewrites a word at a text
  field's length limit (15 characters for names) can delete one character too
  many.
- **Phone performance:**
  - The frame rate drops the longer a round goes on. It's CPU-bound, and the
    general fix is still open.
  - Phones get lighter-weight crash sparks by default. `?sparks=1` restores
    the stock sparks, and `?sparks=0` turns them off.
- **Desktop:** `f` doesn't toggle fullscreen, though it's bound; use `n`.
- **Maps from other repositories:** a server's own map repository is used only
  if its host is on the relay's allowlist. Otherwise the client falls back to
  the official repository.

## Why this approach

Armagetron's precise feel lives in about 114k lines of battle-tested C++:
cycle physics, rubber, the collision grid, and server-authoritative netcode
with client prediction. Earlier browser attempts were rewrites that had to
re-create that feel by hand, such as
[Armawebtron](https://github.com/Armawebtron/Armawebtron), a JS/Three.js
rewrite. Compiling the actual engine avoids that problem. The reasoning is in
[ADR 0000](docs/adr/0000-port-real-codebase-via-emscripten.md).

## For developers

- **Start with [docs/development.md](docs/development.md):** the toolchain,
  building the client and the dedicated server, running them, the page's URL
  parameters, and the test gates. The Quickstart takes about 15 minutes from a
  fresh clone.
- **The relay** (online play) has its own [bridge/README.md](bridge/README.md).
- **Tests:** `cd bridge && npm test` for the relay, and the `.steps` and
  `run-*-gate.sh` scripts in `web/tools/` for the browser, each explaining
  itself in its header.
- **Deploys:** a merge to `main` publishes the page; changes under `bridge/`
  redeploy the relay; CI checks every pull request leaves the dedicated
  server byte-identical.

## License

GPL-2.0-or-later, same as upstream — see [COPYING.txt](COPYING.txt).
