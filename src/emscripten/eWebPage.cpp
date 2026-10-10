/*
Armagetron Advanced -- what the web page asks the game, and what it asks the
game to do.

This module is everything the page asks the game (which input a tap means, is
a text field highlighted, is a chat line open or possible, is it connected)
and every request the page queues for the game loop (leave the server, look
around). Each section below is one question or one request; the exports keep
the names web/page/game.js calls (the page's one caller).

ONE SAFETY RULE COVERS EVERY EXPORT HERE. The page calls them from browser
events -- taps, timers, touch handlers, polls -- and the game spends nearly all
of its time parked inside an Asyncify unwind. Calling into wasm from a DOM
event is only safe for a function that cannot itself yield, so every export
below only reads a value or sets a flag, and reaches nothing that can get to
emscripten_sleep. Anything that has to act on the game (a disconnect, a
glance) runs later from the game's own frame loop, through an rPerFrameTask
called from rSysDep::SwapGL.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned -- $(SRCS) wildcards six game directories and src/emscripten is
not one of them. The #if below is belt and braces on top of that.
*/

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "ePlayer.h"
#include "eNetGameObject.h"
#include "eTimer.h"
#include "nNetwork.h"
#include "rScreen.h"
#include "tConsole.h"
#include "tSysTime.h"
#include "uInput.h"
#include "uMenu.h"

#include <emscripten/emscripten.h>

#include <stdio.h>
#include <string.h>
#include <typeinfo>

/*
===========================================================================
QUESTION: WHICH INPUT IS THE GAME ASKING FOR?  aa_web_input_context()
(phone feedback round 2)
===========================================================================

WHY IT EXISTS. web/shell.html's touch overlay turns a tap into a
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
    bit 1  AA_WEB_CTX_CYCLE    a LOCAL player has an object and that object is
                               Alive(), i.e. there is a cycle to steer.

The policy that combines them lives in web/page/game.js (context().driving),
where web/test/game.test.mjs checks it. Keeping the
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

WHY NOT A LINE IN eWebPersist.cpp. That file is about making a changed setting
durable; this is about input.
*/

// The page's copies are CTX_MENU and CTX_CYCLE in web/page/game.js.
// web/test/game.test.mjs reads these two lines and fails if they differ.
#define AA_WEB_CTX_MENU     1
#define AA_WEB_CTX_CYCLE    2

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
            ctx |= AA_WEB_CTX_CYCLE;
            break;
        }
    }

    return ctx;
}

/*
===========================================================================
QUESTIONS: IS A TEXT FIELD HIGHLIGHTED? IS A CHAT LINE OPEN, OR POSSIBLE?
aa_web_text_selected(), aa_web_chat_open(), aa_web_chat_possible()
===========================================================================

THE PHONE KEYBOARD TYPES INTO THE GAME'S OWN TEXT FIELDS.

A phone has no keyboard until a text field in the page is focused, and the
game's text fields (Player Setup's name, Custom Connect, the chat line) are
drawn into the canvas. So the page keeps a hidden <input> for the phone
keyboard and turns what is typed into key events for SDL
(web/page/phone-keyboard.js). What the page cannot see is WHEN one of the game's
text fields is highlighted; this section tells it.

uMenuItemString::Render calls se_WebTextSelected() each time it draws a
highlighted text field, and the page polls aa_web_text_selected(): 1 while
that happened within the last 0.3 s, 2 when that field is a password. A value
read, no string crosses, no game state changes. Client-only (CLIENT_OBJS), so
the dedicated build never sees it; the call site in uMenu.cpp is guarded the
same way.
*/

static double se_textSelectedAt = -1;
static bool se_textIsPassword = false;

// A PASSWORD FIELD IS TOLD APART BY ITS CLASS. The login prompt's field is an
// eMenuItemPassword (src/engine/ePlayer.cpp), local to that file, so it is
// recognised here by its RTTI name rather than by a change there. The page
// then makes its hidden input a password field, so the phone keyboard offers
// no suggestions and learns nothing typed into it.
void se_WebTextSelected( uMenuItemString * item )
{
    se_textSelectedAt = tSysTimeFloat();
    se_textIsPassword = item && strstr( typeid( *item ).name(), "eMenuItemPassword" ) != 0;
}

// 0: no text field highlighted; 1: a text field; 2: a password field.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_text_selected( void )
{
    if ( !( se_textSelectedAt >= 0 && tSysTimeFloat() - se_textSelectedAt < 0.3 ) )
        return 0;
    return se_textIsPassword ? 2 : 1;
}

