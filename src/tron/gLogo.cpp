/*

*************************************************************************

ArmageTron -- Just another Tron Lightcycle Game in 3D.
Copyright (C) 2000  Manuel Moos (manuel@moosnet.de)

**************************************************************************

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA  02111-1307, USA.
  
***************************************************************************

*/

#include "gLogo.h"

#include "gStuff.h"
#include "rTexture.h"
#include "rRender.h"
#include "rScreen.h"
#include "eCoord.h"
#include "uMenu.h"
#include "tSysTime.h"

// static rFileTexture sg_LogoTexture(rTextureGroups::TEX_FONT, "textures/KGN_logo.png",0,0,1);
static rISurfaceTexture* sg_LogoMPTitle = NULL;

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
// ---- PHONE FEEDBACK ROUND 2: the title picture is drawn at ITS shape -------
//
// THE DEFECT, WHICH IS "the image in the beginning" AND NOT THE 3D VIEW. Both
// quads below run from (-1,-1) to (1,1) with the full-screen menu viewport
// selected and no projection, i.e. the picture is scaled onto the WHOLE
// viewport whatever shape that is. textures/title.jpg is 800x600 -- exactly
// 4:3 -- so the horizontal magnification is the screen's aspect ratio divided
// by 4/3, and every feature of the picture is widened by that factor:
//
//     desktop 4:3  1.333 / 1.333 = 1.00x   the shape the artwork was drawn at
//     desktop 16:9 1.778 / 1.333 = 1.33x   upstream has always looked like this
//     phone 915x350 landscape, dpr 3
//                  2.614 / 1.333 = 1.96x   the two lightcycles are twice as wide
//
// Measured rather than reasoned: docs/evidence/phone-round2/logo/ renders the
// same first menu at both shapes and reports the horizontal spread of the
// picture's own blue content as a FRACTION of the screen width. Before this
// change that fraction is the same number at both aspects (0.229 against
// 0.231, i.e. the picture fills the width whatever the width is), which is the
// signature of a quad with no aspect correction in it.
//
// THIS FILE'S OWN NEIGHBOUR ALREADY DOES IT PROPERLY, and that is the argument
// for the shape of the fix rather than an invention of mine. gFloor.cpp's
// MenuBackground -- the animated grid drawn immediately before the call to
// Display() below -- scales its texture matrix by
// (sr_screenWidth*3.0)/(sr_screenHeight*4.0) precisely so the grid cells stay
// square on a widescreen. The grid was corrected for widescreen and the
// picture on top of it was not.
//
// PILLARBOX, NOT CROP. The other way to keep the aspect is to fill the width
// and let the top and bottom fall outside the viewport; at 2.61 that keeps the
// middle 51 % of the image and throws away both the "ARMAGETRON ADVANCED"
// title and the "PRESS ANY KEY TO START" line, which is worse than the defect.
// Fitting inside costs screen area and keeps the whole picture.
//
// WHY 4/3 IS HARD-CODED. rISurfaceTexture publishes no size accessor, so the
// texture cannot be asked. 4:3 is the shipped textures/title.jpg and it is the
// same constant MenuBackground hard-codes four lines away for the same reason.
// A moviepack that ships a differently-shaped moviepack/title.jpg would be
// pillarboxed to 4:3 as well -- no worse than the stretch it gets today, and
// there is no moviepack in this repository to measure.
//
// NATIVE IS UNTOUCHED. The #else gives the two halves the value 1, which is
// the literal the four Vertex() calls used before this block existed.
//
// !defined(DEDICATED) IS NOT DECORATION EITHER, even though every caller is
// already inside this file's own #ifndef DEDICATED. web/Makefile's $(SRCS)
// wildcards src/tron, so this file is compiled into the DEDICATED server too,
// whose wasm is byte-pinned at 2,488,298 / 9718a2a6. Without the second
// condition the helper is compiled there as an unused static -- discarded by
// -O2, and the relink does come out byte-identical, but by optimisation rather
// than by construction. This makes it structural.
//
// IF THIS IS EVER SENT UPSTREAM, SEND IT UNGUARDED. Nothing here is
// browser-specific: a native 16:9 or 21:9 desktop has exactly the same defect
// to exactly the same formula. The guard is this repository's rule for
// touching a file outside src/emscripten/, not a statement about the bug.
static void sg_LogoQuadHalfExtents( REAL & hx, REAL & hy )
{
    hx = 1;
    hy = 1;
    if ( sr_screenWidth <= 0 || sr_screenHeight <= 0 )
        return;                                  // before SDL_SetVideoMode
    REAL const logoAspect   = REAL(4)/REAL(3);   // textures/title.jpg is 800x600
    REAL const screenAspect = REAL(sr_screenWidth)/REAL(sr_screenHeight);
    if ( screenAspect > logoAspect )
        hx = logoAspect/screenAspect;            // screen wider than the picture
    else if ( screenAspect < logoAspect )
        hy = screenAspect/logoAspect;            // screen taller than the picture
}
#endif // __EMSCRIPTEN__ && !DEDICATED

