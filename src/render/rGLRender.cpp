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

#include "config.h"

#ifndef DEDICATED

#define DONTDOIT
#include "rRender.h"
#include "rGL.h"
#include "tMemManager.h"
#include "tError.h"

class glRenderer: public rRenderer{
    GLenum lastPrimitive;
    bool   forceglEnd;

    GLenum lastMatrix;

    // WARNING, EMSCRIPTEN: the lastPrimitive test below is a batching
    // optimisation -- a Begin*() issued while the SAME primitive is already
    // current is a no-op, so consecutive batches merge into one glBegin/glEnd
    // and one draw call. Under Emscripten's GL emulation that merge is also a
    // hazard, and it is the root of a whole class of bug.
    //
    // Real OpenGL lets a glBegin/glEnd block mix vertices freely: glVertex
    // captures whatever the current colour and texcoord state is, so some
    // vertices may have been given a glTexCoord and others not. Emscripten
    // cannot express that. libglemu.js appends every attribute call to one flat
    // array and derives a SINGLE interleaved stride for the whole block from
    // the set of components it saw (addRendererComponent), then asserts in
    // glEnd that 4*vertexCounter/stride is an integer. So every vertex in a
    // block must emit the same attribute calls -- and a merged block spans code
    // that never agreed to share a format.
    //
    // Two things therefore break, and only the first is loud:
    //   1. mismatched formats make the division non-integral -> the runtime
    //      aborts with "`numVertices` must be an integer";
    //   2. if the counts happen to divide anyway it draws SILENT GARBAGE,
    //      because the writer's and reader's per-vertex periods still differ.
    //
    // Before adding a Begin*() call site, or a colour/texcoord anywhere near
    // one, read docs/porting/browser-runtime-notes.md section 10 -- it states
    // the rule in both of its forms and lists the sites already fixed and the
    // ones still latent.
    void BeginPrimitive(GLenum p, bool forceEnd = false){
        //  glBegin(p);
        //  return;

        if (lastPrimitive != p && lastPrimitive != GL_FALSE)
        {
            glEnd();
            sr_CheckGLError();
        }

        if ( lastPrimitive != p )
        {
            sr_CheckGLError();
            glBegin(p);
        }

        lastPrimitive = p;

        forceglEnd = forceEnd;
    }

    void MatrixMode(GLenum mm){
        //    if (lastMatrix != mm)
        {
            glMatrixMode(mm);
            lastMatrix = mm;
        }
    }

public:
    glRenderer():lastPrimitive(GL_FALSE), forceglEnd(false), lastMatrix(GL_FALSE){
        ChangeFlags(0xffffffff,0);
    };

    virtual ~glRenderer(){};

    virtual void Vertex(REAL x, REAL y){
        glVertex2f(x,y);
    };

    virtual void Vertex(REAL x, REAL y, REAL z){
        glVertex3f(x,y,z);
    }

    virtual void Vertex3(REAL *x){
        glVertex3fv(x);
    }

    virtual void Vertex(REAL x, REAL y, REAL z, REAL w){
        glVertex4f(x,y,z,w);
    }

    virtual void TexCoord(REAL u, REAL v){
        glTexCoord2f(u,v);
    }

    virtual void TexCoord(REAL u, REAL v, REAL w){
        glTexCoord3f(u,v,w);
    }

    virtual void TexCoord(REAL u, REAL v, REAL w, REAL t){
        glTexCoord4f(u,v,w,t);
    };

    virtual void TexVertex(REAL x, REAL y, REAL z,
                           REAL u, REAL v){
        glTexCoord2f(u,v);
        glVertex3f(x,y,z);
    }


    virtual void Color(REAL r, REAL g, REAL b){
        glColor3f(r,g,b);
    };

    virtual void Color(REAL r, REAL g, REAL b,REAL a){
        glColor4f(r,g,b,a);
    };


    virtual void End(bool force=true){
        //    glEnd();
        //    return;

        if ((forceglEnd || force ) && lastPrimitive!=GL_FALSE)
        {
            forceglEnd = false;
            glEnd();
            sr_CheckGLError();
            lastPrimitive = GL_FALSE;
        }
    }

