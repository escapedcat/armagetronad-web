# Mobile Keyboard (Name and Chat) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phone players can pick their name and chat on the servers. They type into ordinary HTML text boxes, which bring up the phone's own keyboard. Every new player also gets a unique default name instead of everyone being `web_user`.

**Architecture:**
- **What the page adds** (`web/shell.html`), shown on touch devices only:
  - a **name dialog**, opened automatically on the first visit and afterwards from a **Name** button in the menus;
  - a **chat bar** with a **💬** button, shown only while connected to a server.
- **How text reaches the game.** The page never calls into the game with a string. It parks the text in a JS slot. A per-frame task on the game's own loop (`src/emscripten/eWebText.cpp`, client-only) pulls it out through `EM_JS` and then:
  - applies it as the player's name, and saves the settings; or
  - sends it as a chat line.

  This is the same safe pattern as `eWebLeave.cpp`.
- **The default name** becomes `web_NNNN` (four random digits). Emscripten hard-codes `USER=web_user`, which the game reads for its default name; the page now sets it before the game starts.

**Tech Stack:** Emscripten 6.0.8 (Asyncify, SDL 1.2 shim, `EM_JS`), plain HTML/CSS/JS in `web/shell.html`, headless-Chrome gates driven by `web/tools/drive-browser.mjs`, and the local `aa-dedicated` server container.

**Spec:** none separate. The design was agreed in conversation on 2026-09-30 and is summarised under "Design" below: native inputs (option B), placement for both layouts, first-visit name prompt, and the chat button only while connected.

## Design (the agreed placement)

**Portrait (Game Boy layout).** The phone keyboard covers the pad; the game square stays visible.

```
┌──────────────────┐      ┌──────────────────┐
│   game square    │      │   game square    │
├──────────────────┤      ├──────────────────┤
│   💬 Name [layout]│      │ Say: gg wp  ➤  ✕ │  ← bar right under the square
│    ▲             │  →   ├──────────────────┤
│  ◀   ▶   Enter   │      │ phone keyboard   │
│    ▼     Esc     │      │                  │
└──────────────────┘      └──────────────────┘
```

**Landscape.** A thin bar sits just above the keyboard, and the game is mostly covered while typing.

```
┌────────────────────────────────────┐      ┌────────────────────────────────────┐
│ Esc      [▲][▼]    💬 Name [layout]│      │   game (top part visible)          │
│  ‹ tap left      tap right ›       │  →   │ Say: gg wp                    ➤  ✕ │
└────────────────────────────────────┘      ├────────────────────────────────────┤
                                            │ phone keyboard                     │
```

**The button corner.**
- The corner (`#aa-corner`) holds, left to right: **💬** (only while connected), **Name** (only in menus) and the existing layout button (only in menus).
- While driving, only 💬 remains, in the corner itself.
- Portrait: the corner sits just below the square. Landscape: the top-right corner.

**The name dialog.**
- A centred box with the title "Your name", a text field of at most 16 characters, and Cancel / OK.
- It opens automatically once, on a touch device, when no name has been chosen yet: no `PLAYER_1` saved, or it is still `web_user` or a `web_NNNN` default.
- The marker file `/persist/var/aa-name-asked` makes it never ask again.

**The chat bar.**
- A text field of at most 120 characters, with ➤ (send) and ✕ (close).
- It sits right under the square in portrait. In landscape, and whenever the keyboard reaches higher, it sits just above the keyboard, measured with `visualViewport`.
- It closes by itself if the connection ends.

## Global Constraints

- **Guard every C++ change** with `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`. New C++ goes in a **new file under `src/emscripten/`**, named in `CLIENT_OBJS` in `web/Makefile`, never in `$(SRCS)`.
- **The dedicated wasm stays byte-identical:** 2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5` (Mac). CI's `dedicated-pin` job enforces it.
- **No body line in `web/shell.html` may start with `#`.** The shell preprocessor mangles it, so indent every CSS rule (`    #aa-corner { … }`).
- **The page never calls a wasm export with a string argument, and never allocates wasm memory, from a browser event.** The game may be suspended in an Asyncify sleep at that moment. Text travels only through the JS slots `window.AA_TEXT_PEEK` / `window.AA_TEXT_TAKE`, pulled by the game's own frame loop.
- **Keys typed into the dialog or the chat bar must never reach the game.** SDL listens on `document` in the bubble phase, so each overlay root stops `keydown` / `keyup` / `keypress` propagation.
- **Text sent to the game is latin-1:** `ENCODING latin1` is what the game uses. Control characters are removed, surrounding whitespace is trimmed, characters above U+00FF become `?`, and names are cut to 16 characters, chat to 120.
- **Touch devices only.** Everything new lives inside `#touch` (hidden on desktop) or is opened only from there. The desktop page is unchanged.
- **Gates run headless** with the Unidentified-key filter (`web/tools/resource-gate.steps` explains it), and never against a third-party server. The network gate uses the local `aa-dedicated` container and a local relay.
- **Commits:** author `escapedcat <github@htmlcss.de>`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage named paths only. Use `git commit -F <file>` when a message contains backticks.

## Review Focus

1. **Keys leaking into the game while typing.** On desktop `b` toggles spectator mode, the arrows steer, and Enter opens the game's own chat. Typing `b`, an arrow or Enter into either overlay must not reach SDL. Pinned in Task 3 by a document-level counter that must stay at 0.
2. **The phone keyboard reshaping the game.** Some browsers shrink the page when the keyboard opens, and the page is `100dvh`. `interactive-widget=resizes-visual` on the viewport meta keeps the layout still. Emulation can't open a keyboard, so Task 3's U7 pins the tag itself, and "After merge" step 2 checks the real behaviour on a phone.
3. **Awkward text.** Emoji, accented letters, 40 characters, a name of only spaces, an empty chat line. Expected: `Zoë 🚀` becomes `Zoë ?`, long input is cut to the limit, and blank input changes nothing. Pinned in Task 1.
4. **A name set while First Setup is open.** On a first visit the game's own First Setup screen has a Name row bound to the same variable. Pressing its Accept after using the dialog must keep the new name, not bring back `web_user`. Pinned in Task 3.
5. **Chat while not connected.** The 💬 button is hidden when not connected. An open chat bar closes when the connection ends. If a chat line is somehow queued while standalone, it is dropped with a console note and never sent. Pinned in Task 1 (standalone drop), Task 3 U10 (bar closes on disconnect), and Task 4 (button hidden before joining, shown after).

