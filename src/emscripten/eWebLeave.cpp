/*
Armagetron Advanced -- leave a server cleanly when the page has been hidden.

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

WHY A FLAG AND A PER-FRAME TASK, NOT A DIRECT CALL. The page's timer fires in
a browser event, and the game may be paused inside an Asyncify sleep at that
moment; running the disconnect from there would re-enter the game in the
middle of its own stack. aa_web_request_leave() only sets a flag -- the same
kind of export the touch pad already calls -- and the disconnect runs from the
game's own frame loop (rPerFrameTask, called from rSysDep::SwapGL), exactly as
if the player had picked Disconnect.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "nNetwork.h"
#include "rScreen.h"
#include "tConsole.h"

#include <emscripten/emscripten.h>

void ret_to_MainMenu(); // src/tron/gGame.cpp -- what the in-game menu's Disconnect calls

static bool sg_leaveRequested = false;

// Called by web/shell.html. Sets a flag and nothing else: it must not reach
// anything that could yield, because it runs from a browser timer.
extern "C" EMSCRIPTEN_KEEPALIVE void aa_web_request_leave( void )
{
    sg_leaveRequested = true;
}

// 1 while connected to a server, so the page knows whether leaving means
// anything. Same contract as aa_web_request_leave: reads a value, no yield.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_connected( void )
{
    return sn_GetNetState() == nCLIENT ? 1 : 0;
}

static void sg_LeaveIfRequested()
{
    if ( !sg_leaveRequested )
        return;
    sg_leaveRequested = false;
    if ( sn_GetNetState() != nCLIENT )
        return;
    emscripten_log( EM_LOG_CONSOLE, "[LEAVE] page hidden: leaving the server with a regular logout" );
    con << "Left the server while the page was in the background, so the server never had to kick you for idling.\n";
    ret_to_MainMenu();
}

static rPerFrameTask sg_leaveTask( &sg_LeaveIfRequested );

#endif
