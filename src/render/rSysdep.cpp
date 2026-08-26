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


#include "defs.h"
#ifndef DEDICATED
#include "rSDL.h"
#endif

#include "rSysdep.h"
#include "tInitExit.h"
#include "tDirectories.h"
#include "tSysTime.h"
#include "rConsole.h"
#include "config.h"
#include <iostream>
#include "rScreen.h"
#include "rGL.h"
#include "tCommandLine.h"
#include "tConfiguration.h"
#include "tRecorder.h"

#ifndef DEDICATED
#include "SDL_thread.h"
#include "SDL_mutex.h"

#ifdef __EMSCRIPTEN__
// For emscripten_sleep(), the browser yield in SwapGL() below. Only the
// browser client links with -sASYNCIFY; the M0 dedicated build does not, and
// without it emscripten_sleep is a JS-side abort() (libasync.js:614) rather
// than a link error -- so this include, and every call it enables, stays
// inside #ifndef DEDICATED.
#include <emscripten.h>
#endif

#include <png.h>
#define SCREENSHOT_PNG_BITDEPTH 8
#define SCREENSHOT_BYTES_PER_PIXEL 3
#ifndef SDL_OPENGL
#ifndef DIRTY
#define DIRTY
#endif
#endif

//#ifndef SDL_OPENGL
//#error "need SDL 1.1"
//#endif

#ifndef DIRTY

// nothing to be done.

/*
//#elif defined(HAVE_FXMESA)
 #include <GL/gl>
 #include <GL/fxmesa>

 static fxMesaContext ctx=NULL;
*/

#elif defined(WIN32)

 #include <windows.h>
 #include <windef.h>
 #include "rGL.h"
static HDC hDC=NULL;
static HGLRC hRC=NULL;

#elif defined(unix) || defined(__unix__)

#include <GL/glx.h>
static GLXContext cx;
Display *dpy=NULL;
Window  win;

#endif

#ifdef DIRTY
#include <SDL_syswm.h>

// graphics initialisation and cleanup:
bool  rSysDep::InitGL(){
    SDL_SysWMinfo system;
    SDL_VERSION(&system.version);
    if (!SDL_GetWMInfo(&system)){
        std::cerr << "Video information not available!\n";
        return(false);
    }

    /*
    con << "SDL version: " << (int)system.version.major
         << "." <<  (int)system.version.minor << "." <<  (int)system.version.patch << '\n';
    */

    /*
    //#ifdef HAVE_FXMESA
    if(!ctx){
      int x=fxQueryHardware();
      if(x){
        std::cerr << "No 3Dfx hardware available.\n" << x << '\n';
        return(false);
      }

      GLint attribs[]={FXMESA_DOUBLEBUFFER,FXMESA_DEPTH_SIZE,16,FXMESA_NONE};
      ctx=fxMesaCreateBestContext(0,sr_screenWidth,sr_screenHeight,attribs);

      if (!ctx){
        std::cerr << "Could not create FX rendering context!\n";
        return(false);
      }

      fxMesaMakeCurrent(ctx);
    }
    */
#ifdef WIN32
    // windows GL initialisation stolen from
    // http://www.geocities.com/SiliconValley/Code/1219/opengl32.html

    if (!hRC){
        HWND hWnd=system.window;

        PIXELFORMATDESCRIPTOR pfd;
        int iFormat;

        // get the device context (DC)
        hDC = GetDC( hWnd );
        if (!hDC) return false;

        // set the pixel format for the DC
        ZeroMemory( &pfd, sizeof( pfd ) );
        pfd.nSize = sizeof( pfd );
        pfd.nVersion = 1;
        pfd.dwFlags = PFD_DRAW_TO_WINDOW |
                      PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
        pfd.iPixelType = PFD_TYPE_RGBA;
        pfd.cColorBits = currentScreensetting.colorDepth ? 24 : 16;
        pfd.cDepthBits = 16;
        pfd.iLayerType = PFD_MAIN_PLANE;
        iFormat = ChoosePixelFormat( hDC, &pfd );
        SetPixelFormat( hDC, iFormat, &pfd );

        // create and enable the render context (RC)
        hRC = wglCreateContext( hDC );
        if (!hRC || !wglMakeCurrent( hDC, hRC ))
            return false;
    }

#elif defined(unix) || defined(__unix__)
    if (system.subsystem!=SDL_SYSWM_X11){
        std::cerr << "System is not X11!\n";
        std::cerr << (int)system.subsystem << "!=" << (int)SDL_SYSWM_X11 <<'\n';
        return false;
    }

    if(!dpy){

        dpy=system.info.x11.display;
        win=system.info.x11.window;

        int errorbase,tEventbase;
        if (glXQueryExtension(dpy,&errorbase,&tEventbase) == False){
            std::cerr << "OpenGL through GLX not supported.\n";
            return false;
        }

        int configuration[]={GLX_DOUBLEBUFFER,GLX_RGBA,GLX_DEPTH_SIZE ,12, GLX_RED_SIZE,1,
                             GLX_BLUE_SIZE,1,GLX_GREEN_SIZE,1,None};

        XVisualInfo *vi=glXChooseVisual(dpy,DefaultScreen(dpy),configuration);

        if(vi== NULL){
            std::cerr << "Could not initialize Visual.\n";
            return false;
        }

        cx=glXCreateContext(dpy,vi,
                            NULL,True);

        if(cx== NULL){
            std::cerr << "Could not initialize GL context.\n";
            return false;
        }

        if (!glXMakeCurrent(dpy,win,cx)){
            dpy=0;
            return false;
        }
    }

#endif

    return true;
}

