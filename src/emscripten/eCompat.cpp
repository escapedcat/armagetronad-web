/*
Armagetron Advanced -- compatibility shims for the browser (Emscripten) build.

Every definition in this file exists for exactly one reason: the link of the
browser client reported the symbol as undefined, because Emscripten's SDL 1.2
emulation (emscripten/src/lib/libsdl.js) or its legacy-GL emulation
(emscripten/src/lib/libglemu.js) does not provide it. Nothing here implements
game behaviour, and nothing here is compiled into the dedicated build.

The list is the linker's, not a header diff's -- a header diff over these
libraries produces false positives, because several names are *declared* by
Emscripten's headers and provided by its JS libraries, and a few are declared
and provided as an abort() (see glTexCoord3fv below). What follows is what

    EMCC_CFLAGS="-Wl,--error-limit=0" make -f web/Makefile client

actually reported, and it reported these twelve and no others:

    SDL_BuildAudioCVT  SDL_ConvertAudio  SDL_FreeWAV  SDL_LoadWAV_RW
    glCallList  glDeleteLists  glEndList  glGenLists  glNewList
    glRectf  glTexCoord2d  glTexCoord3fv

Deliberately absent from the includes below: any game header. src/render/
rRender.h:35-37 defines glBegin, glEnd and glMatrixMode to `#error` text, so
that game code is forced through the rRenderer batching layer. This file sits
*below* that layer -- it stands in for the driver -- so it includes system
headers only, and must stay that way for glRectf to be able to compile.
*/

#ifdef __EMSCRIPTEN__

// The same headers the callers compiled against, so no signature here can
// drift from the declaration the rest of the tree saw. NO_SDL_GLEXT mirrors
// src/render/rGL.h:11.
#include <SDL.h>
#define NO_SDL_GLEXT
#include <SDL_opengl.h>

