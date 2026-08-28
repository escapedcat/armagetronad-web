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

#include "gSparks.h"
#include "eTimer.h"
#include "rRender.h"
#include "tRandom.h"

bool white_sparks=false;

gSpark::gSpark(eGrid *grid, const eCoord &pos,const eCoord &dir,REAL time,REAL ocolor_r,REAL ocolor_g,REAL ocolor_b,REAL ecolor_r,REAL ecolor_g,REAL ecolor_b)
        :eReferencableGameObject(grid, pos, dir , NULL, true),
        //   sound(scrap),
createTime(time){
    lastTime=createTime;

    sparkowncolor_r=ocolor_r;
    sparkowncolor_g=ocolor_g;
    sparkowncolor_b=ocolor_b;

    sparkenemycolor_r=ecolor_r;
    sparkenemycolor_g=ecolor_g;
    sparkenemycolor_b=ecolor_b;

    for (int i=SPARKS-1;i>=0;i--){
        lastX[i]=preLastX[i]=x[i]=Vec3(pos.x,pos.y,.5);

        static const REAL fak=4;

        tRandomizer & randomizer = tRandomizer::GetInstance();
        REAL a=fak*( randomizer.Get() - .5f );
        REAL b=fak*( randomizer.Get() - .5f );
        //      REAL a=fak*(rand()/static_cast<REAL>(RAND_MAX)-.5f);
        //      REAL b=fak*(rand()/static_cast<REAL>(RAND_MAX)-.5f);
        REAL c=1;

        eCoord xy(eCoord(c,b).Turn(dir));

        xDot[i]=Vec3(xy.x,xy.y,a);
        xDot[i]=xDot[i]*(1/xDot[i].Norm());
        xDot[i].x[2]+=1;

        heat[i]=2+randomizer.Get();
        //      heat[i]=2+rand()/REAL(RAND_MAX);
        lastBreak[i]=createTime;
    }

    // add to game grid
    this->AddToList();
}

gSpark::~gSpark(){}

// virtual eGameObject_type type();

bool gSpark::Timestep(REAL currentTime){
    REAL ts=currentTime-lastTime;
    lastTime=currentTime;

    for (int i=SPARKS-1;i>=0;i--){
        x[i]+=xDot[i]*ts;
        xDot[i].x[2]-=5*ts;
        heat[i]-=ts;

        if (x[i].x[2]<0){
            x[i].x[2]*=-1;
            xDot[i].x[2]*=-.5;
            lastBreak[i]=currentTime;
        }
    }

    if (currentTime>createTime+4)
        return true;
    else
        return false;

}

void gSpark::InteractWith(eGameObject *,REAL ,int){}
void gSpark::PassEdge(const eWall *,REAL ,REAL ,int){}

void gSpark::Kill(){createTime=lastTime-100000;}


#ifndef DEDICATED
void gSpark::Render(const eCamera *cam){
    glBlendFunc(GL_SRC_ALPHA,GL_ONE);

    //glMatrixMode(GL_MODELVIEW);
    //glPushMatrix();
    //glLoadIdentity();

    //glDisable(GL_TEXTURE);
    glDisable(GL_TEXTURE_2D);

    BeginLines();
    for (int i=SPARKS-1;i>=0;i--){
    #define rmax 1.2
    #define gmax 1.1
        REAL ago=.2;
        if (ago>se_GameTime()-lastBreak[i])
            ago=se_GameTime()-  lastBreak[i];

        REAL a=heat[i]+1.5;
        if (a>1) a=1;
        if (a<0) a=0;

        // The colour is computed into locals rather than being sent straight
        // to glColor4f so that it can be re-sent before the second vertex
        // under Emscripten -- see the comment at the RenderVertex calls below.
        // Behaviour is unchanged: exactly one glColor4f still precedes the
        // pair on every backend.
        REAL cr, cg, cb;
        if(!white_sparks) {
            if(i%2) {
                cr=sparkowncolor_r; cg=sparkowncolor_g; cb=sparkowncolor_b;
            }
            else {
                cr=sparkenemycolor_r; cg=sparkenemycolor_g; cb=sparkenemycolor_b;
            }
        }
        else {
            REAL r=heat[i]+1;
            if (r>rmax) r=rmax;
            if (r>1) r=2-r;
            if (r<0) r=0;
            REAL g=heat[i]+.5;
            if (g>gmax) g=gmax;
            if (g>1) g=2-g;
            if (g<0) g=0;
            REAL b=heat[i];
            if (b>1) b=1;
            if (b<0) b=0;

            cr=r; cg=g; cb=b;
        }

        glColor4f(cr,cg,cb,a);
        x[i].RenderVertex();
        preLastX[i]=x[i];
        preLastX[i]+=xDot[i]*(-ago*.8);

#ifdef __EMSCRIPTEN__
        // One colour per VERTEX, not one per line segment.
        //
        // Unlike the other two sites of this class, this one does not abort --
        // it silently draws garbage, which is worse. Emscripten's immediate
        // mode appends every attribute call to one flat array and derives a
        // single interleaved stride for the whole glBegin/glEnd block. Here the
        // block registers COLOR (4 bytes) and VERTEX (16 bytes), so the reader
        // expects a 20-byte / 5-slot record per vertex: [colour, x, y, z, w].
        // The loop as written wrote 9 slots per iteration (1 colour + 2
        // vertices), so writer period 9 and reader period 5 disagree.
        //
        // With SPARKS == 10 (gSparks.h:38) that is 90 slots against stride 20,
        // giving numVertices = 18 -- an integer, so the glEnd assert passes by
        // pure arithmetic accident and nothing complains. From the second
        // vertex onward the colour is read out of position data and the
        // position out of (y, z, w, colour). Sending the colour before each
        // vertex makes the two periods agree at 5.
        //
        // This is live in the browser build: crash_sparks is true off Mac
        // (gCycle.cpp:2512, and MACOSX is not defined in
        // src/emscripten/config.h) and sparks spawn on wall grinds.
        // See docs/porting/browser-runtime-notes.md section 10.
        glColor4f(cr,cg,cb,a);
#endif
        preLastX[i].RenderVertex();
        preLastX[i]=lastX[i];
        lastX[i]=x[i];
    }
    RenderEnd();
    glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);

    //glPopMatrix();

}

void gSpark::SoundMix(Uint8 *dest,unsigned int len,
                      int viewer,REAL rvol,REAL lvol){
    //  sound.Mix(dest,len,viewer,rvol*.5,lvol*.5,4);
}
#endif