void  rSysDep::ExitGL(){
    SDL_SysWMinfo system;
    SDL_GetWMInfo(&system);

    /*
    #ifdef HAVE_FXMESA

    if(ctx){
      fxMesaDestroyContext(ctx);
      ctx=NULL;
      fxCloseHardware();
    }
    */

#if defined(WIN32)
    HWND hWnd=system.window;

    // windows GL cleanup stolen from
    // http://www.geocities.com/SiliconValley/Code/1219/opengl32.html
    if(hRC){

        wglMakeCurrent( NULL, NULL );
        wglDeleteContext( hRC );
        ReleaseDC( hWnd, hDC );

        hRC=NULL;
        hDC=NULL;
    }
#elif defined(unix) || defined(__unix__)
    if(dpy){

        //    glXReleaseBuffersMESA( dpy, win );
        glXMakeCurrent(dpy,None,NULL);
        glXDestroyContext(dpy, cx );
        dpy=NULL;
    }
#endif
}
#endif // DIRTY

bool sr_screenshotIsPlanned=false;

static bool png_screenshot=true;
static tConfItem<bool> pns("PNG_SCREENSHOT",png_screenshot);
#ifndef DEDICATED

static void SDL_SavePNG(SDL_Surface *image, tString filename){
    png_structp png_ptr;
    png_infop info_ptr;
    png_byte **row_ptrs;
    int i;
    static FILE *fp;

    if (!(fp = fopen(filename, "wb"))) {
        fprintf(stderr, "can't open file for writing\n");
        return;
    }

    if (!(png_ptr = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL))) {
        return;
    }

    if (!(info_ptr = png_create_info_struct(png_ptr))) {
        png_destroy_write_struct(&png_ptr, (png_infopp)NULL);
        return;
    }

    png_init_io(png_ptr, fp);

    png_set_IHDR(png_ptr, info_ptr, sr_screenWidth, sr_screenHeight,
                 SCREENSHOT_PNG_BITDEPTH, PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT,
                 PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png_ptr, info_ptr);

    // get pointers
    if(!(row_ptrs = (png_byte**) malloc(sr_screenHeight * sizeof(png_byte*)))) {
        png_destroy_write_struct(&png_ptr, &info_ptr);
        return;
    }

    for(i = 0; i < sr_screenHeight; i++) {
        row_ptrs[i] = (png_byte *)image->pixels + (sr_screenHeight - i - 1)
                      * image->pitch;
    }

    png_write_image(png_ptr, row_ptrs);
    png_write_end(png_ptr, info_ptr);
    png_destroy_write_struct(&png_ptr, &info_ptr);

    free(row_ptrs);
    fclose(fp);
}
#endif

