# Armagetron Advanced → Browser (Emscripten/WASM port)

## Context

Goal: get Armagetron Advanced (this C++ 3D lightcycle game, https://www.armagetronad.org/) running in the browser. Research confirmed **nobody has ported the real C++ codebase to WASM** — prior art is only [Armawebtron](https://github.com/Armawebtron/Armawebtron) (a stalled JS/Three.js rewrite with never-finished networking) and 2020–2021 forum threads where lead dev Z-Man explored web-capable tech (Godot, raylib) without follow-through. The niche is open; the community demonstrably wants browser play.

**Decisions:** full Emscripten port of the real source (base: `legacy_0.2.9`); single-player vs AI first; then multiplayer via a **UDP↔WebSocket bridge** so browser clients join existing community servers unchanged.

Key facts driving the design: SDL 1.2 (Emscripten emulates natively), no Boost/protobuf/FreeType; fixed-function GL 1.x with display lists **defaulting off** at runtime; no live threads (auth thread has sync fallback); single-player opens no sockets (`nSTANDALONE`); deterministic record/playback system (`tRecorder`) available for validation; the client does ALL network I/O through **one** UDP socket (`nBasicNetworkSystem::controlSocket_`), demultiplexing peers by source address — so one WebSocket per browser client reproduces native behavior exactly.

## Repo setup (done)

This repo (`escapedcat/armagetronad-web`) is a clone of upstream GitLab (`https://gitlab.com/armagetronad/armagetronad`, kept as the `upstream` remote). `main` is based on upstream `legacy_0.2.9` and is the default branch; port work happens on branches off `main`, so future upstream fixes merge cleanly and the port could one day be offered upstream as a merge request.

## Strategy summary

| Decision | Choice |
|---|---|
| Build | New hand-written `web/Makefile` + hand-written `src/emscripten/config.h` (precedent: `src/config_ide.h`, `src/win32/config.h`). Autotools not used for wasm. `-std=gnu++14`, `-O2` |
| Main loop | Keep nested blocking loops; `-sASYNCIFY=1` with yield points in `rSysDep::SwapGL()` / `sr_LimitFPS()` / `tDelay()` — every blocking loop funnels through these. JSPI (`-sASYNCIFY=2`) as later variant |
| GL | `-sLEGACY_GL_EMULATION=1` + 3 targeted patches (mipmaps, display-list stubs, alpha-test tolerance). Defaults already avoid texgen/infinity-plane/display-lists/ARB-programs (all dead or off) |
| SDL | `-sUSE_SDL=1` (SDL 1.2 emulation) + `src/emscripten/eCompat.cpp` stub TU, driven by `-sERROR_ON_UNDEFINED_SYMBOLS=1` |
| libxml2 | Build from source via `emconfigure`, **pin 2.12.x** (last with nanoHTTP), `--with-http` so `LIBXML_HTTP_ENABLED` avoids the `#error` in `tResourceManager.cpp`; runtime HTTP fails gracefully → bundled maps |
| Assets | `--preload-file` for data (~2 MB); IDBFS mounted at `/persist`; zero path patches via `--datadir /data --userdatadir /persist` (`tDirectories` runtime switches) |
| Threads | None; leave `HAVE_PTHREAD`/`HAVE_LIBZTHREAD` undefined (auth falls back to synchronous in `nAuthentication.cpp`) |
| Network | Compiles unchanged in all milestones (keeps bridge door open); connects fail gracefully until Phase 2 |

All source patches `#ifdef __EMSCRIPTEN__`-guarded; native builds untouched. New code in `src/emscripten/` + `web/`.

## Phase 1 milestones (single-player port, ~3–5.5 weeks)

**M0 — Dedicated server on WASM/Node (2–4 days).** Validates toolchain + libxml2 + C++ portability before touching graphics; yields the piece needed for future browser-hosted servers.
- New `deps/build-libxml2.sh` (emconfigure, static, no python/threads/zlib, `--with-http`)
- New `src/emscripten/config.h` (dedicated variant): define `DEDICATED`, `HAVE_LIBXML2`, `DONTUSEMEMMANAGER`, all `HAVE_*F` float-math macros (prevents the `defs.h` fallbacks colliding with musl), `HAVE_SELECT/SOCKLEN_T/ISBLANK/WMEMSET/UNISTD_H`; do NOT define `TOP_SOURCE_DIR`, platform macros, thread/curl/krawall macros
- New `src/emscripten/nTrueVersion.h` (`#define TRUE_ARMAGETRONAD_VERSION VERSION`)
- New `web/Makefile` compiling `src/{tools,network,engine,render,ui,tron}/*.cpp` (+ `thirdparty/particles` for client), `-iquote` dirs mirroring `src/Makefile.am`, `-I src/emscripten` first
- Link: `-sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1`
- Verify: `--doc` output; boots to "Ready for connections" with map parsed; native-recorded demo plays back under Node (best-effort)

**M1 — Client links, boots to main menu in browser (4–7 days).**
- Client config.h variant: + `HAVE_LIBSDL`, `HAVE_SDL_SDL_IMAGE_H`, `HAVE_LIBSDL_IMAGE`, `HAVE_LIBPNG`, − `DEDICATED`
- Patch `src/render/rTexture.cpp`: stub `IMG_InvertAlpha`; `gluBuild2DMipmaps` → `glTexImage2D` (unsized formats) + `glGenerateMipmap`
- Patch `src/render/rSysdep.cpp`: `SDL_Delay`→`emscripten_sleep` in `sr_LimitFPS`; guaranteed `emscripten_sleep(0)` per frame at end of `SwapGL()` — THE browser yield point (all blocking loops call SwapGL: `uMenu::Enter`, splash screen, message boxes, connection waits, game loop)
- Patch `src/tools/tSysTime.cpp`: `tDelay` → `emscripten_sleep` (recorder-safe: inside the wrapped functions)
- New `src/emscripten/eCompat.cpp`: stubs (SDL mutex/thread no-ops, `SDL_LoadWAV`/`SDL_BuildAudioCVT` if missing, display-list family `glNewList`… return 0 — lists default off)
- Link: `-sUSE_SDL=1 -sUSE_LIBPNG=1 -sLEGACY_GL_EMULATION=1 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 --use-preload-plugins --preload-file config@/data/config` (+ language/textures/models/sound/resource/included/webdefaults) `--shell-file web/shell.html`
- New `web/shell.html` (start-overlay for audio unlock + `callMain`, canvas, progress bar) and `web/webdefaults/settings_web.cfg`; `Module.arguments = ['--datadir','/data','--userdatadir','/persist','--userconfigdir','/data/webdefaults']`

**M2 — Playable single-player vs AI (3–5 days).** `settings_web.cfg`: `MAX_FPS 60`, `INFINITY_PLANE 0`, display lists off, `SOUND_BUFFER_SHIFT 3`. Playtest and fix LEGACY_GL fallout (watch-list: alpha test, fog modes, GL_QUADS paths, GL_LUMINANCE font atlas). Verify text entry/key names for binding menu. Target: 3 full rounds vs 3 AIs, ≥30 fps, Chrome+Firefox.

**M3 — Audio (1–3 days).** SDL1 `fill_audio` callback via Web Audio; implement PCM WAV load/convert in eCompat.cpp if the JS library lacks it (~80 lines; only 2 WAVs matter); buffer size via `SOUND_BUFFER_SHIFT`; unlock on start-overlay click.

**M4 — Persistence + shell polish (2–3 days).** IDBFS mount + `FS.syncfs` on `st_SaveConfig` (`tConfiguration.cpp`) and `beforeunload`; verify name/keybinding survive reload; fullscreen button; hide/fix resolution menu if `SDL_SetVideoMode` resize misbehaves.

**M5 — Validation, perf, packaging (3–5 days).** Native-recorded demo playback in wasm build (best-effort diagnostic, not CI gate); profile Asyncify overhead; try JSPI variant (check Firefox/Safari support at that time); brotli assets (~8–15 MB wasm expected); confirm network menus fail gracefully.

## Phase 2 milestones (multiplayer bridge, ~3–6 weeks)

**Architecture (verified against source):** one WebSocket per browser client ↔ bridge holding one ephemeral-port UDP socket per session (servers identify clients by ip:port — this mirrors a native client exactly, including the server browser's 20 concurrent pings via `sn_Bend`). Binary frames: `{version, type, port u16, addrLen, addrToken(ascii host or dotted quad), payload}` — bridge echoes the client's token back, client never does DNS (fake-IP map `10.42.0.0/16` in `nAddress::SetHostname`). Rejected alternatives: Emscripten default SOCKFS WebSocket emulation (destination routing lost / per-peer WSS handshakes) and `-sPROXY_POSIX_SOCKETS` (needs pthreads+COOP/COEP, demo-grade open-relay proxy).

**C++ changes confined to `src/network/nSocket.cpp`** (`#ifdef __EMSCRIPTEN__` at: `Create`, `Open/Bind`, `Read`, `Write`, `Broadcast` → disabled, `nBasicNetworkSystem::Select` → queue-check + `emscripten_sleep(5)` loop, `nAddress::SetHostname` → fake DNS) + new `src/network/nSocketWeb.cpp/.h` (~300 lines: handle table, RX queue, token↔IP map) + new `web/library_bridge.js` (~250 lines; onmessage only ENQUEUES — C++ never re-entered from JS events, no Asyncify reentrancy). `nNetwork.cpp`, `nServerInfo.cpp`, `gServerBrowser.cpp`, `config/master.srv` all unchanged — the entire in-game server browser works through the shim.

**Bridge service:** small Go binary (goroutine/session), behind Caddy for wss/TLS, Docker Compose on a €5–9/mo EU VPS (community servers cluster EU/US; ~+5–25 ms added RTT same-region). Anti-abuse: destination policy (no private/multicast; port allowlist 4533–4599 + config), unanswered-flow budget (kills reflection), 32/64 KB/s per-session caps, per-IP session cap 4, Origin allowlist, JSON-line logs + Prometheus counters. Known risk: servers cap clients per IP (`MAX_CLIENTS_SAME_IP_SOFT=4`/`HARD=8`) — mitigate with secondary IPs and by talking to server admins before launch.

- **M-A (1–2 wks):** shim + JS lib + minimal bridge (plain ws), join local dockerized dedicated server via custom-connect; verify full round, resend-under-loss, WS-drop recovery; then one real community server.
- **M-B (1–2 wks):** fake-DNS + master list (`master1-4.armagetronad.org:4533`) + in-game server browser through bridge; verify server count/pings vs native client.
- **M-C (1–2 wks):** wss/Caddy, policies, rate limits, metrics, prod deploy; load test 50 sessions, abuse tests.
- **M-D (stretch):** US bridge + region picker; REST lobby cache; WebTransport datagrams; egress-IP pooling.

## Risk register (top items)

| Risk | Mitigation → Fallback |
|---|---|
| LEGACY_GL_EMULATION gaps | Conservative runtime defaults + per-feature disables → targeted GLES2 rewrite of hot paths only (floor/walls/model) via existing `rRenderer` seam (`rRender.h`) |
| Asyncify stack/reentrancy | Single yield point in SwapGL, big ASYNCIFY_STACK_SIZE → manually restructure only `uMenu::Enter` + `sg_EnterGameCore`, or JSPI |
| SDL1 emulation gaps | eCompat.cpp stubs, found at link time → each replaceable <100 lines |
| Float non-determinism breaks demo playback | Treat playback as diagnostic, not gate → manual playtest matrix |
| Immediate-mode emulation too slow | MAX_FPS 60, reduced effects → same GLES2 hot-path rewrite |
| libxml2 ≥2.13 drops nanoHTTP | Pin 2.12.x → stub tResourceManager HTTP path |

## Verification (end-to-end)

1. M0: dedicated wasm server boots under Node, parses maps, plays back a native-recorded demo.
2. M2 gate: 3 complete single-player rounds vs AI in Chrome + Firefox at ≥30 fps; tab stays responsive.
3. M4 gate: settings persist across reload (IndexedDB).
4. M5: native demo playback survives >1 round in wasm build (best-effort); packaged page loads <15 MB brotli.
5. M-A gate: browser client completes a round on an unmodified community server through the bridge.
6. M-B gate: in-game server browser lists ~same servers as a native client, joins from list.

## Critical files

Port: `src/render/rSysdep.cpp`, `src/tools/tSysTime.cpp`, `src/render/rTexture.cpp`, new `src/emscripten/{config.h,nTrueVersion.h,eCompat.cpp}`, new `web/{Makefile,shell.html,webdefaults/settings_web.cfg}`, new `deps/build-libxml2.sh`.
Bridge: `src/network/nSocket.cpp`, new `src/network/nSocketWeb.{cpp,h}`, new `web/library_bridge.js`, new Go bridge service (`bridge/` dir).