---

### Task 1: The game side — `eWebText.cpp`

**Files:**
- Create: `src/emscripten/eWebText.cpp`
- Modify: `web/Makefile` (`CLIENT_OBJS`, and its comment list)
- Create: `web/tools/text-bridge-gate.steps`

**Interfaces:**
- Consumes: `window.AA_TEXT_PEEK(kind)` / `window.AA_TEXT_TAKE(kind)`. Kind 1 is the name, kind 2 is chat. Before Task 3 exists, the test defines them itself.
- Consumes: `aa_web_save_config()` (`src/emscripten/eWebPersist.cpp`, `extern "C"`); `sn_GetNetState()`; `ePlayer::PlayerConfig(0)->name` / `->netPlayer`; `ePlayerNetID::Update()`; `ePlayerNetID::Chat(const tString &)`.
- Produces (console, read by Tasks 3 and 4):
  - `[TEXT] name set to <name>`
  - `[TEXT] chat sent (<n> bytes)`
  - `[TEXT] chat dropped: not connected`
  - `[TEXT] chat dropped: no player on the server`

- [ ] **Step 1: Write the failing browser test** `web/tools/text-bridge-gate.steps`:

```
# Task 1 test: the game pulls queued text from the page and applies it.
# Desktop, local page, no server:
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   node web/tools/drive-browser.mjs --out /tmp/text-bridge \
#        --url http://localhost:8008/armagetronad.html --script-file web/tools/text-bridge-gate.steps
# PASS/FAIL is read from the [TEXTGATE] lines (see Step 2).
until:1:120000:[BOOT] autostart
wait:9000
key:Enter
wait:3000
key:Escape
until:1:30000:[PERSISTSAVE] menu-leave
wait:2000
eval:(()=>{if(!window.AA_TEXT_TAKE){const q={1:null,2:null};window.AA_TEXT_PEEK=(k)=>q[k];window.AA_TEXT_TAKE=(k)=>{const t=q[k];q[k]=null;return t};window.__q=q;}else{window.__q=null}return 'slots '+(window.__q?'defined by the test':'from the page')})()
eval:(()=>{const put=(k,v)=>{if(window.__q)window.__q[k]=v;else window.AA_TEXT_QUEUE(k,v)};window.__put=put;put(1,'gatetester');return 'queued name'})()
wait:1500
eval:(()=>{const b=Module.FS.readFile('/persist/var/user.cfg');let c='';for(const x of b)c+=String.fromCharCode(x);const m=/^PLAYER_1\s+(.*)$/m.exec(c);console.log('[TEXTGATE] T1 name-applied '+JSON.stringify({saved:m&&m[1],PASS:!!m&&m[1].trim()==='gatetester'}));return 'T1'})()
eval:(()=>{window.__put(1,'Zoë 🚀 and a name that is far too long');return 'queued awkward name'})()
wait:1500
eval:(()=>{const b=Module.FS.readFile('/persist/var/user.cfg');let c='';for(const x of b)c+=String.fromCharCode(x);const m=/^PLAYER_1\s+(.*)$/m.exec(c);const v=m&&m[1];console.log('[TEXTGATE] T2 awkward-name '+JSON.stringify({saved:v,PASS:!!v&&v.length<=16&&!/[Ā-￿]/.test(v)&&v.startsWith('Zo\u00eb ?')}));return 'T2'})()
eval:(()=>{window.__put(1,'   ');return 'queued blank name'})()
wait:1500
eval:(()=>{const b=Module.FS.readFile('/persist/var/user.cfg');let c='';for(const x of b)c+=String.fromCharCode(x);const m=/^PLAYER_1\s+(.*)$/m.exec(c);console.log('[TEXTGATE] T3 blank-name-ignored '+JSON.stringify({saved:m&&m[1],PASS:!!m&&m[1].trim().startsWith('Zo')}));return 'T3'})()
eval:(()=>{window.__put(2,'hello while standalone');return 'queued chat'})()
wait:1500
eval:(()=>{return 'standalone chat checked by the runner'})()
```

- [ ] **Step 2: Run it to verify it fails**

```sh
source deps/emsdk/emsdk_env.sh && make -f web/Makefile client -j8
python3 -m http.server 8008 --directory web/dist-m1 &   # skip if one is running
node web/tools/drive-browser.mjs --out /tmp/text-bridge --url http://localhost:8008/armagetronad.html \
     --script-file web/tools/text-bridge-gate.steps > /dev/null 2>&1
grep -o '\[console.log\] \[TEXTGATE\] .*' /tmp/text-bridge/console.log
grep -c '\[TEXT\] chat dropped: not connected' /tmp/text-bridge/console.log
```
Expected: T1 `"PASS":false` (nothing consumes the slots yet; `saved` is the default name), and the dropped-chat count is `0`.

- [ ] **Step 3: Write `src/emscripten/eWebText.cpp`**