static void make_screenshot(){
#ifndef DEDICATED
    // screenshot count
    static int number=0;
    number++;

    SDL_Surface *image;
    SDL_Surface *temp;
    int idx;
    image = SDL_CreateRGBSurface(SDL_SWSURFACE, sr_screenWidth, sr_screenHeight,
                                 24, 0x0000FF, 0x00FF00, 0xFF0000 ,0);
    temp = SDL_CreateRGBSurface(SDL_SWSURFACE, sr_screenWidth, sr_screenHeight,
                                24, 0x0000FF, 0x00FF00, 0xFF0000, 0);

    // make upside down screenshot
    glReadPixels(0,0,sr_screenWidth, sr_screenHeight, GL_RGB,
                 GL_UNSIGNED_BYTE, image->pixels);

    // turn image around
    for (idx = 0; idx < sr_screenHeight; idx++)
    {
        memcpy(reinterpret_cast<char *>(temp->pixels) + temp->pitch * idx,
               reinterpret_cast<char *>(image->pixels)
               + image->pitch*(sr_screenHeight - idx-1),
               3*sr_screenWidth); // Optionally, use the pitch of either surface here
    }

    // save screenshot in unused slot
    bool done = false;
    while ( !done )
    {
        // generate filename
        tString fileName("screenshot_");
        fileName << number;
        if(png_screenshot)
            fileName << ".png";
        else
            fileName << ".bmp";

        // test if file exists
        std::ifstream s;
        if ( tDirectories::Screenshot().Open( s, fileName ) )
        {
            // yes! try next number
            number++;
            continue;
        }

        // save image
        if(png_screenshot)
            SDL_SavePNG(image, tDirectories::Screenshot().GetWritePath( fileName ));
        else
            SDL_SaveBMP(temp, tDirectories::Screenshot().GetWritePath( fileName ) );
        done = true;
    }

    // cleanup
    SDL_FreeSurface(image);
    SDL_FreeSurface(temp);
#endif
}

class PerformanceCounter
{
public:
    PerformanceCounter(): count_(0){ tRealSysTimeFloat(); }
    unsigned int Count(){ return count_++; }
    ~PerformanceCounter()
    {
        double time = tRealSysTimeFloat();
        std::stringstream s;
        s << count_ << " frames in " << time << " seconds: " << count_ / time << " fps.\n";
#ifdef WIN32
        MessageBox (NULL, s.str().c_str() , "Performance", MB_OK);
#else
        std::cout << s.str();
#endif
    }
private:
    unsigned int count_;
};

static double s_nextFastForwardFrameRecorded=0; // the next frame to render in recorded time
static double s_nextFastForwardFrameReal=0;     // the next frame to render in real time
#endif // DEDICATED

// settings for fast forward mode
static REAL sr_FF_Maxstep=1; // maximum step between rendered frames
static tSettingItem<REAL> c_ff( "FAST_FORWARD_MAXSTEP",
                                sr_FF_Maxstep );

static REAL sr_FF_MaxstepReal=.05; // maximum step in real time between rendered frames
static tSettingItem<REAL> c_ffre( "FAST_FORWARD_MAXSTEP_REAL",
                                  sr_FF_MaxstepReal );

static REAL sr_FF_MaxstepRel=1; // maximum step between rendered frames relative to end of FF mode
static tSettingItem<REAL> c_ffr( "FAST_FORWARD_MAXSTEP_REL",
                                 sr_FF_MaxstepRel );


static double s_fastForwardTo=0;
static bool   s_fastForward =false;
static bool   s_benchmark   =false;

class rFastForwardCommandLineAnalyzer: public tCommandLineAnalyzer
{
private:
    bool DoAnalyze( tCommandLineParser & parser, int pass ) override
    {
        if(pass > 0)
            return false;

        // get option
        tString forward;
        if ( parser.GetOption( forward, "--fastforward" ) )
        {
            // set fast forward mode
            s_fastForward = true;

            // read time
            std::stringstream str(static_cast< char const * >( forward ) );
            str >> s_fastForwardTo;

            return true;
        }

        if ( parser.GetSwitch( "--benchmark" ) )
        {
            // set benchmark mode
            s_benchmark = true;
            return true;
        }

        return false;
    }

    void DoHelp( std::ostream & s ) override
    {                                      //
        s << "--fastforward <time>         : lets time run very fast until the given time is reached\n";
        s << "--benchmark                  : renders frames as they were recorded\n";
    }
};

static rFastForwardCommandLineAnalyzer analyzer;

rSysDep::rSwapMode rSysDep::swapMode_ = rSysDep::rSwap_glFlush;
//rSysDep::rSwapMode rSysDep::swapMode_ = rSysDep::rSwap_60Hz;

int sr_maxFPS = 360;

// buffer swap:
#ifndef DEDICATED
// for setting breakpoints in optimized mode, too
static void breakpoint(){}