// Both headers already declare all twelve of these with C linkage, so these
// definitions inherit it and the block below is documentation rather than a
// fix. GLAPIENTRY and SDLCALL are likewise empty on this target and are
// spelled out only to keep each definition a copy of its declaration.
extern "C" {

// ---------------------------------------------------------------------------
// GL immediate mode. All three of these are reached while a menu is on
// screen, so they are not "link and forget" -- they have to be right.
// ---------------------------------------------------------------------------

// Callers: uMenu.cpp:557 (the dim overlay behind an open menu),
// rConsoleGraph.cpp:208 (the console backdrop), rViewport.cpp:237, and
// gMenus.cpp:913 (a colour swatch).
//
// The vertex order is glRect's specified expansion: (x1,y1), (x2,y1),
// (x2,y2), (x1,y2). That is worth copying exactly rather than reinventing,
// because it fixes the winding, and gMenus.cpp:913 passes a rectangle whose
// corners are in decreasing y -- a "tidier" ordering would silently reverse
// its facing relative to the other three call sites.
//
// GL_QUADS, not the GL_POLYGON the spec words the expansion in terms of:
// libglemu.js:3062 supports exactly one primitive above GL_TRIANGLE_FAN, and
// it is GL_QUADS; anything else aborts with "unsupported immediate mode". For
// four vertices the two are equivalent.
//
// Opening a glBegin block here is safe only because all four call sites close
// the rRenderer batch first and put nothing between that could reopen one.
// RenderEnd() is two lines up at uMenu.cpp:555, rConsoleGraph.cpp:206 and
// gMenus.cpp:911, with only a glColor call in between; at rViewport.cpp:231 it
// is six lines up, and the lines between are two glDisable calls and a
// glColor3f. Real glRect carries the same restriction (it is illegal between
// glBegin and glEnd), so this shim is no more fragile than what it replaces.
void GLAPIENTRY glRectf( GLfloat x1, GLfloat y1, GLfloat x2, GLfloat y2 )
{
    glBegin( GL_QUADS );
    glVertex2f( x1, y1 );
    glVertex2f( x2, y1 );
    glVertex2f( x2, y2 );
    glVertex2f( x1, y2 );
    glEnd();
}

// gFloor.cpp:206-215, the four corners of the quad the menu background is
// drawn on -- every frame a menu is up. GLdouble has no meaning to WebGL, and
// glTexCoord2f is a real implementation (libglemu.js:3212 aliases it onto
// glTexCoord2i), so the narrowing cast is the entire shim.
void GLAPIENTRY glTexCoord2d( GLdouble s, GLdouble t )
{
    glTexCoord2f( (GLfloat)s, (GLfloat)t );
}

// rModel.cpp:305, once per vertex of a model whose texture faces are not
// coherent. Not on the boot-to-menu path; it is on the gameplay path.
//
// This is NOT forwarded to glTexCoord3f, which is the obvious shim and the
// wrong one. Emscripten declares glTexCoord3f and defines its body as
// `abort('glTexCoord3f: TODO')` (libglemu.js:3859) -- so writing the obvious
// shim would link cleanly and then kill the process the first time a model of
// that kind was drawn. The whole purpose of this file is to make the link
// honest, so it must not smuggle an abort in behind a symbol.
//
// Dropping the third coordinate is correct here, not merely convenient -- but
// the justification is a whole-tree property, so it is spelled out rather than
// asserted, because anyone extending this shim will want to recheck it. r can
// only reach the sampler two ways, and neither carries it here:
//
//  1. The texture target. Nothing in src/ binds GL_TEXTURE_1D or
//     GL_TEXTURE_3D, and 2D sampling ignores r outright.
//
//  2. The texture matrix. There are TWELVE places that touch GL_TEXTURE, not
//     one: rScreen.cpp:1091 (a direct glMatrixMode) plus eleven
//     rRenderer::TexMatrix() calls -- gFloor.cpp:197,220; gCycle.cpp:4035,4345;
//     eDisplay.cpp:274,353,422,450,460,478,507. (gCycle.cpp:4548 would be a
//     thirteenth, but it is inside USE_HEADLIGHT and is not compiled.) What
//     was actually checked is that r's column is zero in the s and t rows at
//     every one of them. Ten load the identity and then at most a glScalef,
//     which is diagonal and so cannot mix r into s or t. The one that loads an
//     arbitrary matrix is gFloor.cpp:197-198, via glLoadMatrixf -- and its
//     source at gFloor.cpp:170-173 is
//     {{.8,.2,0,0},{-.2,.8,0,0},{0,0,1,0},{0,0,0,1}}, whose r column in GL's
//     column-major layout is (0,0,1,0); only tm[0][0] and tm[0][1] are
//     modified afterwards, and both are in the s row.
//
// The source data agrees: texVert's third component is the ASE MESH_TVERT W
// coordinate (rModel.cpp:136), and is written as a literal 0 for every model
// whose coordinates the loader generates itself (rModel.cpp:107).
void GLAPIENTRY glTexCoord3fv( const GLfloat * v )
{
    glTexCoord2f( v[0], v[1] );
}

// ---------------------------------------------------------------------------
// Display lists. Emscripten's GL emulation has none -- not one of these five
// names exists anywhere in libglemu.js.
//
// sr_useDisplayLists is off unless a GPU-vendor probe turns it on, and a later
// task removes that probe, so in the shipped browser build none of this runs.
// They are still written to fail gracefully rather than arbitrarily, because
// "off by default" is a runtime condition and this is a link-time file.
//
// Returning 0 from glGenLists is the failure value OpenGL itself defines for
// it, and rDisplayList.cpp already handles that value correctly without
// knowing it came from a stub. rDisplayList::Call() tests `if ( list_ )` at
// line 126 before the glCallList on line 131, and rDisplayList::Clear() tests
// it at line 144 before the glDeleteLists on line 152, so with a handle of 0
// those two are unreachable. What does still run is the
// glNewList(0,...)/glEndList() pair around the geometry in
// rDisplayListFiller -- and because this glNewList captures nothing, that
// geometry goes straight to the framebuffer, exactly as it would with display
// lists switched off. The degraded mode is therefore "display lists never
// accelerate anything", not "the frame comes out blank".
//
// One caveat worth recording: rDisplayList.cpp:249 does assert the handle is
// non-zero, but tASSERT expands to nothing without -DDEBUG (tError.h:73), and
// this build is -O2 with no DEBUG. So that assertion will not announce it.
// ---------------------------------------------------------------------------

GLuint GLAPIENTRY glGenLists( GLsizei /* range */ )              { return 0; }
void   GLAPIENTRY glNewList( GLuint /* list */, GLenum /* mode */ ) {}
void   GLAPIENTRY glEndList( void )                              {}
void   GLAPIENTRY glCallList( GLuint /* list */ )                {}
void   GLAPIENTRY glDeleteLists( GLuint /* list */, GLsizei /* range */ ) {}

// ---------------------------------------------------------------------------
// SDL 1.2 audio: the WAV-loading and format-conversion half.
//
// Emscripten implements the playback half -- SDL_OpenAudio, SDL_PauseAudio,
// SDL_LockAudio, SDL_UnlockAudio and SDL_CloseAudio are all called by
// eSound.cpp and none of them appeared in the undefined list. These four are
// the gap.
//
// Shipping M1 silent does not make them avoidable. se_SoundInit() runs from
// the SDLSoundCleanup RAII object at gArmagetron.cpp:858 on every boot, and
// SOUND_QUALITY defaults to SOUND_MED (eSound.cpp:78), so the sound path is
// live by default. A later milestone replaces this block with Web Audio.
// ---------------------------------------------------------------------------

// NULL is SDL's own documented failure value -- "cannot be opened, uses an
// unknown data format, or is corrupt" (SDL_audio.h:400-402) -- and it is the
// same failure a *real* SDL_LoadWAV_RW would produce in this build anyway,
// since Emscripten's SDL 1.2 emulation has no WAV decoder at all.
//
// M2 UPDATE -- THIS FUNCTION IS NOW DEAD, and so are SDL_BuildAudioCVT and
// SDL_ConvertAudio below. eWavData::Load() (src/engine/eSound.cpp) now
// short-circuits under __EMSCRIPTEN__ before reaching any of them, and it was
// their only caller. Not "kept alive by the linker": all three appear in
// web/build-m1 solely as a definition in this object (`T` in eCompat.o) with
// no undefined reference to them anywhere in the other 100 objects, so
// -sERROR_ON_UNDEFINED_SYMBOLS=1 does not want them either -- deleting them
// would link. They are left in place because M3 is the milestone that gives
// them real bodies, and having the signatures already written against the SDL
// 1.2 declarations is worth more than the dead code costs.
//
// SDL_FreeWAV is the exception and is still live: eSound.o does carry a `U`
// for it, from the !freeData branch of eWavData::Unload.
//
// Read the short-circuit's comment for the reasoning; the summary is that
// returning NULL was NOT in fact a failure the callers handle. An earlier
// version of this comment claimed it was, and that claim was wrong in the one
// way that mattered: eSound.cpp's retry chain (alternative filename, then
// sound/expl.wav) ends in `throw tGenericException`, and the catch that
// receives it is sg_EnterGame (src/tron/gGame.cpp:4635), which aborts entry
// into the game and shows a "Sound Error" modal. So a NULL here did not mute
// the client, it made it impossible to start a round.
//
// The same earlier comment also called the load path "not on the boot-to-menu
// path", listing eWavData::Mix, eSoundPlayer::Reset and
// eSoundPlayer::MakeGlobal as Load()'s only callers. That enumeration was one
// short: eSoundPlayer's constructor also loads when its loop argument is true
// (eSound.cpp:881-882), which is how gCycle.cpp:2224 builds every cycle's engine
// sound -- i.e. once per cycle, per round. Boot-to-menu was still safe, which
// is why M1 shipped, but the very first frame of gameplay was not.
//
// spec, audio_buf and audio_len are deliberately left untouched, because real
// SDL leaves them untouched on failure; eWavData's own members are already
// NULL from its constructor, which is what the `!data` test above reads.
//
// freesrc is honoured rather than ignored: eSound.cpp:413 passes 1 and relies
// on the callee to release the source, so ignoring it leaks one rwops per
// attempt. The release is SDL_FreeRW and specifically NOT the usual
// SDL_RWclose. Emscripten's SDL_RWFromFile (libsdl.js:3545) returns an
// *index* into a JS-side array rather than a pointer to a real SDL_RWops
// struct, so SDL_RWclose's `(ctx)->close(ctx)` expansion (SDL_rwops.h:177)
// would dereference a small integer.
SDL_AudioSpec * SDLCALL SDL_LoadWAV_RW( SDL_RWops * src,
                                        int freesrc,
                                        SDL_AudioSpec * /* spec */,
                                        Uint8 ** /* audio_buf */,
                                        Uint32 * /* audio_len */ )
{
    if ( freesrc )
    {
        SDL_FreeRW( src );
    }

    return NULL;
}

// A no-op that is consistent with the above rather than merely lazy: the
// SDL_LoadWAV_RW here never allocates, so there is never anything to free.
// Both callers -- eSound.cpp:539, and the !freeData branch of
// eWavData::Unload at eSound.cpp:590 -- only run against a buffer a
// successful load produced, so neither is reachable while loads return NULL.
void SDLCALL SDL_FreeWAV( Uint8 * /* audio_buf */ )
{
}

// -1 is SDL's documented "the format conversion is not supported"
// (SDL_audio.h:428-429), and eSound.cpp:523 compares against exactly -1 and
// throws the localised $sound_error_unsupported. Returning 0 -- SDL's "no
// conversion needed" -- would be the dangerous answer: eSound.cpp:528-530
// would then malloc len * cvt.len_mult and memcpy into it, off a
// stack-allocated SDL_AudioCVT that this function never initialised.
//
// src_format and dst_format are SDL_AudioFormat, spelled out rather than
// written as the Uint16 it is typedef'd to at SDL_audio.h:66, so the
// definition stays a copy of the declaration.
int SDLCALL SDL_BuildAudioCVT( SDL_AudioCVT * /* cvt */,
                               SDL_AudioFormat /* src_format */,
                               Uint8 /* src_channels */,
                               int /* src_rate */,
                               SDL_AudioFormat /* dst_format */,
                               Uint8 /* dst_channels */,
                               int /* dst_rate */ )
{
    return -1;
}

// Same failure value, tested the same way at eSound.cpp:534 and throwing the
// same $sound_error_unsupported. Unreachable in practice: its only caller
// runs after a SDL_BuildAudioCVT that returned -1 and threw.
int SDLCALL SDL_ConvertAudio( SDL_AudioCVT * /* cvt */ )
{
    return -1;
}

} // extern "C"

#endif // __EMSCRIPTEN__