```cpp
/*
Armagetron Advanced -- text from a phone: the player's name and chat lines.

WHY THIS EXISTS. A phone only shows its keyboard for a real text box, and the
game draws everything into one canvas. So web/shell.html shows HTML inputs (a
name dialog, a chat bar) and hands their text to the game here.

WHY A POLL, NOT A CALL. The page's handlers run in browser events, and the game
may be suspended in an Asyncify sleep at that moment; calling into it with a
string would allocate on a stack that is not ours to touch. So the page only
parks the text in a JS slot (window.AA_TEXT_PEEK / AA_TEXT_TAKE), and this
per-frame task -- on the game's own stack, from rSysDep::SwapGL -- pulls it out
through EM_JS and acts on it. The same pattern as eWebLeave.cpp.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "ePlayer.h"
#include "nNetwork.h"
#include "rScreen.h"
#include "tString.h"

#include <emscripten/emscripten.h>

extern "C" void aa_web_save_config( void ); // src/emscripten/eWebPersist.cpp

// kind 1 = name, 2 = chat. Non-zero when text of that kind is waiting.
EM_JS( int, aa_js_text_pending, ( int kind ), {
    var t = ( typeof window !== 'undefined' && window.AA_TEXT_PEEK ) ? window.AA_TEXT_PEEK( kind ) : null;
    return t ? 1 : 0;
});

// Consumes the waiting text of that kind into buf as latin-1 -- characters
// above U+00FF become '?' -- NUL-terminated, at most cap-1 bytes. Returns the
// number of bytes written.
EM_JS( int, aa_js_text_take, ( int kind, char * buf, int cap ), {
    var t = window.AA_TEXT_TAKE( kind ) || '';
    var n = Math.min( t.length, cap - 1 );
    for ( var i = 0; i < n; i++ ) { var c = t.charCodeAt( i ); HEAPU8[ buf + i ] = c <= 255 ? c : 63; }
    HEAPU8[ buf + n ] = 0;
    return n;
});

static tString sg_TakeText( int kind, int cap )
{
    char buf[ 128 ];
    if ( cap > static_cast< int >( sizeof( buf ) ) )
        cap = sizeof( buf );
    aa_js_text_take( kind, buf, cap );
    // trim what the latin-1 cut or the page may have left at the ends
    tString s( buf );
    return s;
}

static bool sg_Blank( tString const & s )
{
    for ( int i = 0; i < s.Len() - 1; ++i )
        if ( s[i] != ' ' )
            return false;
    return true;
}

static void sg_ApplyName( tString const & name )
{
    ePlayer * p = ePlayer::PlayerConfig( 0 );
    if ( !p || sg_Blank( name ) )
        return;
    p->name = name;
    ePlayerNetID::Update();
    aa_web_save_config();
    emscripten_log( EM_LOG_CONSOLE, "[TEXT] name set to %s", static_cast< char const * >( name ) );
}

static void sg_SendChat( tString const & say )
{
    if ( sg_Blank( say ) )
        return;
    if ( sn_GetNetState() != nCLIENT )
    {
        emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat dropped: not connected" );
        return;
    }
    ePlayer * p = ePlayer::PlayerConfig( 0 );
    ePlayerNetID * net = p ? static_cast< ePlayerNetID * >( p->netPlayer ) : 0;
    if ( !net )
    {
        emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat dropped: no player on the server" );
        return;
    }
    net->Chat( say );
    emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat sent (%d bytes)", say.Len() - 1 );
}

static void sg_TextPerFrame()
{
    if ( aa_js_text_pending( 1 ) )
        sg_ApplyName( sg_TakeText( 1, 17 ) );    // 16 characters + NUL
    if ( aa_js_text_pending( 2 ) )
        sg_SendChat( sg_TakeText( 2, 121 ) );    // 120 characters + NUL
}

static rPerFrameTask sg_textTask( &sg_TextPerFrame );

#endif
```

Note: `tString::Len()` counts the terminating NUL. The game itself tests "non-empty" as `Len() > 1`, which is why `sg_Blank` loops to `Len() - 1`.

- [ ] **Step 4: Link it.** In `web/Makefile`, append `\` plus `$(CLIENT_OBJDIR)/emscripten/eWebText.o` to the last `CLIENT_OBJS` line (currently `.../eWebLeave.o`). Add to the comment list above `CLIENT_OBJS`:

```
#   src/emscripten/eWebText.cpp    pulls name and chat text from the page's
#                                  phone inputs into the game, same byte-pin
#                                  reason as eWebNet.cpp.
```

- [ ] **Step 5: Build, then re-run the test.** Use the commands from Step 2.
Expected:
  - T1, T2 and T3 lines are all `"PASS":true`.
  - `[TEXT] chat dropped: not connected` appears **once**.
  - The console has `[TEXT] name set to gatetester`.

- [ ] **Step 6: The dedicated wasm is unchanged**

```sh
make -f web/Makefile dedicated -j8 && stat -f %z web/dist-m0/armagetronad-dedicated.wasm && md5 -q web/dist-m0/armagetronad-dedicated.wasm
```
Expected: `2488298` and `9718a2a64978cb6e9b95ea2f0454cca5`. If not, stop and find the unguarded change.

- [ ] **Step 7: Commit**

```bash
git add src/emscripten/eWebText.cpp web/Makefile web/tools/text-bridge-gate.steps
git commit -F /tmp/msg-t1.txt   # "client: take name and chat text from the page" + why + attribution
```

---

### Task 2: A unique default name — `web_NNNN`

**Files:**
- Modify: `web/Makefile` (append `ENV` to `-sEXPORTED_RUNTIME_METHODS=…`, and extend the comment above it)
- Modify: `web/shell.html` (one more function in `Module.preRun`)
- Create: `web/tools/default-name-gate.steps`

**Interfaces:**
- Produces: `window.AA_DEFAULT_NAME` (a string like `web_4821`), and `[TEXT] default name <name>` on the console.
- Consumed by: Task 3's first-visit check (`/^web_\d{4}$/`).

- [ ] **Step 1: Write the failing test** `web/tools/default-name-gate.steps`:

```
# Task 2 test: a fresh profile gets a web_NNNN default, not web_user.
until:1:120000:[BOOT] autostart
wait:9000
key:Enter
wait:3000
key:Escape
until:1:30000:[PERSISTSAVE] menu-leave
wait:2000
eval:(()=>{const b=Module.FS.readFile('/persist/var/user.cfg');let c='';for(const x of b)c+=String.fromCharCode(x);const m=/^PLAYER_1\s+(.*)$/m.exec(c);const v=m&&m[1].trim();console.log('[TEXTGATE] D1 default-name '+JSON.stringify({saved:v,page:window.AA_DEFAULT_NAME||null,PASS:/^web_\d{4}$/.test(v||'')&&v===window.AA_DEFAULT_NAME}));return 'D1'})()
```

- [ ] **Step 2: Run it to verify it fails.** Use the same runner command as Task 1 Step 2, with `default-name-gate.steps` and `--out /tmp/default-name`.
Expected: D1 `"PASS":false`, `saved: "web_user"`.

- [ ] **Step 3: Export `ENV`.** In `web/Makefile`, change `-sEXPORTED_RUNTIME_METHODS=callMain,FS,IDBFS,addRunDependency,removeRunDependency` to `...,removeRunDependency,ENV`. Then add to the numbered list in the comment above it:

```
#   ENV        -- web/shell.html's preRun replaces Emscripten's hard-coded
#                 USER=web_user (libwasi.js), which the game reads with
#                 getenv("USER") for the default player name, with web_NNNN.
```

- [ ] **Step 4: Set it in `preRun`.** In `web/shell.html`, `Module.preRun` is an array holding the persistence mount. Add a second entry **after** it:

```js
      // THE DEFAULT NAME. Emscripten's environment says USER=web_user, and the
      // game reads getenv("USER") for the name a new player starts with -- so
      // every browser player was "web_user". A saved name (user.cfg) still
      // wins; this is only what a first visit starts from.
      () => {
        const name = 'web_' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        try {
          Module.ENV.USER = name;
          Module.ENV.LOGNAME = name;
          window.AA_DEFAULT_NAME = name;
          console.log('[TEXT] default name ' + name);
        } catch (e) { console.log('[TEXT] default name not set: ' + e); }
      },