static bool sr_netSyncThreadGoOn = true;
static rSysDep::rNetIdler * sr_netIdler = NULL;
int sr_NetSyncThread(void *lockVoid)
{
    SDL_mutex *lock = (SDL_mutex *)lockVoid;

    SDL_mutexP(lock);

    while ( sr_netSyncThreadGoOn )
    {
        SDL_mutexV(lock);
        // wait for network data
        bool toDo = sr_netIdler->Wait();
        SDL_mutexP(lock);

        if ( toDo )
        {
            // disable rendering (during auto-scrolling of console, for example)
            bool glout = sr_glOut;
            sr_glOut = false;

            // new network data arrived, handle it
            sr_netIdler->Do();

            // enable rendering again
            sr_glOut = glout;
        }
    }

    SDL_mutexV(lock);

    return 0;
}

static SDL_Thread * sr_netSyncThread = NULL;
static SDL_mutex * sr_netLock = NULL;
void rSysDep::StartNetSyncThread( rNetIdler * idler )
{
    sr_netIdler = idler;

    return;

    // can't use thrading trouble while recording
    if ( tRecorder::IsRunning() )
        return;

    if ( sr_netSyncThread )
        return;

    // create lock
    if ( !sr_netLock )
        sr_netLock = SDL_CreateMutex();

    // start thread
    sr_netSyncThread = SDL_CreateThread( sr_NetSyncThread, sr_netLock );
    if ( !sr_netSyncThread )
        return;

    // lock mutex, the thread should only do work while the main thread is waiting for the refresh
    SDL_mutexP( sr_netLock );
}

void rSysDep::StopNetSyncThread()
{
    // stop and delete thread
    if ( sr_netSyncThread )
    {
        SDL_mutexV(  sr_netLock );
        sr_netSyncThreadGoOn = false;
        SDL_WaitThread( sr_netSyncThread, NULL );
        sr_netSyncThread = NULL;
        sr_netIdler = NULL;
    }

    // delete lock
    if ( sr_netLock )
    {
        SDL_DestroyMutex( sr_netLock );
        sr_netLock = NULL;
    }
}

static tConfItem<int> sr_maxFPSConf("MAX_FPS", sr_maxFPS,
                                    [](const int& val) { return (val >= 0); });

// NEVER CALL SDL_Delay() IN THE BROWSER CLIENT. It is the one sleep primitive
// that is actively unsafe under Asyncify, and it fails nowhere near the call.
//
// Emscripten's SDL declares it as a JS-side *alias* of emscripten_sleep
// (src/lib/libsdl.js, grep "SDL_Delay: 'emscripten_sleep'", inside #if ASYNCIFY),
// so at runtime _SDL_Delay really is the function that starts an Asyncify
// unwind. But the alias is resolved by src/jsifier.mjs WITHOUT copying the
// target's `__async` decorator: the asyncFuncs list is built from
// LibraryManager.library[symbol + '__async'] (grep "asyncFuncs.push") BEFORE
// aliases are resolved (grep "LibraryManager.isAlias"), and only
// emscripten_sleep carries that decorator (src/lib/libasync.js, grep
// "emscripten_sleep__async"). asyncFuncs is what tools/link.py turns into
// ASYNCIFY_IMPORTS (grep "js_info\['asyncFuncs'\]"), and ASYNCIFY_IMPORTS is
// what tells Binaryen which call sites to instrument.
//
// Net effect: the JS side unwinds, the wasm side does not participate. The
// caller of SDL_Delay is left uninstrumented while instrumented frames further
// up the stack rewind anyway, restoring __stack_pointer from a garbage
// asyncify-stack slot. Downstream that presents as "Attempt to set SP to
// 0xffffffb0" -- a tiny absolute address, at every -sSTACK_SIZE, so it looks
// like memory-layout corruption rather than a sleep problem.
//
// Verified two ways against the emsdk in deps/:
//   - `emcc -v` prints the Binaryen argument; asyncify-imports contains
//     *.emscripten_sleep and no *.SDL_Delay;
//   - a five-line reduction with the shape of SwapGL() below (one
//     emscripten_sleep(0), then a nested call that sleeps again) survives 100
//     frames when the second sleep is emscripten_sleep, and dies with
//     "RuntimeError: unreachable" when it is SDL_Delay. Same source, same
//     flags. So the number of yields per frame is NOT the variable -- which
//     primitive is used is.
//
// The rule, therefore: only call sleeps that appear in ASYNCIFY_IMPORTS.
// emscripten_sleep does; so do tDelay()/tDelayForce(), which route through it
// (tSysTime.cpp). SDL_Delay does not. If a third-party call site ever makes
// SDL_Delay unavoidable, -sASYNCIFY_IMPORTS=SDL_Delay at link is the escape
// hatch and it does work (verified with the same reduction) -- but prefer
// removing the call, so that "the client's wasm imports no SDL_Delay" stays a
// checkable invariant.
//
// A plain __EMSCRIPTEN__ guard is the right form here: this whole region of the
// file is inside #ifndef DEDICATED (opened at :465), so the dedicated build --
// which links without -sASYNCIFY and would abort on emscripten_sleep -- never
// compiles this function at all. See docs/porting/browser-runtime-notes.md § 8.
void sr_LimitFPS()
{
    if (sr_maxFPS > 0 && !tRecorder::IsPlayingBack())
    {
        static double last_time = 0;

        const double now_time = tRealSysTimeFloat();
        const double SPF = 1.0 / sr_maxFPS;

        const double target_now_time = last_time + SPF;
        if (now_time < target_now_time)
        {
#ifdef __EMSCRIPTEN__
            // Same wait, a primitive Asyncify actually instruments. This is a
            // second yield inside the same SwapGL() call as the deliberate one
            // at the top of that function, and that is fine -- see above.
            emscripten_sleep(round(1000 * (target_now_time - now_time)));
#else
            SDL_Delay(round(1000 * (target_now_time - now_time)));
#endif
            last_time = target_now_time;
        }
        else
        {
            last_time = now_time;
        }
    }
}

