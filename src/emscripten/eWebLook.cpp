/*
LOOKING AROUND ON A PHONE.

On a desktop the glance actions are held keys (GLANCE_LEFT, GLANCE_RIGHT,
GLANCE_BACK; config/keys_cursor.cfg binds j, l and k). A phone has none, so
web/shell.html ("LOOKING AROUND") turns a finger held on the game picture into
the same actions: the left or right half looks that way, the bottom strip
looks back. The page calls aa_web_look() with a bit for each look that is
held, and this file presses and releases the game's own actions to match.

WHY THE ACTIONS ARE FOUND BY NAME. eCamera's uActionCamera objects are
protected (src/engine/eCamera.h); uAction::Find looks an action up by the name
a binding uses, so nothing in the game's source has to change. They are acted
on through uPlayerPrototype::PlayerConfig(0)->Act, which is exactly what a key
bound to player 1 calls (uBindPlayer::DoActivate, src/ui/uInput.cpp). The
tooltip counter is not touched; the touch page switches those hints off.

WHY A FLAG AND A PER-FRAME TASK, NOT A DIRECT CALL. Same reason as
eWebLeave.cpp: the page's touch events can fire while the game is paused
inside an Asyncify sleep, so aa_web_look() only stores the bits, and the
actions run from the game's own frame loop (rPerFrameTask, from SwapGL).

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "rScreen.h"
#include "uInput.h"

#include <emscripten/emscripten.h>
#include <stdio.h>

static int se_lookWanted = 0;   // bits the page asks for: 1 left, 2 right, 4 back
static int se_lookApplied = 0;  // bits last pressed in the game

// Called by web/shell.html from touch events. Stores the bits and nothing
// else: it must not reach anything that could yield.
extern "C" EMSCRIPTEN_KEEPALIVE void aa_web_look( int bits )
{
    se_lookWanted = bits & 7;
}

static void se_LookApply()
{
    if ( se_lookWanted == se_lookApplied )
        return;

    static char const * const names[3] = { "GLANCE_LEFT", "GLANCE_RIGHT", "GLANCE_BACK" };
    static char const * const words[3] = { "left", "right", "back" };

    uPlayerPrototype * player = uPlayerPrototype::Num() > 0 ? uPlayerPrototype::PlayerConfig( 0 ) : 0;
    for ( int i = 0; i < 3; ++i )
    {
        int bit = 1 << i;
        if ( ( se_lookWanted & bit ) == ( se_lookApplied & bit ) )
            continue;
        bool on = ( se_lookWanted & bit ) != 0;
        uAction * action = uAction::Find( names[i] );
        bool handled = player && action && player->Act( action, on ? 1 : 0 );
        printf( "[LOOK] %s %s (handled %d)\n", words[i], on ? "on" : "off", handled ? 1 : 0 );
    }
    se_lookApplied = se_lookWanted;
}

static rPerFrameTask se_lookTask( &se_LookApply );

#endif // __EMSCRIPTEN__ && !DEDICATED