```

- [ ] **Step 5: Build and re-run.**
Expected: D1 `"PASS":true`, with `saved` matching `web_NNNN` and equal to `page`.

- [ ] **Step 6: Commit** `web/Makefile`, `web/shell.html` and `web/tools/default-name-gate.steps`.

---

### Task 3: The page — name dialog, chat bar, button corner

**Files:**
- Modify: `web/shell.html`: viewport meta; CSS; markup inside `#touch` (the corner) and at `body` level (the two overlays); a new script block after "LEAVE A SERVER CLEANLY WHEN THE PAGE HAS BEEN HIDDEN".
- Create: `web/tools/text-ui-gate.steps`

**Interfaces:**
- Consumes: Task 1's `[TEXT]` lines; Task 2's `window.AA_DEFAULT_NAME`; `Module._aa_web_connected()` (`src/emscripten/eWebLeave.cpp`); `window.AA_RUNTIME_READY`; `window.AA_TOUCH`.
- Produces:
  - `window.AA_TEXT_PEEK(kind)`, `window.AA_TEXT_TAKE(kind)`, `window.AA_TEXT_QUEUE(kind, text)` (the last is used by tests);
  - `window.AA_TEXT_OPEN` (true while an overlay is open);
  - DOM ids `aa-corner`, `chatbtn`, `namebtn`, `aa-namedlg`, `aa-nameform`, `aa-name`, `aa-name-cancel`, `aa-chatbar`, `aa-chatform`, `aa-chat`, `aa-chat-close`;
  - the class `aa-connected` on `#touch`;
  - console lines `[TEXT] name dialog open (first visit)`, `[TEXT] name queued`, `[TEXT] chat queued`.

- [ ] **Step 1: Write the failing test** `web/tools/text-ui-gate.steps`. Drive it with `--mobile 412,915,3` (portrait) **and** `--mobile 915,412,3` (landscape):

```
# Task 3 test: the phone text UI. Run portrait and landscape.
until:1:120000:[BOOT] autostart
eval:(()=>{for(const t of ['keydown','keyup','keypress'])window.addEventListener(t,e=>{if(e.key==='Unidentified'){e.stopImmediatePropagation();e.preventDefault();}},true);window.__sdlSaw=0;document.addEventListener('keydown',()=>{window.__sdlSaw++});return 'filters on'})()
wait:4000
eval:(()=>{const d=document.getElementById('aa-namedlg');console.log('[TEXTGATE] U1 first-visit-dialog '+JSON.stringify({open:!!d&&!d.hidden,PASS:!!d&&!d.hidden}));return 'U1'})()
eval:(()=>{window.__sdlSaw=0;return 'counter reset'})()
key:b
key:Left
key:Enter
eval:(()=>{console.log('[TEXTGATE] U2 keys-stay-in-the-dialog '+JSON.stringify({reachedDocument:window.__sdlSaw,PASS:window.__sdlSaw===0}));return 'U2'})()
eval:(()=>{const i=document.getElementById('aa-name');i.value='phoneplayer';document.getElementById('aa-nameform').requestSubmit();return 'submitted'})()
wait:2000
until:1:10000:[TEXT] name set to phoneplayer
key:Enter
wait:2500
key:Escape
until:1:30000:[PERSISTSAVE] menu-leave
wait:2000
eval:(()=>{const b=Module.FS.readFile('/persist/var/user.cfg');let c='';for(const x of b)c+=String.fromCharCode(x);const m=/^PLAYER_1\s+(.*)$/m.exec(c);console.log('[TEXTGATE] U3 name-survives-first-setup '+JSON.stringify({saved:m&&m[1],PASS:!!m&&m[1].trim()==='phoneplayer'}));return 'U3'})()
eval:(()=>{const g=(id)=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return {shown:getComputedStyle(e).display!=='none',l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top),b:Math.round(r.bottom)}};const sq=document.getElementById('canvas').getBoundingClientRect();const r={chat:g('chatbtn'),name:g('namebtn'),layout:g('layoutbtn'),squareBottom:Math.round(sq.bottom),gameboy:document.documentElement.classList.contains('aa-gameboy'),innerW:innerWidth};const ok=r.chat&&!r.chat.shown&&r.name&&r.name.shown&&r.layout&&r.layout.shown&&r.name.r<=r.layout.l&&r.layout.r<=r.innerW&&(!r.gameboy||r.name.t>=r.squareBottom);console.log('[TEXTGATE] U4 corner-in-menus '+JSON.stringify(Object.assign(r,{PASS:!!ok})));return 'U4'})()
eval:(()=>{document.getElementById('namebtn').click();const d=document.getElementById('aa-namedlg');const r={open:!d.hidden,value:document.getElementById('aa-name').value};document.getElementById('aa-name-cancel').click();r.closed=d.hidden;console.log('[TEXTGATE] U5 name-button-reopens '+JSON.stringify(Object.assign(r,{PASS:r.open&&r.value==='phoneplayer'&&r.closed})));return 'U5'})()
eval:(()=>{window.__realConnected=Module._aa_web_connected;Module._aa_web_connected=()=>1;return 'connected stubbed (the page re-checks every 500 ms)'})()
wait:1200
eval:(()=>{const b=document.getElementById('chatbtn');const shown=getComputedStyle(b).display!=='none';b.click();const bar=document.getElementById('aa-chatbar');const cv=document.getElementById('canvas').getBoundingClientRect();window.__cv=[cv.width,cv.height];const br=bar.getBoundingClientRect();const sq=cv.bottom;const gb=document.documentElement.classList.contains('aa-gameboy');const r={buttonShown:shown,barOpen:!bar.hidden,barTop:Math.round(br.top),barBottom:Math.round(br.bottom),squareBottom:Math.round(sq),vh:innerHeight,gameboy:gb};r.PASS=r.buttonShown&&r.barOpen&&(gb?Math.abs(r.barTop-r.squareBottom)<=2:r.barBottom<=r.vh&&r.barBottom>=r.vh-2);console.log('[TEXTGATE] U6 chat-bar-placement '+JSON.stringify(r));return 'U6'})()
eval:(()=>{const c=document.querySelector('meta[name=viewport]').getAttribute('content');console.log('[TEXTGATE] U7 keyboard-overlays-not-resizes '+JSON.stringify({content:c,PASS:/interactive-widget=resizes-visual/.test(c)}));return 'U7'})()
eval:(()=>{window.__sdlSaw=0;return 'reset'})()
key:b
key:Enter
eval:(()=>{console.log('[TEXTGATE] U8 keys-stay-in-the-chat-bar '+JSON.stringify({reachedDocument:window.__sdlSaw,PASS:window.__sdlSaw===0}));return 'U8'})()
eval:(()=>{Module._aa_web_connected=window.__realConnected;return 'connected restored'})()
wait:1200
eval:(()=>{const r={barClosed:document.getElementById('aa-chatbar').hidden,chatbtn:getComputedStyle(document.getElementById('chatbtn')).display};console.log('[TEXTGATE] U10 bar-closes-when-disconnected '+JSON.stringify(Object.assign(r,{PASS:r.barClosed&&r.chatbtn==='none'})));return 'U10'})()
eval:location.reload()
until:2:120000:[BOOT] autostart
wait:4000
eval:(()=>{const d=document.getElementById('aa-namedlg');console.log('[TEXTGATE] U9 asks-only-once '+JSON.stringify({open:!!d&&!d.hidden,PASS:!!d&&d.hidden}));return 'U9'})()
```

