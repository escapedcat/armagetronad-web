/*
Armagetron Advanced -- keep wall geometry from reaching the GPU level with the camera.

THE SYMPTOM. On an Android phone, single frames show a comb of thin lines in a
wall's colour, shooting from that wall to the edge of the screen. Screen
recordings put it at about three events in 44 seconds, on a plain build.

THE PATTERN. In each of four recorded events, a wall of the comb's colour ran
from in front of the camera to behind it -- usually the followed cycle's own
trail, seen edge-on and passing under the camera.

THE SUSPECT. A vertex almost exactly level with the camera has clip-space w
near zero. The GPU is meant to clip it away before the perspective divide;
desktop GPUs do, and a phone GPU that cuts corners there divides out to huge
screen coordinates -- long lines to the screen edge, for the rare frames in
which a vertex lands in that plane.

WHAT IT DOES. With WALL_CUT on, each piece of a player's wall is cut before it
is drawn so that its base and its top are both at least CUT_EPS in front of
the camera. The cut is straight across the wall, so a piece stays a quad with
its texture coordinates shortened to match; a piece with nothing left is
skipped. Geometry that close is inside the near clipping plane anyway, so
nothing visible goes -- and roughly a third of all wall pieces, lying wholly
behind the camera, are no longer sent to the GPU at all.

THE EVIDENCE. Phone screen recordings, counted frame by frame with
web/tools/find-comb-frames.py (docs/evidence/phone-wall-comb/): plain, 4 comb
events in 112 s of play; with the cut, 0 in 110 s. The pattern fits all five
captured events, including the first, recorded under a different build.

WHO GETS IT. web/shell.html writes WALL_CUT 1 on touch devices; the desktop
never showed the comb and keeps upstream's drawing. ?wallcut=0 switches it off
on a phone, ?wallcut=1 switches it on anywhere. The setting's own default is
off, so a build without that page behaves exactly as upstream.

Walls are drawn at heights 0 to 1 (gNetPlayerWall::RenderNormal: h = 1, and
extrarise is 0 outside XDEBUG), so those are the two heights checked, with a
little margin on top for the growing end's skew.

Client-only, and named in CLIENT_OBJS rather than $(SRCS): a file where $(SRCS)
can see it would change the dedicated server's size even with its body guarded
away (see web/Makefile).
*/

#include "config.h"

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "rSDL.h"
#include "rRender.h"
#include "eCoord.h"
#include "tConfiguration.h"

#include <emscripten/emscripten.h>

static bool se_wallCut = false;
static tSettingItem< bool > se_wallCutConf( "WALL_CUT", se_wallCut );

static int se_wallCutChecked = 0;
static int se_wallCutPartial = 0;
static int se_wallCutWhole = 0;

static const float CUT_EPS = 0.05f;
static const float WALL_LO = 0.0f;
static const float WALL_HI = 1.05f;

// The part of [0, 1] where f1 + (f2 - f1) t >= CUT_EPS, as [lo, hi]; empty if lo > hi.
static void se_Keep( float f1, float f2, float & lo, float & hi )
{
    if ( f1 >= CUT_EPS && f2 >= CUT_EPS ) { lo = 0; hi = 1; return; }
    if ( f1 < CUT_EPS && f2 < CUT_EPS ) { lo = 1; hi = 0; return; }
    float t = ( CUT_EPS - f1 ) / ( f2 - f1 );
    if ( f1 < CUT_EPS ) { lo = t; hi = 1; } else { lo = 0; hi = t; }
}

bool aa_web_wall_cut( eCoord & p1, eCoord & p2, REAL & ta, REAL & te )
{
    if ( !se_wallCut )
        return true;
    ++se_wallCutChecked;

    // The quantity the GPU divides by is clip-space w, the fourth row of
    // PROJECTION x MODELVIEW. Both are needed: eCamera::Render applies the
    // camera (gluLookAt, glTranslatef) while the matrix mode is still
    // GL_PROJECTION, so the modelview alone is identity and every wall looks
    // as if it sits behind the camera -- which the first version of this file
    // did, and cut every wall piece there was. For the game's frustum, this w
    // is exactly the distance in front of the camera.
    GLfloat P[16], M[16], w4[4];
    glGetFloatv( GL_PROJECTION_MATRIX, P );
    glGetFloatv( GL_MODELVIEW_MATRIX, M );
    for ( int j = 0; j < 4; ++j )
        w4[j] = P[3] * M[4*j] + P[7] * M[4*j+1] + P[11] * M[4*j+2] + P[15] * M[4*j+3];
    #define AA_W( x, y, z ) ( w4[0] * (x) + w4[1] * (y) + w4[2] * (z) + w4[3] )

    float b1 = AA_W( p1.x, p1.y, WALL_LO ), t1 = AA_W( p1.x, p1.y, WALL_HI );
    float b2 = AA_W( p2.x, p2.y, WALL_LO ), t2 = AA_W( p2.x, p2.y, WALL_HI );
    #undef AA_W

    float blo, bhi, tlo, thi;
    se_Keep( b1, b2, blo, bhi );
    se_Keep( t1, t2, tlo, thi );
    float lo = blo > tlo ? blo : tlo;
    float hi = bhi < thi ? bhi : thi;

    if ( lo <= 0 && hi >= 1 )
        return true;                 // the whole piece is safely in front
    if ( lo >= hi )
    {
        ++se_wallCutWhole;           // nothing of it is
        return false;
    }

    ++se_wallCutPartial;
    eCoord d = p2 - p1;
    REAL dt = te - ta;
    eCoord n1 = p1 + d * lo, n2 = p1 + d * hi;
    REAL nta = ta + dt * lo, nte = ta + dt * hi;
    p1 = n1; p2 = n2; ta = nta; te = nte;
    return true;
}

// For checking the cut is live: pieces examined, shortened, and skipped.
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_wall_cut_checked( void ) { return se_wallCutChecked; }
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_wall_cut_partial( void ) { return se_wallCutPartial; }
extern "C" EMSCRIPTEN_KEEPALIVE int aa_web_wall_cut_whole( void ) { return se_wallCutWhole; }

#endif // __EMSCRIPTEN__ && !DEDICATED
