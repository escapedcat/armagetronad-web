/*
Armagetron Advanced -- M4 task 2: make a setting the player changed durable.

THE GAP THIS CLOSES. M4 task 1 made /persist an IDBFS mount that is populated
before main() and written back whenever a file under it is closed, so
st_SaveConfig() alone is both necessary and sufficient to persist user.cfg --
no FS.syncfs call is needed anywhere. What task 1 did NOT do is make that call
happen at a moment related to the player changing something. st_SaveConfig has
eleven call sites in this tree and rScreen.cpp's sr_InitDisplay /
lowlevel_sr_InitDisplay call it unconditionally on every boot (a crash
detector persisting FAILED_ATTEMPTS) and on every resolution change -- so the
config file is flushed often, just never *because* the player edited it. In
between, every edit is volatile: change your name, your colour or a toggle,
reload, and it is gone.

WHY A MENU-LEAVE CALLBACK IS THE PRIMARY MECHANISM. It runs while the page is
fully alive, inside the game's own loop, on a stack the game controls. It
needs no promise from the browser about unload timing, no visibility hook and
no storage API -- the three things that measure unreliable (see the comments
on the backstop in web/shell.html). Every menu in this game that edits
configuration binds its uMenuItem straight to the variable a tConfItem wraps
(uMenu.h's uMenuItemToggle / uMenuItemSelection / uMenuItemString all hold a
`T *target`), so by the time uMenu::OnEnter returns the in-memory config is
already the value the player chose. Saving there is saving exactly what they
just did.

WHY THE CALLBACK AND NOT AN EDIT TO uMenu.cpp. uMenu.cpp is one of the six
source directories web/Makefile wildcards into BOTH the browser client and the
dedicated server, and the dedicated server's wasm is byte-pinned. uMenu.h
already publishes uCallbackMenuLeave, which uMenu::OnEnter fires on the way
out of every menu (uMenu.cpp, uCallbackMenuLeave::MenuLeave), and registering
a callback from a file that only the client links cannot affect the dedicated
build at all. The #if below is belt and braces on top of that: web/Makefile
names this file in CLIENT_OBJS only.

WHAT IT DOES *NOT* COVER, deliberately recorded so nobody assumes otherwise:

  * uMenu::Message (uMenu.cpp) is not a uMenu::OnEnter at all -- it is a
    static function with its own event loop and it never fires MenuLeave. The
    welcome screens shown during first setup therefore do not save. This is
    visible in the gate: FIRST_USE is still 1 in the file after boot 1,
    because gArmagetron.cpp sets st_FirstUse=false only after
    sg_StartupPlayerMenu returns and the next thing that happens is a
    uMenu::Message.
  * The two early `return`s in uMenu::OnEnter for an empty item list bypass
    MenuLeave. Both are degenerate menus, neither edits configuration.
  * A change made in a menu the player never leaves (they close the tab with
    the menu still open) is the backstop's problem, not this one's.

WHY IT IS UNCONDITIONAL RATHER THAN DIRTY-TRACKED. There is no change
notification anywhere in tConfItemBase to hang a dirty flag on -- menu items
write through a raw pointer, not through the tConfItem -- so "did anything
change?" could only be answered by serialising the whole config and comparing,
which is most of the cost of just saving it. The file is ~22 KB, SaveAll is a
map walk with no I/O of its own, and the write lands in MEMFS; the IndexedDB
round trip that follows is asynchronous (libidbfs.js batches it behind a
setTimeout(0)). Booting already pays this cost twice via rScreen.cpp, so a
menu exit paying it once is not a new kind of cost.
*/

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "tConfiguration.h"
#include "uMenu.h"

#include <emscripten/emscripten.h>
#include <stdio.h>

// Counts saves issued from this file, so a transcript can tell "the save ran
// three times" from "the line was printed three times by three different
// mechanisms". printf and not `con <<`: the game console is rConsoleGraph in
// the client, and rConsoleGraph.cpp yields (emscripten_sleep) once per line of
// output. That is merely slow on the menu path -- and FATAL on the JS path
// below. See the warning on aa_web_save_config.
static unsigned int se_webPersistSaves = 0;

static void se_WebPersistSave( char const * reason )
{
    st_SaveConfig();

    // Emitted AFTER the save, so its presence in a transcript means the write
    // has already been made -- the ofstream in st_SaveConfig is destroyed at
    // the end of that call, which is what closes the fd, which is what queues
    // the IDBFS write-back.
    printf( "[PERSISTSAVE] %s n=%u\n", reason, ++se_webPersistSaves );
}

