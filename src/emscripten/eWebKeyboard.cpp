/*
 * THE PHONE KEYBOARD TYPES INTO THE GAME'S OWN TEXT FIELDS.
 *
 * A phone has no keyboard until a text field in the page is focused, and the
 * game's text fields (Player Setup's name, Custom Connect, the chat line) are
 * drawn into the canvas. So the page keeps a hidden <input> for the phone
 * keyboard and turns what is typed into key events for SDL (web/shell.html,
 * "THE PHONE KEYBOARD"). What the page cannot see is WHEN one of the game's
 * text fields is highlighted; this file tells it.
 *
 * uMenuItemString::Render calls se_WebTextSelected() each time it draws a
 * highlighted text field, and the page polls aa_web_text_selected(): 1 while
 * that happened within the last 0.3 s. A value read, no string crosses, no
 * game state changes. Client-only (CLIENT_OBJS), so the dedicated build never
 * sees it; the call site in uMenu.cpp is guarded the same way.
 */
#include <emscripten.h>

#include "ePlayer.h"
#include "eTimer.h"
#include "nNetwork.h"
#include "tSysTime.h"

static double se_textSelectedAt = -1;

void se_WebTextSelected()
{
    se_textSelectedAt = tSysTimeFloat();
}

extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_text_selected( void )
{
    return ( se_textSelectedAt >= 0 && tSysTimeFloat() - se_textSelectedAt < 0.3 ) ? 1 : 0;
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