static gLogo logo;

static bool sg_Displayed = true;
static bool sg_Spinning  = false;
static bool sg_Big       = true;

static eCoord sg_SpinStatus(1,0);    // current spinning position
static REAL   sg_SizeStatus(1);    // 1 -> big      , 0 -> small
static REAL   sg_DisplayStatus(-1); // 1 -> displayed, 0->invisible

void gLogo::SetDisplayed(bool d, bool immediately)
{
    if (sg_Displayed == false && d == true && sg_DisplayStatus < .01)
        sg_SpinStatus = eCoord(0, 1);

    sg_Displayed = d;
    if (immediately)
        sg_DisplayStatus = d ? 1 : 0;
}

void gLogo::SetSpinning(bool s)
{
    sg_Spinning = s;
    if (!s)
        sg_SpinStatus = eCoord(1, 0);
}
void gLogo::SetBig(bool b, bool immediately)
{
    sg_Big = b;
    if (immediately)
        sg_SizeStatus = b ? 1 : 0;

}

/*
static tString sg_title("Anonymous/original/textures/title.jpg");
static nSettingItem<tString> gg_title("TEXTURE_TITLE", sg_title);

static tString sg_mp_title("Anonymous/original/moviepack/title.jpg");
static nSettingItem<tString> gg_mp_title("TEXTURE_MP_TITLE", sg_mp_title);
*/