Notes for the implementer:
- U7 checks the viewport tag rather than simulating a keyboard. Emulation opens no keyboard, and resizing the emulated window is not what `resizes-visual` does: that would shrink the window, which in landscape *should* resize the canvas. The real behaviour is checked on a phone after merge.
- U6/U8/U10 stub `Module._aa_web_connected` so the page believes it is connected, without a server, and restore it afterwards. U10 then shows the bar closes and 💬 hides once the connection is gone.
- U6 in **landscape** checks the bar's bottom against `innerHeight`, because in emulation no keyboard is open and `visualViewport` equals the window.
- The `key:` steps dispatch real key events to the **focused element**, so they land in the text box, and the document counter proves they stopped there.

- [ ] **Step 2: Run it (portrait and landscape) to verify it fails**

```sh
for spec in "portrait 412,915,3" "landscape 915,412,3"; do set -- $spec
  node web/tools/drive-browser.mjs --out /tmp/text-ui-$1 --mobile $2 \
       --url http://localhost:8008/armagetronad.html --script-file web/tools/text-ui-gate.steps > /dev/null 2>&1
  echo "== $1"; grep -o '\[console.log\] \[TEXTGATE\] U[0-9] [a-z-]*.*"PASS":[a-z]*' /tmp/text-ui-$1/console.log | sed 's/{.*"PASS"/ PASS/'
done
```
(zsh: run the two lines by hand; zsh doesn't word-split `$spec`.)
Expected: U1 `false`. The dialog doesn't exist yet, so later steps log errors or nothing.

- [ ] **Step 3: The viewport meta.** Change the `content` of `<meta name="viewport">` to
`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual`.
Put a comment above the `<meta>`:

```html
  <!-- interactive-widget=resizes-visual: the phone keyboard (name dialog,
       chat bar) must shrink only the VISUAL viewport. With resizes-content,
       the default on some browsers, it shrinks the layout viewport, and this
       page is 100dvh, so the game would be squeezed while the player types. -->
```

- [ ] **Step 4: The markup.** Inside `#touch`, replace the existing `<button type="button" id="layoutbtn" …>…</button>` element with the same element wrapped in the corner, and add the two new buttons **before** it:

```html
    <!--
      THE CORNER: 💬 chat (while connected), Name (in menus), and the layout
      switch (in menus), left to right. Portrait: just below the square;
      landscape: top-right. See docs/superpowers/plans/2026-09-30-mobile-keyboard.md.
    -->
    <div id="aa-corner">
      <button type="button" id="chatbtn" aria-label="Chat">&#128172;</button>
      <button type="button" id="namebtn" aria-label="Your name">Name</button>
      <!-- the existing #layoutbtn element, unchanged, goes here -->
    </div>
```

Add at `body` level, right after the closing `</div>` of `#touch`:

```html
  <div id="aa-namedlg" class="aa-textui" role="dialog" aria-modal="true" aria-labelledby="aa-name-title" hidden>
    <form id="aa-nameform" autocomplete="off">
      <label id="aa-name-title" for="aa-name">Your name</label>
      <input id="aa-name" maxlength="16" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
      <p class="aa-textui-hint">Other players see this on the servers.</p>
      <div class="aa-textui-row">
        <button type="button" id="aa-name-cancel">Cancel</button>
        <button type="submit">OK</button>
      </div>
    </form>
  </div>
  <div id="aa-chatbar" class="aa-textui" hidden>
    <form id="aa-chatform" autocomplete="off">
      <input id="aa-chat" maxlength="120" placeholder="Say something" enterkeyhint="send" aria-label="Chat message">
      <button type="submit" aria-label="Send">&#10148;</button>
      <button type="button" id="aa-chat-close" aria-label="Close">&#10005;</button>
    </form>
  </div>
```

- [ ] **Step 5: The CSS.** In the existing `#layoutbtn { … }` rule, **remove** `position:absolute;` and the `top:` / `right:` declarations, and remove the separate `html.aa-gameboy #layoutbtn { top:… }` rule: the corner now places it. Keep `#touch:not(.aa-driving) #layoutbtn { display:inline-flex; }`. Then add, every line indented:

```css
    /* THE CORNER takes over #layoutbtn's old position, so the layout button
       lands exactly where it was; 💬 and Name line up to its left. */
    #aa-corner { position:absolute; display:flex; gap:.4rem; align-items:center;
                 top:calc(.6rem + env(safe-area-inset-top, 0px));
                 right:calc(.6rem + env(safe-area-inset-right, 0px)); }
    html.aa-gameboy #aa-corner { top:calc(var(--aa-square, 100vw) + .5rem); }
    #chatbtn, #namebtn { display:none; align-items:center; justify-content:center;
                 min-height:44px; min-width:44px; padding:.35rem .7rem;
                 color:#cfd3dc; background:rgba(0,0,0,.55);
                 border:1px solid rgba(255,255,255,.3); border-radius:.5rem;
                 font:600 .8rem/1.2 ui-monospace, Menlo, "Roboto Mono", monospace;
                 -webkit-tap-highlight-color:transparent; -webkit-user-select:none; user-select:none; }
    #chatbtn { font-size:1.1rem; }
    #touch.aa-connected #chatbtn { display:inline-flex; }
    #touch:not(.aa-driving) #namebtn { display:inline-flex; }
    /* THE OVERLAYS. Above everything the game draws; system fonts, 16 px text
       so phones don't zoom into the field. */
    .aa-textui { position:fixed; z-index:30; color:#e8ebf2;
                 font:16px/1.3 system-ui, sans-serif; }
    .aa-textui[hidden] { display:none; }
    .aa-textui input { font:16px/1.3 system-ui, sans-serif; color:#fff;
                 background:#1b1f2a; border:1px solid rgba(255,255,255,.35);
                 border-radius:.4rem; padding:.55rem .6rem; min-width:0; }
    .aa-textui button { font:600 16px/1 system-ui, sans-serif; color:#e8ebf2;
                 background:#2a3142; border:1px solid rgba(255,255,255,.3);
                 border-radius:.4rem; min-height:44px; min-width:44px; padding:0 .8rem; }
    #aa-namedlg { inset:0; display:flex; align-items:flex-start; justify-content:center;
                 padding-top:12vh; background:rgba(0,0,0,.55); }
    #aa-namedlg[hidden] { display:none; }
    #aa-nameform { display:grid; gap:.6rem; width:min(20rem, 88vw);
                 background:#11141c; border:1px solid rgba(255,255,255,.25);
                 border-radius:.7rem; padding:1rem; }
    #aa-name-title { font-weight:600; }
    .aa-textui-hint { margin:0; font-size:13px; color:#9aa3b5; }
    .aa-textui-row { display:flex; justify-content:flex-end; gap:.5rem; }
    #aa-chatbar { left:0; right:0; top:0; padding:.4rem .5rem;
                 background:rgba(12,14,20,.92); border-top:1px solid rgba(255,255,255,.2); }
    #aa-chatform { display:flex; gap:.4rem; }
    #aa-chat { flex:1; }
```

- [ ] **Step 6: The script.** Add a new block right after the `LEAVE A SERVER CLEANLY WHEN THE PAGE HAS BEEN HIDDEN` IIFE:

```js
    // ---- TEXT FROM A PHONE: THE NAME DIALOG AND THE CHAT BAR -----------------
    // A phone shows its keyboard only for a real text box, and the game draws
    // everything into one canvas -- so these are HTML inputs, and their text
    // reaches the game through the slots below, which the game's own frame loop
    // empties (src/emscripten/eWebText.cpp). The page never calls the game with
    // a string: the game may be suspended mid-frame when a browser event runs.
    (() => {
      const q = { 1: null, 2: null };            // 1 = name, 2 = chat
      window.AA_TEXT_PEEK = (k) => q[k];
      window.AA_TEXT_TAKE = (k) => { const t = q[k]; q[k] = null; return t; };
      window.AA_TEXT_QUEUE = (k, t) => { q[k] = t; };
      window.AA_TEXT_OPEN = false;
      const clean = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
      const MARKER = '/persist/var/aa-name-asked';
      const $ = (id) => document.getElementById(id);
      const touch = $('touch'), dlg = $('aa-namedlg'), nameIn = $('aa-name'),
            bar = $('aa-chatbar'), chatIn = $('aa-chat');
      // KEYS TYPED HERE NEVER REACH THE GAME. SDL listens on document in the
      // bubble phase (libsdl.js), so stopping them at these roots is enough --
      // otherwise 'b' would toggle spectator mode and Enter would open the
      // game's own chat line.
      for (const root of [dlg, bar])
        for (const t of ['keydown', 'keyup', 'keypress'])
          root.addEventListener(t, (e) => e.stopPropagation());
      // user.cfg holds the name as latin-1 bytes (the game's encoding), so
      // it is decoded byte for byte, not as UTF-8.
      const savedName = () => {
        try {
          let t = '';
          for (const b of Module.FS.readFile('/persist/var/user.cfg')) t += String.fromCharCode(b);
          const m = /^PLAYER_1\s+(.*)$/m.exec(t);
          return m ? m[1].trim() : null;
        } catch (e) { return null; }
      };
      const openName = (first) => {
        nameIn.value = savedName() || window.AA_DEFAULT_NAME || '';
        dlg.hidden = false; window.AA_TEXT_OPEN = true;
        nameIn.focus(); nameIn.select();
        console.log('[TEXT] name dialog open' + (first ? ' (first visit)' : ''));
      };
      const closeName = () => {
        dlg.hidden = true; nameIn.blur(); window.AA_TEXT_OPEN = false;
        try { Module.FS.writeFile(MARKER, 'asked\n'); } catch (e) { /* no /persist: it asks again next time */ }
      };
      $('aa-nameform').addEventListener('submit', (e) => {
        e.preventDefault();
        const n = clean(nameIn.value, 16);
        if (n) { q[1] = n; console.log('[TEXT] name queued'); }
        closeName();
      });
      $('aa-name-cancel').addEventListener('click', closeName);
      // THE BAR SITS JUST ABOVE THE KEYBOARD, or right under the square in the
      // Game Boy layout when the keyboard is lower than that. visualViewport is
      // the part of the page the keyboard leaves visible.
      const placeBar = () => {
        if (bar.hidden) return;
        const vv = window.visualViewport;
        const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        let top = visibleBottom - bar.offsetHeight;
        if (document.documentElement.classList.contains('aa-gameboy')) {
          const sq = $('canvas').getBoundingClientRect().bottom;
          top = Math.min(top, sq);
        }
        bar.style.top = Math.max(0, Math.round(top)) + 'px';
      };
      if (window.visualViewport) {
        visualViewport.addEventListener('resize', placeBar);
        visualViewport.addEventListener('scroll', placeBar);
      }
      const openChat = () => {
        bar.hidden = false; window.AA_TEXT_OPEN = true;
        chatIn.value = ''; placeBar(); chatIn.focus();
      };
      const closeChat = () => { bar.hidden = true; chatIn.blur(); window.AA_TEXT_OPEN = false; };
      $('aa-chatform').addEventListener('submit', (e) => {
        e.preventDefault();
        const s = clean(chatIn.value, 120);
        if (s) { q[2] = s; console.log('[TEXT] chat queued'); }
        closeChat();
      });
      $('aa-chat-close').addEventListener('click', closeChat);
      $('chatbtn').addEventListener('click', openChat);
      $('namebtn').addEventListener('click', () => openName(false));
      // CONNECTED STATE AND THE FIRST-VISIT PROMPT, every half second once the
      // game runs. _aa_web_connected() only reads a value (eWebLeave.cpp).
      let checkedFirstVisit = false;
      setInterval(() => {
        if (window.AA_RUNTIME_READY !== true) return;
        let connected = false;
        try { connected = typeof Module._aa_web_connected === 'function' && Module._aa_web_connected() === 1; } catch (e) {}
        touch.classList.toggle('aa-connected', connected);
        if (!connected && !bar.hidden) closeChat();
        if (!checkedFirstVisit && window.AA_TOUCH) {
          checkedFirstVisit = true;
          let asked = false;
          try { asked = Module.FS.analyzePath(MARKER).exists; } catch (e) {}
          const n = savedName();
          if (!asked && (!n || n === 'web_user' || /^web_\d{4}$/.test(n))) openName(true);
        }
      }, 500);
    })();
```

Note on focus and the phone keyboard: phones open their keyboard only when a field is focused **during a tap**. The 💬 and Name buttons call `focus()` inside their click handler, so the keyboard opens at once. The first-visit dialog opens on its own, without a tap, so there the player taps the field to bring the keyboard up. This is expected; don't try to work around it.

- [ ] **Step 7: Build and run both orientations** (the Step 2 commands).
Expected: U1–U10 are all `"PASS":true` in **both** portrait and landscape.

- [ ] **Step 8: The existing phone gates still pass.** The corner moved `#layoutbtn` into a container, so re-run them:

```sh
node web/tools/drive-browser.mjs --out /tmp/pb --mobile 412,915,3 --url http://localhost:8008/armagetronad.html --script-file web/tools/portrait-boot-gate.steps > /dev/null 2>&1
echo "portrait: true=$(grep -c '=> "[A-Z0-9]* true"' /tmp/pb/console.log) false=$(grep -c '=> "[A-Z0-9]* false"' /tmp/pb/console.log)"
```
Expected: `true=10 false=0`. Also compare `/tmp/pb/pb-02-pad.png` side by side with a pre-change run: the layout button sits in the same place.

- [ ] **Step 9: Commit** `web/shell.html` and `web/tools/text-ui-gate.steps`.

---

### Task 4: The network gate — name and chat reach a real server

**Files:**
- Create: `bridge/test-server/text-var/autoexec.cfg`, `bridge/test-server/text-var/.gitignore` (a copy of `bridge/test-server/wait-var/.gitignore`)
- Create: `web/tools/text-net-gate.steps`, `web/tools/run-text-net-gate.sh`
- Create: `docs/evidence/mobile-keyboard/` (`README.md` and the run's outputs)

**Interfaces:**
- Consumes: Tasks 1–3; the `aa-dedicated` image; the local relay.
- Produces: `sh web/tools/run-text-net-gate.sh <out-dir>`; exits 0 with `ALL PASSED`.

- [ ] **Step 1: Server config** `bridge/test-server/text-var/autoexec.cfg`:

```
# Mobile-keyboard gate (web/tools/run-text-net-gate.sh). Waits for a second
# player (so the client stays connected) and writes chat and renames to the
# ladder log, which CONSOLE_LADDER_LOG echoes into the server's output.
MIN_PLAYERS 2
NUM_AIS 0
AUTO_AIS 0
TEAM_BALANCE_WITH_AIS 0
CONSOLE_LADDER_LOG 1
LADDERLOG_WRITE_CHAT 1
LADDERLOG_WRITE_PLAYER_RENAMED 1
```

- [ ] **Step 2: The steps** `web/tools/text-net-gate.steps`. Run it in portrait at `--mobile 412,915,3`, with `?bridge=ws://127.0.0.1:8010`:

```
# Task 4: a phone player names itself, joins the local server, renames while
# connected, and chats. The runner reads the server's ladder log.
until:1:120000:[BOOT] autostart
eval:(()=>{for(const t of ['keydown','keyup','keypress'])window.addEventListener(t,e=>{if(e.key==='Unidentified'){e.stopImmediatePropagation();e.preventDefault();}},true);return 'filter on'})()
wait:4000
eval:(()=>{document.getElementById('aa-name').value='phoneplayer';document.getElementById('aa-nameform').requestSubmit();return 'named'})()
until:1:10000:[TEXT] name set to phoneplayer
key:Enter
wait:2500
key:Escape
until:1:30000:[PERSISTSAVE] menu-leave
wait:2000
eval:(()=>{const s=getComputedStyle(document.getElementById('chatbtn')).display;console.log('[TEXTGATE] N1 no-chat-before-joining '+JSON.stringify({chatbtn:s,PASS:s==='none'}));return 'N1'})()
key:Enter
wait:2500
key:Enter
wait:3500
key:Down:3
wait:1500
key:Enter
wait:3000
key:Enter
wait:12000
eval:(()=>{const s=getComputedStyle(document.getElementById('chatbtn')).display;console.log('[TEXTGATE] N2 chat-when-connected '+JSON.stringify({chatbtn:s,PASS:s!=='none'}));return 'N2'})()
eval:(()=>{document.getElementById('chatbtn').click();document.getElementById('aa-chat').value='hello from a phone';document.getElementById('aa-chatform').requestSubmit();return 'chat submitted'})()
until:1:10000:[TEXT] chat sent
key:Escape
wait:2000
eval:(()=>{document.getElementById('namebtn').click();document.getElementById('aa-name').value='phonerenamed';document.getElementById('aa-nameform').requestSubmit();return 'renamed'})()
until:1:10000:[TEXT] name set to phonerenamed
wait:3000
```

- [ ] **Step 3: The runner** `web/tools/run-text-net-gate.sh`. Use `web/tools/run-leave-hidden-gate.sh` as the template, with these differences:
  - the var dir is `bridge/test-server/text-var`;
  - the page URL is `http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010`;
  - the driver gets `--mobile 412,915,3`;
  - the steps file is `text-net-gate.steps`.

  The checks, in the same `check` style:

```sh
check "N1: no chat button before joining" grep -qF '[TEXTGATE] N1 no-chat-before-joining' "$C"
check "N1 passed" sh -c "grep -F '[TEXTGATE] N1' '$C' | grep -q '\"PASS\":true'"
check "N2: chat button once connected" sh -c "grep -F '[TEXTGATE] N2' '$C' | grep -q '\"PASS\":true'"
check "the server saw the chosen name join" grep -q 'phoneplayer entered the game' "$OUT/server.log"
check "the server logged the chat line" grep -qE 'CHAT phoneplayer hello from a phone' "$OUT/server.log"
check "the server logged the rename" grep -qE 'PLAYER_RENAMED phoneplayer phonerenamed' "$OUT/server.log"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
```

- [ ] **Step 4: Run it**

```sh
python3 -m http.server 8008 --directory web/dist-m1 &   # if not running
sh web/tools/run-text-net-gate.sh docs/evidence/mobile-keyboard/net
```
Expected: `--- text-net gate: ALL PASSED ---`.

If `PLAYER_RENAMED` is missing but `phoneplayer renamed to phonerenamed` appears in the server log, the ladder writer's name differs on this build. Relax that one check to the plain-text line and record why in the runner's header. Do not drop the check.

- [ ] **Step 5: Evidence README** `docs/evidence/mobile-keyboard/README.md`, covering:
  - what was run (the commands above), and the per-check PASS lines;
  - the Task 3 U1–U9 results for both orientations;
  - a note that emulation opens no real keyboard. U6/U7 stand in for it (placement against `innerHeight`, and a viewport resize); the first real-phone check is the maintainer's.

- [ ] **Step 6: Commit** the var dir (`autoexec.cfg`, `.gitignore`), the steps, the runner and the evidence.

---

### Task 5: Regression, docs

**Files:**
- Modify: `README.md` ("Controls → Phone" and "Known limitations")

- [ ] **Step 1: The whole regression set**

```sh
node web/tools/drive-browser.mjs --out /tmp/pb --mobile 412,915,3 --url http://localhost:8008/armagetronad.html --script-file web/tools/portrait-boot-gate.steps > /dev/null 2>&1
node web/tools/drive-browser.mjs --out /tmp/mg --url http://localhost:8008/armagetronad.html --script-file web/tools/menu-gate.steps > /dev/null 2>&1
make -f web/Makefile dedicated -j8 && stat -f %z web/dist-m0/armagetronad-dedicated.wasm && md5 -q web/dist-m0/armagetronad-dedicated.wasm
(cd bridge && npm test)
shellcheck -S info web/tools/*.sh
```
Expected:
- portrait `true=10 false=0`;
- desktop menu gate 10 screenshots, 10 distinct (count with `md5 -q /tmp/mg/*.png | sort -u | wc -l`);
- dedicated `2488298` / `9718a2a64978cb6e9b95ea2f0454cca5`;
- bridge tests all pass;
- shellcheck clean.

Look at `/tmp/pb/pb-02-pad.png` and `/tmp/mg/01-language-menu.png`: the pad and the desktop menu are unchanged.

- [ ] **Step 2: README.** Under "Controls → Phone", add:

```markdown
- **Your name:** on your first visit the game asks for it. Later, use the
  **Name** button in the menus. New players start as `web_` plus four digits.
- **Chat:** while you're on a server, tap **💬**. Your cycle keeps driving
  while you type, so chat between rounds or while watching.
```

In "Known limitations", change the phone-typing bullet to:

```markdown
- **Typing on a phone** covers your name and chat. Custom Connect and editing
  bookmarks still need a keyboard.
```

- [ ] **Step 3: Commit** `README.md`.

---

## After merge (maintainer, on a real phone)

1. **Name on first visit.** Open the published page in a fresh private tab on the phone. The name dialog appears and the phone keyboard opens; set a name.
2. **Chat, both layouts.** Join a quiet server, tap 💬 and send a line. In portrait the bar should sit right under the game square, with the keyboard over the pad. In landscape it should sit just above the keyboard.
3. **Nothing leaks from the keyboard.** Typing `b` or pressing Enter on the phone keyboard does nothing to the game.
4. **Record the results** in `docs/evidence/mobile-keyboard/README.md` under "Real phone".
