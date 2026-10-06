/*
INPUT LAG PROBE, the game's half (web/shell.html "INPUT LAG PROBE").

With ?inputlag=1 the page times every turn from the press to the moment the
game has applied it. "Applied" is read here, once per frame: the local
cycle's turn count (gCycleMovement::GetTurns) going up. The page polls
aa_web_lag_turns() and aa_web_lag_frames() and does the timing; this file
only stores two numbers each frame, from the game's own frame loop
(rPerFrameTask, called from SwapGL), so nothing is read mid-frame.

Turns are counted by the game's client prediction, i.e. when the turn shows
on this screen, not when the server confirms it. Online, the server can
still correct it later; that is network lag, which this does not measure.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "ePlayer.h"
#include "gCycleMovement.h"
#include "rScreen.h"

#include <emscripten/emscripten.h>

static int se_lagFrames = 0;
static int se_lagTurns = -1;   // -1: no live cycle of ours

static void se_LagSample()
{
    ++se_lagFrames;
    int turns = -1;
    ePlayer * local = ePlayer::PlayerConfig( 0 );
    ePlayerNetID * net = local ? static_cast< ePlayerNetID * >( local->netPlayer ) : 0;
    eNetGameObject * object = net ? net->Object() : 0;
    gCycleMovement * cycle = dynamic_cast< gCycleMovement * >( object );
    if ( cycle && cycle->Alive() )
        turns = cycle->GetTurns();
    se_lagTurns = turns;
}

static rPerFrameTask se_lagTask( &se_LagSample );

// Frames drawn so far: the page turns this into frames per second.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_lag_frames( void )
{
    return se_lagFrames;
}

// Turns the local cycle has taken, as of the last frame; -1 with no live cycle.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_lag_turns( void )
{
    return se_lagTurns;
}

#endif // __EMSCRIPTEN__ && !DEDICATED
