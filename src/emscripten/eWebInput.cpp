/*
Armagetron Advanced -- phone feedback round 2: tell the page which input the
game is asking for.

WHY THIS FILE EXISTS. web/shell.html's touch overlay turns a tap into a
synthesised KeyboardEvent, and the maintainer asked for the overlay to shrink:
"instead of showing 4 buttons, return can just be 'tap the screen'? esc can be
top left?". A tap anywhere cannot mean Enter unconditionally, because during a
round the whole screen is already the two steering halves -- left half turns
left, right half turns right. A control that sometimes turns you and sometimes
confirms is worse than a button, so the page needs to know, at the instant of
the tap, which of the two the game would understand.

THE PAGE CANNOT WORK IT OUT ON ITS OWN. It can see the keys it sent and the
console lines the game printed, and neither is the state: a menu item can
start the game, a round can end on its own, and Escape mid-round opens the
in-game menu without any of it reaching the page. Only the game knows.

WHAT IS EXPORTED, AND WHY IT IS TWO FACTS RATHER THAN ONE DECISION.
aa_web_input_context() returns a bit field, not a verdict:

    bit 0  AA_WEB_CTX_MENU     uMenu::MenuActive() -- a uMenu is on screen and
                               its event loop is the thing reading keys.
    bit 1  AA_WEB_CTX_DRIVING  a LOCAL player has an object and that object is
                               Alive(), i.e. there is a cycle to steer.

The policy that combines them lives in web/shell.html, where it can be read
next to the handler it governs and where a gate can assert on it. Keeping the
two facts separate is also what makes the third state visible: neither bit set
is the welcome message, the round-end pause and the first frames of a boot --
places that want Enter and have no cycle, and that a single "is a menu active"
boolean would have got wrong, because uMenu::Message runs its OWN event loop
and never sets uMenu's su_inMenu.

WHY IT IS A GETTER AND NOT A PUSH. The alternative was a uCallbackMenuEnter /
uCallbackMenuLeave pair writing window.AA_IN_MENU from C++. That needs a depth
counter to survive nested submenus, it has state of its own that can drift from
the game's, and it still would not see uMenu::Message. A getter has no state,
cannot drift, and is read at exactly the moment the answer is needed.

CALLING IT FROM A TAP HANDLER IS SAFE, and the reason is specific rather than
optimistic. The game spends nearly all of its time parked inside an Asyncify
unwind, so calling into wasm from a DOM event is only safe for a function that
cannot itself yield. This one reads a static bool and walks at most MAX_PLAYERS
pointers; it calls nothing that can reach emscripten_sleep, so Asyncify does
not instrument it and there is no second unwind to start. That is the same
argument the unload backstop's aa_web_save_config already stands on -- and this
function is strictly weaker, because it writes nothing at all.

WHY A NEW FILE RATHER THAN A LINE IN eWebPersist.cpp. That file is about making
a changed setting durable; this is about input. web/Makefile names both in
CLIENT_OBJS only, so neither is compiled into the dedicated server, whose wasm
is byte-pinned -- $(SRCS) wildcards six game directories and src/emscripten is
not one of them. The #if below is belt and braces on top of that.
*/

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "ePlayer.h"
#include "eNetGameObject.h"
#include "uMenu.h"

#include <emscripten/emscripten.h>

// Kept in sync by hand with the two constants of the same name in
// web/shell.html. There is no way to share a number between a C++ file and a
// --shell-file, so the check is the touch gate: it asserts the context value
// the page reports against the state it drove the game into.
#define AA_WEB_CTX_MENU     1
#define AA_WEB_CTX_DRIVING  2

// ---------------------------------------------------------------------------
// EMSCRIPTEN_KEEPALIVE puts it in the export table and, with EXPORT_KEEPALIVE
// on by default, makes the loader assign Module['_aa_web_input_context']. No
// -sEXPORTED_FUNCTIONS entry is needed, and adding one would be a hazard --
// EXPORTED_FUNCTIONS is a plain assignment that would drop the default _main.
//
// LOCAL PLAYERS ONLY, via ePlayer::PlayerConfig rather than by walking
// se_PlayerNetIDs and testing IsHuman(). The Demo is single player against AI,
// so the two agree today; they stop agreeing the moment Phase 2 connects this
// build to a server, where another human's cycle is alive and is emphatically
// not the thing this device is steering. PlayerConfig is the list of players
// this machine controls, which is the question being asked.
//
// EVERY DEREFERENCE IS CHECKED. PlayerConfig returns the result of a
// dynamic_cast and can be null; netPlayer is a controlled pointer that is null
// until the player joins; Object() is null between rounds. Being wrong here is
// not a crash but something worse -- a tap that steers in a menu, or confirms
// during a round -- so the safe answer for "cannot tell" is 0, which the page
// reads as "not driving", i.e. Enter. A tap that does nothing in a round the
// player is not in beats a tap that turns them in a menu.
// ---------------------------------------------------------------------------
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_input_context( void )
{
    int ctx = 0;

    if ( uMenu::MenuActive() )
        ctx |= AA_WEB_CTX_MENU;

    for ( int i = 0; i < MAX_PLAYERS; ++i )
    {
        ePlayer * local = ePlayer::PlayerConfig( i );
        if ( !local )
            continue;
        ePlayerNetID * net = local->netPlayer;
        if ( !net )
            continue;
        eNetGameObject * object = net->Object();
        if ( object && object->Alive() )
        {
            ctx |= AA_WEB_CTX_DRIVING;
            break;
        }
    }

    return ctx;
}

#endif // __EMSCRIPTEN__ && !DEDICATED