void rSysDep::SwapGL(){
#ifdef __EMSCRIPTEN__
    // THE browser yield point, and the reason the whole client is built with
    // Asyncify. The game has no frame callback: every one of its loops --
    // uMenu::Enter, gGame's round loop, the connection and download waits --
    // is a plain while() that only returns when the activity it drives is
    // over. In a browser that never gives the event loop a turn, so the tab
    // freezes: no input, no repaint, eventually a "page unresponsive" prompt.
    // emscripten_sleep() unwinds the C++ stack back to the JS caller, lets the
    // browser run, and resumes this call where it left off.
    //
    // It has to be HERE, at the top, unconditionally, not at the end of the
    // function. SwapGL() returns early from the `if (!sr_glOut)` block roughly
    // sixty lines down, and that return skips the entire rest of the function
    // -- the buffer swap, the breakpoint, and sr_LimitFPS(). !sr_glOut is not
    // an edge case: the console turns rendering off while it auto-scrolls, and
    // the recorder's frame-skip and fast-forward paths both drive it. A yield
    // placed after that block would be silently skipped for exactly the loops
    // that spin fastest. Placed here it is provably once per call, for every
    // caller and every path. uMenu::Enter (uMenu.cpp) calls SwapGL()
    // unconditionally at the bottom of its loop body, so both of the menu's
    // paths -- rendering and the tDelay()-throttled idle one -- are covered.
    //
    // Deliberately NOT done in sr_LimitFPS() instead: that runs after the early
    // return, so it would miss exactly those callers. sr_LimitFPS() does yield
    // as well when a frame finishes early, which is a second yield inside this
    // same call -- harmless, and measured to be harmless; see the comment above
    // sr_LimitFPS() for what actually is not.
    //
    // Two consequences that will look like bugs; both are explained in
    // docs/porting/browser-runtime-notes.md section 2. emscripten_sleep is
    // setTimeout, which browsers clamp to ~4ms once timeouts nest, so frames
    // are neither rAF-aligned nor faster than ~250 FPS. And because
    // rConsole::DisplayAtNewline() calls this function
    // (rConsoleGraph.cpp:67), a burst of console output during loading costs
    // one event-loop round trip per line -- check that before blaming Asyncify
    // for a boot that looks hung.
    emscripten_sleep( 0 );
#endif

    if ( s_benchmark )
    {
        static PerformanceCounter counter;
        counter.Count();
    }

    double time = tSysTimeFloat();
    double realTime = tRealSysTimeFloat();

    bool next_glOut = sr_glOut;

    // adapt playback speed to recorded speed
    if ( !s_benchmark && !s_fastForward && tRecorder::IsPlayingBack() )
    {
        static double timeOffset=0;
        static double lastRendered=0;

        // calculate how much we're behind the rendering schedule
        double behind = - time + realTime + timeOffset;
        // std::cout << behind << " " << sr_glOut << "\n";

        // large delays can only be caused by breakpoints or map downloads; ignore them
        if ( behind > .5 || realTime > lastRendered + .2 )
        {
            timeOffset -= behind;
            next_glOut = true;
        }
        else
        {
            // we're a bit behind, skip the next frame
            if ( behind > .1 )
            {
                next_glOut = false;
            }
            else if ( sr_glOut )
            {
                lastRendered=realTime;
                // we're ahead, pause a bit
                if  ( behind < -.5 )
                    timeOffset -= behind;
                else if ( behind < -.1 )
                {
                    int delay = int( -( behind + .1 ) * 1000000 );
                    // std::cout << behind << ":" << delay << "\n";
                    tDelayForce( delay );
                }
            }
            else
            {
                // we're not behind any more. Reactivate rendering.
                next_glOut = true;
            }
        }

        if ( next_glOut )
            lastRendered=realTime;
    }

    if (!sr_glOut)
    {
        // display next frame in fast foward mode
        if ( ( s_fastForward && ( time > s_nextFastForwardFrameRecorded || realTime > s_nextFastForwardFrameReal ) ) || next_glOut )
        {
            sr_glOut = true;
            rSysDep::ClearGL();
        }

        // in playback or recording mode, always execute frame tasks, they may be improtant for consistency
        if ( tRecorder::IsRunning() )
            rPerFrameTask::DoPerFrameTasks();

        return;
    }


    rPerFrameTask::DoPerFrameTasks();

    // unlock the mutex while waiting for the swap operation to finish
    SDL_mutexV(  sr_netLock );
    sr_LockSDL();

    switch( swapMode_ )
    {
    case rSwap_Fastest:
        break;
    case rSwap_glFlush:
        glFlush();
        break;
    case rSwap_glFinish:
        glFinish();
        break;
    }

#if defined(SDL_OPENGL)
    if (lastSuccess.useSDL)
        SDL_GL_SwapBuffers();
    //#elif defined(HAVE_FXMESA)
    //fxMesaSwapBuffers();
#endif

#ifdef DIRTY
    if (!lastSuccess.useSDL){
#if defined(WIN32)
        SwapBuffers( hDC );
#elif defined(unix) || defined(__unix__)
        glXSwapBuffers(dpy,win);
#endif
    }
#endif

    if (sr_screenshotIsPlanned){
        make_screenshot();
        sr_screenshotIsPlanned=false;
    }

    sr_UnlockSDL();
    // lock mutex again
    SDL_mutexP(  sr_netLock );


    // disable output in fast forward mode
    if ( s_fastForward && tRecorder::IsPlayingBack() )
    {
        if ( time < s_fastForwardTo )
        {
            // next displayed frame should be ten percent closer to the target, but at most 10 seconds
            s_nextFastForwardFrameRecorded = ( s_fastForwardTo - time ) * sr_FF_MaxstepRel;
            if ( s_nextFastForwardFrameRecorded > sr_FF_Maxstep )
                s_nextFastForwardFrameRecorded = sr_FF_Maxstep ;
            s_nextFastForwardFrameRecorded += time;
            s_nextFastForwardFrameReal = realTime + sr_FF_MaxstepReal ;

            next_glOut = false;
        }
        else
        {
            std::cout << "End of fast forward mode.\n";
            st_Breakpoint();
            s_fastForward = false;
        }
    }

    //#ifdef DEBUG
    if ( !s_fastForward )
    {
        breakpoint();
    }
    //#endif

    sr_LimitFPS();

    sr_glOut = next_glOut;
}
#endif // dedicated

#ifndef DEDICATED
static SDL_mutex *mut;

static void stuff_init(){
    mut=SDL_CreateMutex();
}

static tInitExit stuff_ie(&stuff_init);
#endif

void sr_LockSDL(){
    //std::cerr << "locking...";
#ifndef DEDICATED
#ifndef WIN32
    //SDL_mutexP(mut);
#endif
#endif
    //std::cerr << " locked!\n";
}

void sr_UnlockSDL(){
    //std::cerr << "unlocking...";
#ifndef DEDICATED
#ifndef WIN32
    //SDL_mutexV(mut);
#endif
#endif
    //std::cerr << " unlocked!\n";
}

#ifndef DEDICATED
void  rSysDep::ClearGL(){
    if (sr_glOut){

        /*
        if (sr_screenshotIsPlanned){
          make_screenshot();
          sr_screenshotIsPlanned=false;
        }
        */

        glClearColor(0.0,0.0,0.0,1.0);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    }
}
#endif


