/*
Armagetron Advanced -- the camera's near-plane floor, tunable from the page.

THE SYMPTOM. On a phone, walls flicker where a cycle grinds along another wall
for a while -- the player's own or an AI's -- and a Mac shows nothing. It is
not sparks (?sparks=0 changes nothing) and not the halved touch camera
(?cam=1 changes nothing).

THE SUSPECT. eCamera::Render sets the near clipping plane to 0.3 x the camera's
distance to the arena rim, floored at 0.0001, with the far plane at 1e20. A
perspective depth buffer spends its precision in proportion to the near plane,
so as the camera nears the rim the precision at the walls collapses, and two
walls a fraction of a unit apart -- a grinding cycle's trail beside the wall it
is grinding -- stop being told apart. Both machines report 24 depth bits, but
Apple Silicon GPUs have no 24-bit depth format, so Chrome there quietly gives
WebGL a 32-bit float buffer, which hides the problem; the phone's is a real
24-bit integer one.

THIS FILE IS THE EXPERIMENT, NOT THE FIX. CAMERA_ZNEAR_MIN defaults to upstream's
0.0001, so nothing changes unless the page asks. web/shell.html's ?znear=
appends a value, and ?diag=1 shows the LOWEST raw near plane seen since the
last readout -- the minimum, because the readout refreshes every 500 ms and a
flicker is shorter than that. If raising the floor removes the flicker and the
readout shows the raw value sitting below it when it happened, the suspect is
confirmed and the value found becomes the touch default.

Client-only, and named in CLIENT_OBJS rather than $(SRCS): a file where $(SRCS)
can see it would change the dedicated server's size even with its body guarded
away (see web/Makefile).
*/

#include "config.h"

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "tConfiguration.h"
#include "eCamera.h"

#include <emscripten/emscripten.h>
#include <float.h>

static REAL se_zNearFloor = 0.0001f;
static tSettingItem< REAL > se_zNearFloorConf( "CAMERA_ZNEAR_MIN", se_zNearFloor );

// The lowest RAW near plane (before the floor) since the page last asked.
static float se_zNearRawMin = FLT_MAX;

float aa_web_znear_floor( float zNear )
{
    if ( zNear < se_zNearRawMin )
        se_zNearRawMin = zNear;
    return se_zNearFloor;
}

// Read-and-reset: the lowest raw near plane since the previous call, or a
// negative sentinel of -1e9 if no frame was rendered in between.
extern "C" EMSCRIPTEN_KEEPALIVE float aa_web_znear_raw_min( void )
{
    float m = se_zNearRawMin;
    se_zNearRawMin = FLT_MAX;
    return m == FLT_MAX ? -1e9f : m;
}

extern "C" EMSCRIPTEN_KEEPALIVE float aa_web_znear_floor_value( void )
{
    return se_zNearFloor;
}

#endif // __EMSCRIPTEN__ && !DEDICATED