// 1 while player 1's chat line is open (the game marks a chatting player for
// the "typing" indicator above its cycle; se_ChatState in ePlayer.cpp). The
// page reads it to close the chat line when the phone keyboard is put away,
// rather than leave an open "Say:" line with no keyboard to type into.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_chat_open( void )
{
    ePlayer * local = ePlayer::PlayerConfig( 0 );
    ePlayerNetID * net = local ? static_cast< ePlayerNetID * >( local->netPlayer ) : 0;
    return ( net && net->IsChatting() ) ? 1 : 0;
}

// 1 when Enter would really open a chat line on a server: connected, player 1
// has its network player with an ID the server assigned, and a game (its
// timer) is running. Connecting, logging in and downloading the map are all
// "connected" but have none of that yet, so the page's "Chat" label waits for
// this rather than for the connection alone. Waiting for the next round as a
// spectator counts: chat works there.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_chat_possible( void )
{
    if ( sn_GetNetState() != nCLIENT || !se_mainGameTimer )
        return 0;
    ePlayer * local = ePlayer::PlayerConfig( 0 );
    ePlayerNetID * net = local ? static_cast< ePlayerNetID * >( local->netPlayer ) : 0;
    return ( net && net->ID() != 0 ) ? 1 : 0;
}

/*
===========================================================================
QUESTION: CONNECTED?  aa_web_connected()
REQUEST: LEAVE THE SERVER.  aa_web_request_leave()
===========================================================================

Leave a server cleanly when the page has been hidden.

WHY THIS EXISTS. Every browser player reaches the game servers through the
relay, so every server sees them all as ONE address. Servers count kicks per
address and autoban it once there are too many ("This is an autoban from being
kicked too often" -- nNetwork.cpp, nMachine::OnKick): one server banned every
web player for 49+ minutes on 2026-09-30. The commonest kick is the idle kick
(ePlayer.cpp, IDLE_KICK_TIME, severity 1): a player whose tab is in the
background, or whose phone switched apps, stops sending input and is kicked.

A regular logout is not a kick: the in-game menu's "Disconnect" runs
ret_to_MainMenu(), which logs out through sn_SetNetState(nSTANDALONE), and a
logout or a timeout goes through sn_DisconnectUser without touching the kick
count. So web/shell.html, once the page has been hidden for a while, asks for
exactly that disconnect.

The disconnect runs from the game's frame loop (the header says why), exactly
as if the player had picked Disconnect.
*/

void ret_to_MainMenu(); // src/tron/gGame.cpp -- what the in-game menu's Disconnect calls

static bool se_leaveRequested = false;

// Called by the page (web/page/game.js, requestLeave).
extern "C" EMSCRIPTEN_KEEPALIVE void aa_web_request_leave( void )
{
    se_leaveRequested = true;
}

// 1 while connected to a server, so the page knows whether leaving means
// anything.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_connected( void )
{
    return sn_GetNetState() == nCLIENT ? 1 : 0;
}

static void se_LeaveIfRequested()
{
    if ( !se_leaveRequested )
        return;
    se_leaveRequested = false;
    if ( sn_GetNetState() != nCLIENT )
        return;
    emscripten_log( EM_LOG_CONSOLE, "[LEAVE] page hidden: leaving the server with a regular logout" );
    con << "Left the server while the page was in the background, so the server never had to kick you for idling.\n";
    ret_to_MainMenu();
}

// Registered before se_lookTask below, as it was when the two lived in
// eWebLeave.o and eWebLook.o (linked in that order): rPerFrameTask inserts at
// the head of its list, so the look task still runs first in each frame.
static rPerFrameTask se_leaveTask( &se_LeaveIfRequested );

/*
===========================================================================
REQUEST: LOOK AROUND.  aa_web_look()
===========================================================================

LOOKING AROUND ON A PHONE.

On a desktop the glance actions are held keys (GLANCE_LEFT, GLANCE_RIGHT,
GLANCE_BACK; config/keys_cursor.cfg binds j, l and k). A phone has none, so
web/shell.html ("LOOKING AROUND") turns a finger held on the game picture into
the same actions: the left or right half looks that way, the bottom strip
looks back. The page calls aa_web_look() with a bit for each look that is
held, and this section presses and releases the game's own actions to match.

WHY THE ACTIONS ARE FOUND BY NAME. eCamera's uActionCamera objects are
protected (src/engine/eCamera.h); uAction::Find looks an action up by the name
a binding uses, so nothing in the game's source has to change. They are acted
on through uPlayerPrototype::PlayerConfig(0)->Act, which is exactly what a key
bound to player 1 calls (uBindPlayer::DoActivate, src/ui/uInput.cpp). The
tooltip counter is not touched; the touch page switches those hints off.
*/

static int se_lookWanted = 0;   // bits the page asks for: 1 left, 2 right, 4 back
static int se_lookApplied = 0;  // bits last pressed in the game

// Called by the page from touch events (web/page/game.js, look); se_LookApply
// acts on the bits from the frame loop.
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