void gLogo::Display()
{
#ifndef DEDICATED
    if (!sr_glOut)
        return;

    if (sg_MoviePack() && !sg_LogoMPTitle)
    {
        sg_LogoMPTitle = tNEW(rFileTexture)(rTextureGroups::TEX_FONT, "moviepack/title.jpg",0,0,1);
        // sg_LogoMPTitle = tNEW(rFileTexture)(rTextureGroups::TEX_FONT, sg_mp_title, 0,0,1);
        sg_DisplayStatus = 1;
    }

    renderer->SetFlag(rRenderer::DEPTH_TEST, false);

    static REAL lasttime = 0;
    REAL time = tSysTimeFloat();
    REAL dt = time - lasttime;
    lasttime = time;

    if (!sg_Displayed && sg_DisplayStatus < .00001)
        return;

    if (sg_LogoMPTitle)
    {
        // update state variables
        if (sg_Displayed && sg_Big)
        {
            sg_DisplayStatus += dt;
            if (sg_DisplayStatus > 1)
                sg_DisplayStatus = 1;
        }
        else
        {
            sg_DisplayStatus -= dt;
            if (sg_DisplayStatus < 0)
                sg_DisplayStatus = 0;
        }

        if (sg_DisplayStatus <= .01)
            return;

        sg_LogoMPTitle->Select();

        if(!sg_LogoMPTitle->Loaded())
            return;

        Color(1,1,1, sg_DisplayStatus);

        // The half-extents of the quad. 1 and 1 -- the literals this used to
        // draw -- everywhere except the browser client, where they fit the
        // picture to its own 4:3 instead of to the window. See the long
        // comment on sg_LogoQuadHalfExtents.
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
        REAL hx, hy;
        sg_LogoQuadHalfExtents( hx, hy );
#else
        REAL const hx = 1, hy = 1;
#endif

        BeginQuads();
        TexCoord(0,0);
        Vertex(-hx, hy);

        TexCoord(0,1);
        Vertex(-hx, -hy);

        TexCoord(1,1);
        Vertex(hx, -hy);

        TexCoord(1,0);
        Vertex(hx, hy);

        RenderEnd();
    }
    else
    {
#ifndef KRAWALL
        sg_LogoMPTitle = tNEW(rFileTexture)(rTextureGroups::TEX_FONT, "textures/title.jpg",0,0,1);
        // sg_LogoMPTitle = tNEW(rFileTexture)(rTextureGroups::TEX_FONT, sg_title,0,0,1);

        sg_DisplayStatus = 1;

        // update state variables
        if (sg_Displayed && sg_Big)
        {
            sg_DisplayStatus += dt;
            if (sg_DisplayStatus > 1)
                sg_DisplayStatus = 1;
        }
        else
        {
            sg_DisplayStatus -= dt;
            if (sg_DisplayStatus < 0)
                sg_DisplayStatus = 0;
        }

        if (sg_DisplayStatus <= .01)
            return;

        sg_LogoMPTitle->Select();

        if (!sg_LogoMPTitle->Loaded())
            return;

        Color(1,1,1, sg_DisplayStatus);

        // The half-extents of the quad. 1 and 1 -- the literals this used to
        // draw -- everywhere except the browser client, where they fit the
        // picture to its own 4:3 instead of to the window. See the long
        // comment on sg_LogoQuadHalfExtents.
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
        REAL hx, hy;
        sg_LogoQuadHalfExtents( hx, hy );
#else
        REAL const hx = 1, hy = 1;
#endif

        BeginQuads();
        TexCoord(0,0);
        Vertex(-hx, hy);

        TexCoord(0,1);
        Vertex(-hx, -hy);

        TexCoord(1,1);
        Vertex(hx, -hy);

        TexCoord(1,0);
        Vertex(hx, hy);

        RenderEnd();
#endif	  

#ifdef KRAWALL
        sg_LogoTexture.Select();

        if ( !sg_LogoTexture.Loaded() )
        {
            return;
        }

        // update state variables
        if (sg_Spinning)
        {
            sg_SpinStatus = sg_SpinStatus.Turn(1, dt * 2 * .2 / (sg_SizeStatus + .2));
            sg_SpinStatus = sg_SpinStatus * (1/sqrt(sg_SpinStatus.NormSquared()));
        }

        if (sg_Big)
        {
            sg_SizeStatus += dt;
            if (sg_SizeStatus > 1)
                sg_SizeStatus = 1;
        }
        else
        {
            sg_SizeStatus *= (1 - 2 * dt);
            //      if (sg_SizeStatus < 0)
            //	sg_SizeStatus = 0;
        }

        if (sg_Displayed)
        {
            sg_DisplayStatus += dt;
            if (sg_DisplayStatus > 1)
                sg_DisplayStatus = 1;
        }
        else
        {
            sg_DisplayStatus -= dt*.3;
            if (sg_DisplayStatus < 0)
                sg_DisplayStatus = 0;
        }

        if (sg_DisplayStatus <= 0)
            return;

        eCoord center(.8*(sg_SizeStatus*sg_SizeStatus-1), .8*(1-sg_SizeStatus));
        REAL e =.8 * (sg_SizeStatus + .1);
        eCoord extension(e, - .7 * e * fabs(sg_SpinStatus.x));

        eCoord ur = center - extension;
        eCoord ll = center + extension;

        Color(1,1,1, sg_DisplayStatus);

        BeginQuads();
        TexCoord(0,0);
        Vertex(ur.x, ur.y);

        TexCoord(0,1);
        Vertex(ur.x, ll.y);

        TexCoord(1,1);
        Vertex(ll.x, ll.y);

        TexCoord(1,0);
        Vertex(ll.x, ur.y);

        RenderEnd();
#endif

    }

#endif
}

gLogo::~gLogo()
{
    if (sg_LogoMPTitle)
    {
        tDESTROY(sg_LogoMPTitle);
    }
}