static void se_WebPersistSaveOnMenuLeave()
{
    se_WebPersistSave( "menu-leave" );
}

// THE REGISTRATION. A namespace-scope object whose constructor links itself
// into uMenu.cpp's leave_anchor list. That anchor is a file-static pointer
// with a constant NULL initialiser, so it is zero-initialised before any
// dynamic initialiser runs and the static initialisation order fiasco does
// not apply here. Same shape as uMenu.cpp's own su_noNewline registration.
//
// It is deliberately NOT in an anonymous namespace and deliberately not
// `static`: nothing references this object, and giving it external linkage
// removes any question about whether the linker is entitled to drop it.
//
// AA_WEB_NO_MENU_SAVE IS A CONTROL-BUILD SWITCH AND NOTHING ELSE. It is never
// defined by the `client` target; web/Makefile's `client-control` target
// defines it to link a second page, armagetronad-nomenusave.html, that is
// identical in every other respect and in which this callback does not exist.
// That page is what makes web/tools/persist-settings-gate.steps' checks
// falsifiable by a real browser running a real game, rather than by a mutated
// transcript. See docs/evidence/m4-persist-settings/README.md. Deleting this
// #ifndef deletes the control.
#ifndef AA_WEB_NO_MENU_SAVE
uCallbackMenuLeave se_webPersistMenuLeave( &se_WebPersistSaveOnMenuLeave );
#endif

// ---------------------------------------------------------------------------
// The JS entry point for web/shell.html's unload/visibility BACKSTOP.
//
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// !!  NOTHING REACHED FROM THIS FUNCTION MAY YIELD. NOT emscripten_sleep,  !!
// !!  NOT SDL_Delay, NOT tDelay, NOT `con <<`, NOT SwapGL -- NOTHING.      !!
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
//
// This is not a style rule, it is a correctness rule about Asyncify, and
// getting it wrong does not produce an error message.
//
// The client links -sASYNCIFY=1 (see web/Makefile) because the game has no
// frame callback: every loop in it is a plain while() that yields only at
// emscripten_sleep(0) in rSysDep::SwapGL. That means that at the moment a JS
// event handler runs, the wasm module is almost always PARKED inside such a
// sleep, with a whole game call stack saved in the Asyncify buffer waiting to
// be rewound.
//
// Re-entering wasm from that JS handler is nevertheless safe for a
// NON-YIELDING export, and that was measured rather than assumed: M4 recon
// read Asyncify.state during a beforeunload handler in both Chrome and
// Firefox while the module was parked in emscripten_sleep, and found it 0
// (State.Normal) in both. A normal-state call runs to completion on a fresh
// stack and returns, leaving the parked state untouched.
//
// A YIELDING call from here would instead start a SECOND unwind on top of a
// live one. Asyncify has exactly one rewind buffer and one state word; the
// second unwind overwrites both, and when the first sleep's timer eventually
// fires the runtime rewinds into a stack that no longer describes the frames
// it saved. The failure is silent corruption or an "unreachable" trap far
// from here, not a diagnostic naming this function.
//
// st_SaveConfig satisfies the rule today, and the reason is worth writing
// down so it can be re-checked rather than re-assumed: its whole body is a
// tPath::Open (an ofstream open plus umask/chmod) and tConfItemBase::SaveAll,
// which is a walk over the conf-item map writing to that stream. No sleep, no
// console output, no rendering. Its ONE console-writing path is the
// `con << tOutput("$config_file_write_error")` in the else branch when the
// file cannot be opened -- which, if it ever fires here, is itself a yield
// from a JS handler. It is left alone because it is the error path of a write
// to an IDBFS mount that has already been proven writable by this point in
// the run, and because silencing it would hide a real failure from the normal
// path too; but if that ever becomes reachable in practice, the fix is to
// give this function its own non-console save, not to remove this comment.
//
// EMSCRIPTEN_KEEPALIVE is what puts it in the export table and, with
// EXPORT_KEEPALIVE (on by default), what makes the loader assign
// Module['_aa_web_save_config']. No -sEXPORTED_FUNCTIONS entry is needed --
// and adding one would be a hazard, since EXPORTED_FUNCTIONS is a plain
// assignment that would drop the default _main.
// ---------------------------------------------------------------------------
extern "C" EMSCRIPTEN_KEEPALIVE void aa_web_save_config( void )
{
    se_WebPersistSave( "js-backstop" );
}

#endif // __EMSCRIPTEN__ && !DEDICATED