    virtual void BeginLines(){
        BeginPrimitive(GL_LINES);
    };

    virtual void BeginTriangles(){
        BeginPrimitive(GL_TRIANGLES);
    }

    virtual void BeginQuads(){
        BeginPrimitive(GL_QUADS);
    }

    virtual void BeginLineStrip(){
        BeginPrimitive(GL_LINE_STRIP, true);
    };

    virtual void BeginLineLoop(){
        BeginPrimitive(GL_LINE_LOOP, true);
    };

    virtual void BeginTriangleStrip(){
        BeginPrimitive(GL_TRIANGLE_STRIP, true);
    };

    virtual void BeginQuadStrip(){
#ifdef __EMSCRIPTEN__
        // Emscripten's immediate-mode emulation abort()s the entire runtime --
        // not just the draw -- on any primitive above GL_TRIANGLE_FAN except
        // GL_QUADS (src/lib/libglemu.js, grep "unsupported immediate mode").
        // GL_QUAD_STRIP is mode 8, so it is fatal, and gWall.cpp:1242 draws the
        // cycle wall with it every frame of every round behind a guard that is
        // a `static const bool = true` (gWall.cpp:1066). GL_TRIANGLE_STRIP
        // consumes the same vertex stream in the same order.
        //
        // Before "tidying" this: aliasing two rRenderer primitives onto one
        // GLenum is only safe because BeginTriangleStrip() has zero call sites
        // tree-wide, so no real triangle strip can be merged into a quad-strip
        // batch. See docs/porting/browser-runtime-notes.md section 5.
        BeginPrimitive(GL_TRIANGLE_STRIP, true);
#else
        BeginPrimitive(GL_QUAD_STRIP, true);
#endif
    };

    virtual void BeginTriangleFan(){
        BeginPrimitive(GL_TRIANGLE_FAN, true);
    };

    virtual void Line(REAL x1, REAL y1, REAL z1,
                      REAL x2, REAL y2, REAL z2){
        BeginPrimitive(GL_LINES);
        glVertex3f(x1,y1,z1);
        glVertex3f(x2,y2,z2);
        End();
    }




    virtual void ProjMatrix(){
        End(true);
        MatrixMode(GL_PROJECTION);
    };

    virtual void ModelMatrix(){
        End(true);
        MatrixMode(GL_MODELVIEW);
    };

    virtual void TexMatrix(){
        End(true);
        MatrixMode(GL_TEXTURE);
    };

    virtual void PushMatrix(){
        glPushMatrix();
    };

    virtual void PopMatrix(){
        End(true);
        glPopMatrix();
    };

    virtual void MultMatrix(REAL mdata[4][4]){
        End(true);
        tASSERT(sizeof(REAL) == sizeof(GLfloat));
        REAL * mdat=&mdata[0][0];
        glMultMatrixf(reinterpret_cast<GLfloat *>(mdat));
    };

    virtual void IdentityMatrix(){
        End(true);
        glLoadIdentity();
    };

    virtual void ScaleMatrix(REAL f){
        End(true);
        glScalef(f,f,f);
    };

    virtual void ScaleMatrix(REAL f1, REAL f2, REAL f3){
        End(true);
        glScalef(f1,f2,f2);
    };

    virtual void TranslateMatrix(REAL x1, REAL x2, REAL x3){
        End(true);
        glTranslatef(x1,x2,x3);
    }



    virtual void ReallySetFlag(flag f,bool c){
        GLenum fl = GL_DEPTH_TEST;
        switch (f)
        {
        case ALPHA_BLEND:
            fl = GL_BLEND;
            break;
        case DEPTH_TEST:
            fl = GL_DEPTH_TEST;
            break;
        default:
            break;
        }

        if (c)
            glEnable(fl);
        else
            glDisable(fl);
    };

};

void sr_glRendererInit(){
    tNEW(glRenderer);
}

#endif
