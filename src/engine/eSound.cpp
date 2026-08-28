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

#include "eSound.h"
#include "config.h"
#include "tMemManager.h"
#include "tDirectories.h"
#include "tRandom.h"
#include "tError.h"
#include <string>
#include "tConfiguration.h"
#include "uMenu.h"
#include "eCamera.h"
//#include "tList.h"
#include <iostream>
#include <stdlib.h>
#include "eGrid.h"
#include "tException.h"

//eGrid* eSoundPlayer::S_Grid = NULL;

#ifdef WIN32
#define HAVE_LIBSDL_MIXER 1
#endif

#ifndef DEDICATED
#ifdef  HAVE_LIBSDL_MIXER
#include <SDL_mixer.h>
static Mix_Music* music = NULL;
#endif

static SDL_AudioSpec audio;
static bool sound_is_there=false;
static bool uses_sdl_mixer=false;
#endif

// sound quality

#define SOUND_OFF 0
#define SOUND_LOW 1
#define SOUND_MED 2
#define SOUND_HIGH 3
#define SOUND_MONO 1
#define SOUND_STEREO 2

#ifdef WIN32
static int buffer_shift=1;
#else
static int buffer_shift=0;
#endif

static tConfItem<int> bs("SOUND_BUFFER_SHIFT",buffer_shift);

static int sound_quality=SOUND_MED;
static tConfItem<int> sq("SOUND_QUALITY",sound_quality);

static int sound_channels=SOUND_STEREO;
static tConfItem<int> sc("SOUND_CHANNELS",sound_channels);

static int sound_sources=10;
static tConfItem<int> ss("SOUND_SOURCES",sound_sources);
static REAL loudness_thresh=0;
static int real_sound_sources=0;

static tList<eSoundPlayer> se_globalPlayers;


void fill_audio(void *udata, Uint8 *stream, int len)
{
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
    // Zero the buffer before anything mixes into it. Every path below ADDS
    // into `stream` (eWavData::Mix does dest_s[i] += ...) and none of them
    // ever writes a baseline, so whatever the buffer arrives holding is
    // played. Native SDL 1.2 gets away with that because SDL_RunAudio memsets
    // the stream to the device's silence value before each callback;
    // Emscripten's SDL 1.2 emulation does not -- it malloc()s the buffer once
    // in SDL_OpenAudio and hands the same block back every time, uninitialised
    // on the first pass and holding the previous callback's mix afterwards.
    //
    // On the web client that is not a subtle glitch: no WAV ever loads (see
    // eWavData::Load below), so NOTHING writes to the buffer at all, and
    // uninitialised heap bytes get reinterpreted as signed 16-bit samples and
    // scheduled straight into the Web Audio graph. The symptom is loud noise
    // where the port intends silence. It also matters once M3 does load real
    // sounds, because the "add into an unspecified buffer" hazard survives
    // that change -- so this stays even when the Load() short-circuit goes.
    //
    // BUT IT IS ONLY CORRECT FOR THE SDL_OpenAudio REGISTRATION. fill_audio
    // has a second one: Mix_SetPostMix( &fill_audio, NULL ) at :270. A *post*
    // -mix callback is handed a buffer that ALREADY holds SDL_mixer's output,
    // to be modified in place -- zeroing it there would silence the music this
    // function is meant to mix on top of. That path is dead in this build (it
    // sits inside #ifdef HAVE_LIBSDL_MIXER, opened at :254, and
    // HAVE_LIBSDL_MIXER is defined only under WIN32 at :46-48; nothing in
    // src/emscripten/ or web/Makefile defines it), which is why one
    // unconditional memset is safe *today*. It stops being safe the moment
    // this file is built with SDL_mixer -- and M3, which owns real audio, is
    // exactly the milestone that might reach for it. If you are here because
    // you just enabled SDL_mixer: make this conditional on which callback you
    // are, do not delete it, or the SDL_OpenAudio path goes back to playing
    // uninitialised heap.
    //
    // `len` is SDL's byte count for this callback, which is exactly the
    // buffer's size; SDL_AudioSpec::size is the same number. It is `int`,
    // while memset's third parameter is size_t, so a negative len would
    // convert to ~4GB and make this a catastrophic overrun rather than a
    // no-op. Nothing checks for that -- not here, and not in the original
    // mixing code below, which indexes with `len` just as trustingly. SDL
    // does not pass negative lengths, so this is an assumption rather than a
    // latent bug; it is written down because the assumption is unchecked.
    memset( stream, 0, len );
#endif
#ifndef DEDICATED
    real_sound_sources=0;
    int i;
    if (eGrid::CurrentGrid())
        for(i=eGrid::CurrentGrid()->Cameras().Len()-1;i>=0;i--)
        {
            eCamera *pCam = eGrid::CurrentGrid()->Cameras()(i);
            if(pCam)
                pCam->SoundMix(stream,len);
        }

    for(i=se_globalPlayers.Len()-1;i>=0;i--)
        se_globalPlayers(i)->Mix(stream,len,0,1,1);

    if (real_sound_sources>sound_sources+4)
        loudness_thresh+=.01;
    if (real_sound_sources>sound_sources+1)
        loudness_thresh+=.001;
    if (real_sound_sources<sound_sources-4)
        loudness_thresh-=.001;
    if (real_sound_sources<sound_sources-1)
        loudness_thresh-=.0001;
    if (loudness_thresh<0)
        loudness_thresh=0;
#endif
}

#ifndef DEDICATED
#ifdef DEFAULT_SDL_AUDIODRIVER

// stringification, yep, two levels required
#define XSTRING(s) #s
#define STRING(s) XSTRING(s)

// call once to initialize SDL sound subsystem
static bool se_SoundInitPrepare()
{
    // initialize audio subsystem with predefined, hopefully good, driver
    if ( ! getenv("SDL_AUDIODRIVER") ) {
        char * arg = "SDL_AUDIODRIVER=" STRING(DEFAULT_SDL_AUDIODRIVER);
        putenv(arg);

        if ( SDL_InitSubSystem(SDL_INIT_AUDIO) >= 0 )
            return true;

        putenv("SDL_AUDIODRIVER=");
    }

    // if that fails, try what the user wanted
    return ( SDL_InitSubSystem(SDL_INIT_AUDIO) >= 0 );
}
#endif
#endif

void se_SoundInit()
{
#ifndef DEDICATED
    // save configuration file with sound disabled on first use so we don't try again
    bool needSave = false;
    static bool firstRun = true;
    if ( st_FirstUse )
    {
        needSave = true;
        int sound_quality_back = sound_quality;
        sound_quality = SOUND_OFF;
        st_SaveConfig();
        if ( firstRun )
            con << tOutput("$sound_firstinit");
        sound_quality=sound_quality_back;
    }

    if ( sound_quality != SOUND_OFF )
    {
#ifdef DEFAULT_SDL_AUDIODRIVER
        static bool init = se_SoundInitPrepare();
        if ( !init )
            return;
#endif
        if ( firstRun && !SDL_WasInit( SDL_INIT_AUDIO ) )
            return;
        firstRun = false;
    }

    if (!sound_is_there && sound_quality!=SOUND_OFF)
    {
        SDL_AudioSpec desired;
        memset( &desired, 0, sizeof( SDL_AudioSpec ) );

        switch (sound_quality)
        {
        case SOUND_LOW:
            desired.freq=11025; break;
        case SOUND_MED:
            desired.freq=22050; break;
        case SOUND_HIGH:
            desired.freq=44100; break;
        default:
            desired.freq=22050;
        }

        switch (sound_channels)
        {
        case SOUND_MONO:
            desired.channels = 1; break;
        case SOUND_STEREO:
            desired.channels = 2; break;
        default:
            desired.channels = 2;
        }

        desired.format=AUDIO_S16SYS;
        desired.samples=128;
        while (desired.samples <= desired.freq >> (6-buffer_shift))
            desired.samples <<= 1;
        desired.callback = fill_audio;
        desired.userdata = NULL;

#ifdef HAVE_LIBSDL_MIXER
        uses_sdl_mixer=true;

        // init using SDL_Mixer
        sound_is_there=(Mix_OpenAudio(desired.freq, desired.format, desired.channels, desired.samples)>=0);

        if ( sound_is_there )
        {
            // query actual sound info
            audio = desired;
            int channels;
            channels = desired.channels;
            Mix_QuerySpec( &audio.freq, &audio.format, &channels );
            audio.channels = channels;

            // register callback
            Mix_SetPostMix( &fill_audio, NULL );

            const tPath& vpath = tDirectories::Data();
            tString musFile = vpath.GetReadPath( "music/fire.xm" );

            music = Mix_LoadMUS( musFile );

            if ( music )
                Mix_FadeInMusic( music, -1, 2000 );

        }
#else
        // just use SDL to init sound
        uses_sdl_mixer=false;
        sound_is_there=(SDL_OpenAudio(&desired,&audio)>=0);
#endif
        if (sound_is_there && (audio.format!=AUDIO_S16SYS))
        {
            uses_sdl_mixer=false;
            se_SoundExit();
            // force emulation of 16 bit stereo; sadly, this cannot use SDL_Mixer :-(
            audio.format=AUDIO_S16SYS;
            sound_is_there=(SDL_OpenAudio(&audio,NULL)>=0);
            con << tOutput("$sound_error_no16bit");
        }
        if (!sound_is_there)
            con << tOutput("$sound_error_initfailed");
        else
        {
            //for(int i=wavs.Len()-1;i>=0;i--)
            //wavs(i)->Init();
#ifdef DEBUG
            tOutput o;
            o.SetTemplateParameter(1,audio.freq);
            o.SetTemplateParameter(2,audio.samples);
            o << "$sound_inited";
            con << o;
#endif
            se_SoundPause(false);
        }
    }

    // save sound settings, they appear to work
    if ( needSave )
    {
        st_SaveConfig();
    }
#endif
}

void se_SoundExit(){
#ifndef DEDICATED
    eSoundLocker locker;

    eWavData::UnloadAll();
    se_SoundPause(true);

    if (sound_is_there){
#ifdef DEBUG
        con << tOutput("$sound_disabling");
#endif
        //		se_SoundPause(false);
        //    for(int i=wavs.Len()-1;i>=0;i--)
        //wavs(i)->Exit();

#ifdef HAVE_LIBSDL_MIXER
        if ( music )
        {
            if( Mix_PlayingMusic() )
            {
                Mix_FadeOutMusic(100);
                SDL_Delay(100);
            }
            Mix_FreeMusic( music );
            music = NULL;
        }

        se_SoundPause(true);

        if ( uses_sdl_mixer )
            Mix_CloseAudio();
        else
#endif
            SDL_CloseAudio();

#ifdef DEBUG
        con << tOutput("$sound_disabling_done");
#endif
    }
    sound_is_there=false;
#endif
}

#ifndef DEDICATED
static unsigned int locks;
#endif

void se_SoundLock(){
#ifndef DEDICATED
    if (!locks)
        SDL_LockAudio();
    locks++;
#endif
}

void se_SoundUnlock(){
#ifndef DEDICATED
    locks--;
    if (!locks)
        SDL_UnlockAudio();
#endif
}

void se_SoundPause(bool p){
#ifndef DEDICATED
    SDL_PauseAudio(p);
#endif
}

// ***********************************************************

eWavData* eWavData::s_anchor = NULL;

eWavData::eWavData(const char * fileName,const char *alternative)
        :tListItem<eWavData>(s_anchor),data(NULL),len(0),freeData(false), loadError(false){
    //wavs.Add(this,id);
    filename     = fileName;
    filename_alt = alternative;

}

#ifndef DEDICATED

#ifdef SDL_LoadWAV
#undef SDL_LoadWAV
#endif

#ifdef __EMSCRIPTEN__

#include <stdio.h>

// ---------------------------------------------------------------------------
// The web client's WAV loader.
//
// WHY IT IS HERE AND NOT IN src/emscripten/eCompat.cpp. Emscripten's SDL 1.2
// emulation has no WAV decoder, so M1 shimmed SDL_LoadWAV_RW to return NULL
// and M2 short-circuited eWavData::Load() so that NULL could not turn into a
// thrown exception. Writing a real SDL_LoadWAV_RW is not an option: it takes
// an SDL_RWops*, and Emscripten's SDL_RWFromFile (libsdl.js:3543-3550) does
// not return one. It returns a small integer -- an index into a JS-side array
// -- cast to a pointer, and it never fails, so a C implementation has nothing
// it can legally dereference and no failure to test for. The function this
// file needs is the *file*-taking SDL_LoadWAV, which upstream declares as a
// macro over SDL_LoadWAV_RW and which this translation unit has already
// #undef'd above and replaced with its own static since upstream commit
// 7171696a ("Work around crash in sdl12-compat when trying to load sound
// files that do not exist"). The decoder goes behind that same static and
// reads the file with
// fopen. See docs/superpowers/plans/2026-08-28-m3-audio.md landmine 3.
//
// WHAT IT DELIBERATELY DOES NOT DO. No format conversion, no resampling and
// no endian swapping. It hands eWavData exactly what the file contains and
// rejects everything it cannot hand over unchanged. That is enough because
// the only two WAVs this tree ships (sound/cyclrun.wav, 22050 Hz, and
// sound/expl.wav, 11025 Hz -- verified by reading their headers, not by
// trusting a comment) are both 8-bit unsigned mono PCM, eSound.cpp's own
// AUDIO_U8 branch below takes them without conversion, and eWavData::Mix
// resamples per-sound against the device rate itself (Speed *= spec.freq;
// Speed /= audio.freq). SDL_BuildAudioCVT and SDL_ConvertAudio therefore
// stay the unreachable -1 stubs eCompat.cpp already has.
//
// REJECTING IS A FEATURE. eWavData::Mix has exactly four data layouts coded
// into it (AUDIO_U8 / AUDIO_S16SYS x mono / stereo) and no way to express "I
// do not understand this buffer" -- it would just reinterpret the bytes. So
// anything this parser is not certain about has to fail the load here, where
// failing is safe, rather than reach Mix, where it is not.
//
// FAILING MUST NOT THROW, AND THE FAILURE PATH IS THE COMMON ONE. Every
// eWavData except gCycle.cpp:232's names a moviepack file first
// (moviesounds/engine.wav, cycturn.wav, dietron.wav, intro.wav, extro.wav);
// moviesounds/ does not exist in this tree and is not in web/Makefile's
// --preload-file list, so the fopen below fails on the FIRST attempt of five
// of the six loads, before any of them succeeds. That is the designed
// behaviour of eWavData's fallback chain, not an error -- which is why a
// missing file returns NULL silently and only counts itself. The louder
// reason is landmine 1: Load() is reachable from eWavData::Mix, which runs
// from fill_audio, which Emscripten drives at the completion of every
// Asyncify rewind with wasm on the stack, and callUserCallback turns an
// exception escaping that into a process abort. Nothing on this path may
// throw. This function returns NULL; Load() below turns NULL into
// loadError = true instead of tGenericException.
// ---------------------------------------------------------------------------

// AUDIO_S16SYS is what eSound.cpp compares against and what the mixer's
// `short` reinterpretation assumes; RIFF stores 16-bit PCM little-endian.
// wasm is little-endian by specification so the two coincide, but assert it
// rather than assume it, because the whole 16-bit path is a silent
// byte-swapped mess if it ever stops being true.
static_assert( AUDIO_S16SYS == AUDIO_S16LSB,
               "this WAV parser hands over RIFF's little-endian samples unswapped" );

// Counts fopen() failures rather than printing one per failure: see the
// comment above for why misses are routine. Reported on the next successful
// load, so a transcript shows the miss path ran without a line per miss.
static int se_wavMisses = 0;

static bool se_WavRead( FILE * f, void * dest, size_t n )
{
    return fread( dest, 1, n, f ) == n;
}

static bool se_WavReadU32( FILE * f, Uint32 & out )
{
    unsigned char b[4];
    if ( !se_WavRead( f, b, sizeof( b ) ) )
        return false;
    out = Uint32( b[0] ) | ( Uint32( b[1] ) << 8 ) | ( Uint32( b[2] ) << 16 ) | ( Uint32( b[3] ) << 24 );
    return true;
}

static bool se_WavReadU16( FILE * f, Uint16 & out )
{
    unsigned char b[2];
    if ( !se_WavRead( f, b, sizeof( b ) ) )
        return false;
    out = Uint16( Uint32( b[0] ) | ( Uint32( b[1] ) << 8 ) );
    return true;
}

// Every diagnostic on the failure path goes through this budget. A malformed
// or unreadable WAV is a real defect worth seeing once, but it does not stay
// seen once: eSoundPlayer::Reset() calls Load() unconditionally -- it does
// NOT consult loadError -- and so does the eSoundPlayer(w,loop=true)
// constructor. Measured against a deliberately corrupted cyclrun.wav: a
// permanently failing cycle_run produces EIGHT load attempts per round (four
// cycles x constructor + Reset), in 26 ms, forever. The budget is what keeps
// that from becoming a log flood emitted partly from the audio callback.
static bool se_WavMayReport()
{
    static int budget = 16;
    if ( budget <= 0 )
        return false;
    --budget;
    return true;
}

// Single exit for every "the file exists but I will not guess at it" case.
static SDL_AudioSpec * se_WavReject( char const * file, char const * why, FILE * f, Uint8 * buffer )
{
    if ( se_WavMayReport() )
        printf( "[WAV] rejected %s: %s\n", file, why );

    if ( buffer )
        free( buffer );
    if ( f )
        fclose( f );

    return NULL;
}

static SDL_AudioSpec * SDLCALL SDL_LoadWAV( char const * file, SDL_AudioSpec * spec, Uint8 ** audio_buf, Uint32 * audio_len )
{
    if ( !file || !spec || !audio_buf || !audio_len )
        return NULL;

    FILE * f = fopen( file, "rb" );
    if ( !f )
    {
        // The routine case. Silent on purpose -- see the header comment.
        ++se_wavMisses;
        return NULL;
    }

    // The file's own length is the bound every chunk size is checked against,
    // so a corrupt size field cannot become a multi-gigabyte malloc or an
    // fseek past the end that later reads succeed off the back of.
    if ( fseek( f, 0, SEEK_END ) != 0 )
        return se_WavReject( file, "not seekable", f, NULL );

    long const fileEnd = ftell( f );
    if ( fileEnd < 12 )
        return se_WavReject( file, "shorter than a RIFF/WAVE header", f, NULL );
    if ( fseek( f, 0, SEEK_SET ) != 0 )
        return se_WavReject( file, "cannot rewind", f, NULL );

    Uint32 const limit = Uint32( fileEnd );

    char id[4];
    Uint32 riffSize = 0;
    if ( !se_WavRead( f, id, sizeof( id ) ) || 0 != memcmp( id, "RIFF", 4 ) )
        return se_WavReject( file, "not a RIFF file", f, NULL );
    if ( !se_WavReadU32( f, riffSize ) )
        return se_WavReject( file, "truncated RIFF header", f, NULL );
    if ( !se_WavRead( f, id, sizeof( id ) ) || 0 != memcmp( id, "WAVE", 4 ) )
        return se_WavReject( file, "RIFF form is not WAVE", f, NULL );

    // riffSize is read for completeness and deliberately not enforced: the
    // real bound is the file length above, and a WAV whose RIFF size field is
    // stale is still perfectly playable.
    (void)riffSize;

    bool haveFmt = false;
    Uint16 formatTag = 0, channels = 0, blockAlign = 0, bits = 0;
    Uint32 sampleRate = 0, byteRate = 0;
    Uint8 * buffer = NULL;
    Uint32 bufferLen = 0;

    // Walk the chunk list until the data chunk. Chunks may appear in any
    // order and unknown ones must be stepped over, not treated as an error:
    // sound/expl.wav ends with a 66-byte LIST (INFO) chunk after its data.
    while ( !buffer )
    {
        Uint32 chunkSize = 0;
        if ( !se_WavRead( f, id, sizeof( id ) ) || !se_WavReadU32( f, chunkSize ) )
            return se_WavReject( file, "end of file before a data chunk", f, NULL );

        if ( chunkSize > limit )
            return se_WavReject( file, "chunk claims more bytes than the file holds", f, NULL );

        if ( 0 == memcmp( id, "fmt ", 4 ) )
        {
            if ( chunkSize < 16 )
                return se_WavReject( file, "fmt chunk shorter than 16 bytes", f, NULL );

            if ( !se_WavReadU16( f, formatTag ) || !se_WavReadU16( f, channels ) ||
                 !se_WavReadU32( f, sampleRate ) || !se_WavReadU32( f, byteRate ) ||
                 !se_WavReadU16( f, blockAlign ) || !se_WavReadU16( f, bits ) )
                return se_WavReject( file, "truncated fmt chunk", f, NULL );

            haveFmt = true;

            // Step over anything the chunk holds beyond those 16 bytes (a
            // WAVE_FORMAT_EXTENSIBLE cbSize block, say) plus RIFF's pad byte
            // for an odd size. formatTag is checked after the walk, so an
            // extensible header is rejected there rather than here.
            Uint32 const rest = ( chunkSize - 16 ) + ( chunkSize & 1 );
            if ( rest && 0 != fseek( f, long( rest ), SEEK_CUR ) )
                return se_WavReject( file, "truncated fmt chunk", f, NULL );
        }
        else if ( 0 == memcmp( id, "data", 4 ) )
        {
            if ( !haveFmt )
                return se_WavReject( file, "data chunk before fmt chunk", f, NULL );
            if ( 0 == chunkSize )
                // Not pedantry: eWavData::Mix's `while (goon)` loop spins
                // forever on a LOOPING player whose sample count is zero --
                // every inner loop is guarded by `pos.pos < samples` so none
                // runs, and then its `pos.pos -= samples` cannot make
                // pos.pos < samples either, so goon never goes false. That is
                // a frozen tab, from inside the audio callback. Never hand
                // Mix a zero-length sample.
                return se_WavReject( file, "empty data chunk", f, NULL );

            buffer = static_cast< Uint8 * >( malloc( chunkSize ) );
            if ( !buffer )
                return se_WavReject( file, "out of memory for the sample data", f, NULL );
            if ( !se_WavRead( f, buffer, chunkSize ) )
                return se_WavReject( file, "truncated data chunk", f, buffer );

            bufferLen = chunkSize;
            // Whatever follows the data chunk is metadata this loader has no
            // use for, so stop here rather than seek over a pad byte that
            // sound/cyclrun.wav (odd data size, last chunk, no pad) omits.
        }
        else
        {
            Uint32 const skip = chunkSize + ( chunkSize & 1 );
            if ( 0 != fseek( f, long( skip ), SEEK_CUR ) )
                return se_WavReject( file, "unreadable chunk", f, NULL );
        }
    }

    // Everything below is "reject rather than guess". Each test names a
    // layout eWavData::Mix cannot represent.
    if ( 1 != formatTag )
        return se_WavReject( file, "not uncompressed PCM (fmt tag is not 1)", f, buffer );
    if ( 1 != channels && 2 != channels )
        return se_WavReject( file, "neither mono nor stereo", f, buffer );
    if ( 8 != bits && 16 != bits )
        return se_WavReject( file, "not 8 or 16 bits per sample", f, buffer );
    if ( 0 == sampleRate )
        return se_WavReject( file, "sample rate of zero", f, buffer );

    Uint32 const frame = Uint32( channels ) * Uint32( bits / 8 );
    if ( 0 != blockAlign && Uint32( blockAlign ) != frame )
        return se_WavReject( file, "block alignment disagrees with channels x bits", f, buffer );
    if ( bufferLen < frame )
        return se_WavReject( file, "less than one whole frame of sample data", f, buffer );

    // byteRate is redundant with sampleRate and blockAlign and is not used to
    // decide anything; read only so the fmt chunk is parsed in one pass.
    (void)byteRate;

    fclose( f );

    spec->freq     = int( sampleRate );
    spec->format   = ( 8 == bits ) ? AUDIO_U8 : AUDIO_S16SYS;
    spec->channels = Uint8( channels );
    spec->silence  = ( 8 == bits ) ? 0x80 : 0x00;
    spec->samples  = 4096;          // SDL 1.2's own value; nothing here reads it
    spec->padding  = 0;
    spec->size     = bufferLen;
    spec->callback = NULL;
    spec->userdata = NULL;

    *audio_buf = buffer;
    *audio_len = bufferLen;

    printf( "[WAV] loaded %s: %u bytes, %d-bit %s @ %d Hz (fopen misses so far: %d)\n",
            file, unsigned( bufferLen ), int( bits ),
            ( 1 == channels ) ? "mono" : "stereo", int( sampleRate ), se_wavMisses );

    // The caller tests `result != &spec`, so the identity matters, not just
    // non-NULL.
    return spec;
}

#else // __EMSCRIPTEN__

static SDL_AudioSpec * SDLCALL SDL_LoadWAV(char const *file, SDL_AudioSpec *spec, Uint8 **audio_buf, Uint32 *audio_len)
{
    auto *rw = SDL_RWFromFile(file, "rb");
    if(!rw)
        return nullptr;

    return SDL_LoadWAV_RW(rw,1, spec,audio_buf,audio_len);
}

#endif // __EMSCRIPTEN__

#endif

void eWavData::Load(){
    //wavs.Add(this,id);

    if (data)
    {
        loadError = false;
        return;
    }

    // M3 NOTE ON WHAT USED TO BE HERE. Until M3 this function began, under
    // __EMSCRIPTEN__, with an unconditional `loadError = true; return;`. The
    // decoder it was standing in for now exists (the static SDL_LoadWAV
    // above), so the short-circuit is gone -- but the reason it existed has
    // NOT gone away and is not allowed to. What it was really protecting
    // against was not a missing decoder, it was the `throw` statements
    // further down this function.
    //
    // Load() is reachable from eWavData::Mix, which runs from fill_audio,
    // which Emscripten drives at the completion of every Asyncify rewind with
    // wasm still on the stack (measured: Asyncify.state == Normal in 750/750
    // samples). callUserCallback turns a C++ exception escaping that into a
    // process abort, not a catchable error. And the nearest catch for the
    // throws below is sg_EnterGame (src/tron/gGame.cpp:4635), which aborts
    // entry into the round and shows a "Sound Error" modal -- so even on the
    // paths where the throw IS caught, a missing WAV does not mute the client,
    // it stops the game.
    //
    // So the guard was replaced, not removed: every `throw` on this path now
    // has a `#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )` arm that
    // fails the LOAD instead -- `loadError = true; return;` -- leaving the
    // caller in exactly the state a failed load leaves it in. loadError = true
    // rather than false is still load-bearing for the same reason it was
    // before: eWavData::Mix calls Load() only while !loadError, so setting it
    // stops a permanently impossible load from being retried on every audio
    // callback, forever.
    //
    // It does NOT stop every retry, and M2's version of this comment implied
    // it did. eSoundPlayer::Reset() and the eSoundPlayer(w,loop=true)
    // constructor both call Load() without consulting loadError, so a
    // permanently failing sound is re-attempted once per player per round --
    // measured at eight attempts per round for cycle_run against a
    // deliberately corrupted cyclrun.wav. That is bounded and cheap (an fopen
    // that fails), but it is why the diagnostics on the failure path are
    // budgeted rather than printed per attempt.
    //
    // PLAN.md's M3 note calls this block "M3's to delete". Deleting it without
    // guarding the throws would have re-armed both of them on the fill_audio
    // path; see docs/superpowers/plans/2026-08-28-m3-audio.md landmines 1-2.

#ifndef DEDICATED

// Only the throwing arms below name errorName, and under Emscripten there are
// none, so declaring it unconditionally is an unused-variable warning. The
// condition is spelled as the negation of the guard the rest of this file uses
// rather than the equivalent-here `#ifndef __EMSCRIPTEN__`, so that grepping
// for the guard finds every site it governs.
#if !( defined( __EMSCRIPTEN__ ) && !defined( DEDICATED ) )
    static char const * errorName = "Sound Error";
#endif

    freeData = false;

    loadError = true;

    alt=false;

    const tPath& path = tDirectories::Data();

    SDL_AudioSpec *result=SDL_LoadWAV( path.GetReadPath( filename ) ,&spec,&data,&len);
    if (result!=&spec || !data){
        if (filename_alt.Len()>1){
            result=SDL_LoadWAV( path.GetReadPath( filename_alt ),&spec,&data,&len);
            if (result!=&spec || !data)
            {
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
                // Fail the load, never the process -- see the M3 note above.
                // Both names were tried; there is nothing left to fall back to.
                if ( se_WavMayReport() )
                    printf( "[WAV] load failed: neither %s nor %s could be read\n",
                            static_cast< char const * >( filename ),
                            static_cast< char const * >( filename_alt ) );
                loadError = true;
                return;
#else
                tOutput err;
                err.SetTemplateParameter(1, filename);
                err << "$sound_error_filenotfound";
                throw tGenericException(err, errorName);
#endif
            }
            else
                alt=true;
        }
        else{
            result=SDL_LoadWAV( path.GetReadPath( "sound/expl.wav" ) ,&spec,&data,&len);
            if (result!=&spec || !data)
            {
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
                // Fail the load, never the process -- see the M3 note above.
                if ( se_WavMayReport() )
                    printf( "[WAV] load failed: neither %s nor the sound/expl.wav "
                            "stand-in could be read\n",
                            static_cast< char const * >( filename ) );
                loadError = true;
                return;
#else
                tOutput err;
                err.SetTemplateParameter(1, "sound/expl.waw");
                err << "$sound_error_filenotfount";
                throw tGenericException(err, errorName);
#endif
            }
            else
                len=0;
        }
        /*
          tERR_ERROR("Sound file " << fileName << " not found. Have you called "
          "Armagetron from the right directory?"); */
    }

    if (spec.format==AUDIO_S16SYS)
        samples=len>>1;
    else if(spec.format==AUDIO_U8)
        samples=len;
    else
    {
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
        // Unreachable by construction rather than by luck: the only producer
        // of `spec` in this build is the static SDL_LoadWAV above, and it
        // writes AUDIO_U8 or AUDIO_S16SYS and rejects every other file. That
        // is also why src/emscripten/eCompat.cpp's SDL_BuildAudioCVT and
        // SDL_ConvertAudio stay -1 stubs -- this is the branch that would
        // have called them, and it no longer does.
        //
        // Written out anyway, because "unreachable" arguments have been wrong
        // on this port before, and because the alternative here is two more
        // throws on the fill_audio path (landmine 1). Drop the buffer so the
        // mixer cannot reinterpret bytes in a layout it has no case for.
        if ( se_WavMayReport() )
            printf( "[WAV] load failed: %s decoded to unsupported format 0x%x; "
                    "the web client has no format conversion\n",
                    static_cast< char const * >( filename ),
                    unsigned( spec.format ) );
        SDL_FreeWAV( data );    // freeData is false here: set at the top of Load()
        data = NULL;
        len  = 0;
        loadError = true;
        return;
#else
        // prepare error message
        tOutput err;
        err.SetTemplateParameter(1, filename);
        err << "$sound_error_unsupported";

        // convert to 16 bit system format
        SDL_AudioCVT cvt;
        if ( -1 == SDL_BuildAudioCVT( &cvt, spec.format, spec.channels, spec.freq, AUDIO_S16SYS, spec.channels, spec.freq ) )
        {
            throw tGenericException(err, errorName);
        }

        cvt.buf=reinterpret_cast<Uint8 *>( malloc( len * cvt.len_mult ) );
        cvt.len=len;
        memcpy(cvt.buf, data, len);
        freeData = true;


        if ( -1 == SDL_ConvertAudio( &cvt ) )
        {
            throw tGenericException(err, errorName);
        }

        SDL_FreeWAV( data );
        data = cvt.buf;
        spec.format = AUDIO_S16SYS;
        len    = len * cvt.len_ratio;

        samples = len >> 1;
#endif
    }

    samples/=spec.channels;

#ifdef DEBUG
#ifdef LINUX
    con << "Sound file " << filename << " loaded: ";
    switch (spec.format){
    case AUDIO_S16SYS: con << "16 bit "; break;
    case AUDIO_U8: con << "8 bit "; break;
    default: con << "unknown "; break;
    }
    if (spec.channels==2)
        con << "stereo ";
    else
        con << "mono ";

    con << "at " << spec.freq << " Hz,\n";

    con << samples << " samples in " << len << " bytes.\n";

    loadError = false;
#endif
#endif
#endif
}

void eWavData::Unload(){
#ifndef DEDICATED
    loadError = false;

    //wavs.Add(this,id);
    if (data){
        eSoundLocker locker;
        if ( freeData )
        {

            free(data);

        }

        else

        {

            SDL_FreeWAV(data);

        }



        data=NULL;
        len=0;
    }
#endif
}

void eWavData::UnloadAll(){
    //wavs.Add(this,id);
    eWavData* wav = s_anchor;
    while ( wav )
    {
        wav->Unload();
        wav = wav->Next();
    }

}

eWavData::~eWavData(){
#ifndef DEDICATED
    Unload();
#endif
}

bool eWavData::Mix( Uint8* dest_u8, Uint32 playlen, eAudioPos& pos,
                    REAL Rvol, REAL Lvol, REAL Speed, bool loop )
{
#ifndef DEDICATED
    // we know the alignment is correct
    short* dest_s = reinterpret_cast<short*>( dest_u8 );

    if ( !data )
    {
        if( !loadError )
        {
            Load();
        }
        if ( !data )
        {
            return false;
        }
    }

    playlen/=4;

    //	Rvol *= 4;
    //	Lvol *= 4;

    const REAL thresh = .25;

    if ( Rvol > thresh )
    {
        Rvol = thresh;
    }

    if ( Lvol > thresh )
    {
        Lvol = thresh;
    }

#define SPEED_SHIFT 20
#define SPEED_FRACTION (1<<SPEED_SHIFT)

#define VOL_SHIFT 16
#define VOL_FRACTION (1<<VOL_SHIFT)

#define MAX_VAL ((1<<15)-1)
#define MIN_VAL (-(1<<15))

    // first, split the speed into the part before and after the decimal:
    if (Speed<0) Speed=0;

    // adjust for different sample rates:
    Speed*=spec.freq;
    Speed/=audio.freq;

    int speed=int(floor(Speed));
    int speed_fraction=int(SPEED_FRACTION*(Speed-speed));

    // secondly, make integers out of the volumes:
    int rvol=int(Rvol*VOL_FRACTION);
    int lvol=int(Lvol*VOL_FRACTION);


    bool goon=true;

    while (goon){
        if (spec.channels==2){
            if (spec.format==AUDIO_U8)
                while (playlen>0 && pos.pos<samples){
                    // fix endian problems for the Mac port, as well as support for other
                    // formats than  stereo...
                    int l = dest_s[0];
                    int r = dest_s[1];
                    r += (rvol*(data[(pos.pos<<1)  ]-128)) >> (VOL_SHIFT-8);
                    l += (lvol*(data[(pos.pos<<1)+1]-128)) >> (VOL_SHIFT-8);
                    if (r>MAX_VAL) r=MAX_VAL;
                    if (l>MAX_VAL) l=MAX_VAL;
                    if (r<MIN_VAL) r=MIN_VAL;
                    if (l<MIN_VAL) l=MIN_VAL;

                    dest_s[0] = l;
                    dest_s[1] = r;

                    dest_s += 2;

                    pos.pos+=speed;

                    pos.fraction+=speed_fraction;
                    while (pos.fraction>=SPEED_FRACTION){
                        pos.fraction-=SPEED_FRACTION;
                        pos.pos++;
                    }

                    playlen--;
                }
            else{
                auto data_s = reinterpret_cast<short const*>( data );
                while (playlen>0 && pos.pos<samples){
                    int l = dest_s[0];
                    int r = dest_s[1];
                    r += ( rvol * ( data_s[( pos.pos << 1 )] ) ) >> VOL_SHIFT;
                    l += ( lvol * ( data_s[( pos.pos << 1 ) + 1] ) ) >> VOL_SHIFT;
                    if (r>MAX_VAL) r=MAX_VAL;
                    if (l>MAX_VAL) l=MAX_VAL;
                    if (r<MIN_VAL) r=MIN_VAL;
                    if (l<MIN_VAL) l=MIN_VAL;

                    dest_s[0] = l;
                    dest_s[1] = r;

                    dest_s += 2;

                    pos.pos+=speed;

                    pos.fraction+=speed_fraction;
                    while (pos.fraction>=SPEED_FRACTION){
                        pos.fraction-=SPEED_FRACTION;
                        pos.pos++;
                    }
                    playlen--;
                }
            }
        }
        else{
            if (spec.format==AUDIO_U8){
                while (playlen>0 && pos.pos<samples){
                    // fix endian problems for the Mac port, as well as support for other
                    // formats than  stereo...
                    int l = dest_s[0];
                    int r = dest_s[1];
                    int d=data[pos.pos]-128;
                    l += (lvol*d) >> (VOL_SHIFT-8);
                    r += (rvol*d) >> (VOL_SHIFT-8);
                    if (r>MAX_VAL) r=MAX_VAL;
                    if (l>MAX_VAL) l=MAX_VAL;
                    if (r<MIN_VAL) r=MIN_VAL;
                    if (l<MIN_VAL) l=MIN_VAL;

                    dest_s[0] = l;
                    dest_s[1] = r;

                    dest_s += 2;

                    pos.pos+=speed;

                    pos.fraction+=speed_fraction;
                    while (pos.fraction>=SPEED_FRACTION){
                        pos.fraction-=SPEED_FRACTION;
                        pos.pos++;
                    }

                    playlen--;
                }
            }
            else
            {
                auto data_s = reinterpret_cast<short const*>( data );
                while (playlen>0 && pos.pos<samples){
                    int l = dest_s[0];
                    int r = dest_s[1];
                    int d = data_s[pos.pos];
                    l += (lvol*d) >> VOL_SHIFT;
                    r += (rvol*d) >> VOL_SHIFT;
                    if (r>MAX_VAL) r=MAX_VAL;
                    if (l>MAX_VAL) l=MAX_VAL;
                    if (r<MIN_VAL) r=MIN_VAL;
                    if (l<MIN_VAL) l=MIN_VAL;

                    dest_s[0] = l;
                    dest_s[1] = r;

                    dest_s += 2;

                    pos.pos+=speed;

                    pos.fraction+=speed_fraction;
                    while (pos.fraction>=SPEED_FRACTION){
                        pos.fraction-=SPEED_FRACTION;
                        pos.pos++;
                    }
                    playlen--;
                }
            }
        }

        if (loop && pos.pos>=samples)
            pos.pos-=samples;
        else
            goon=false;
    }
#endif
    return ( playlen > 0 );
}

void eWavData::Loop(){
#ifndef DEDICATED
    Uint8 *buff2=tNEW(Uint8) [len];

    if (buff2){
        memcpy(buff2,data,len);
        Uint32 samples;

        if (spec.format==AUDIO_U8){
            samples=len;
            for(int i=samples-1;i>=0;i--){
                Uint32 j=i+((len>>2)<<1);
                if (j>=len) j-=len;

                REAL a=fabs(100*(j/REAL(samples)-.5));
                if (a>1) a=1;
                REAL b=1-a;

                data[i]=int(a*buff2[i]+b*buff2[j]);
            }
        }
        else if (spec.format==AUDIO_S16SYS){
            samples=len>>1;
            auto data_s = reinterpret_cast<short*>( data );
            auto buff2_s = reinterpret_cast<short*>( buff2 );
            for(int i=samples-1;i>=0;i--){

                /*
                  REAL a=2*i/REAL(samples);
                  if (a>1) a=2-a;
                  REAL b=1-a;
                */


                Uint32 j=i+((samples>>2)<<1);
                while (j>=samples) j-=samples;

                REAL a=fabs(100*(j/REAL(samples)-.5));
                if (a>1) a=1;
                REAL b=1-a;

                data_s[i] = int( a * buff2_s[i] + b * buff2_s[j] );
            }
        }
        delete[] buff2;
    }

#endif
}


// ******************************************************************

void eAudioPos::Reset(int randomize){
#ifndef DEDICATED
    if (randomize){
        tRandomizer & randomizer = tRandomizer::GetInstance();
        fraction = randomizer.Get( SPEED_FRACTION );
        // fraction=int(SPEED_FRACTION*(rand()/float(RAND_MAX)));
        pos=randomizer.Get( randomize );
        // pos=int(randomize*(rand()/float(RAND_MAX)));
    }
    else
        fraction=pos=0;
#endif
}



eSoundPlayer::eSoundPlayer(eWavData &w,bool l)
        :id(-1),wav(&w),loop(l){
    if (l)
        wav->Load();

    for(int i=MAX_VIEWERS-1;i>=0;i--)
        goon[i]=true;
}

eSoundPlayer::~eSoundPlayer()
{
    eSoundLocker locker;
    se_globalPlayers.Remove(this,id);
}

bool eSoundPlayer::Mix(Uint8 *dest,
                       Uint32 len,
                       int viewer,
                       REAL rvol,
                       REAL lvol,
                       REAL speed){

    if (goon[viewer]){
        if (rvol+lvol>loudness_thresh){
            real_sound_sources++;
            return goon[viewer]=!wav->Mix(dest,len,pos[viewer],rvol,lvol,speed,loop);
        }
        else
            return true;
    }
    else
        return false;
}

void eSoundPlayer::Reset(int randomize){
    wav->Load();

    for(int i=MAX_VIEWERS-1;i>=0;i--){
        pos[i].Reset(randomize);
        goon[i]=true;
    }
}

void eSoundPlayer::End(){
    for(int i=MAX_VIEWERS-1;i>=0;i--){
        goon[i]=false;
    }
}


void eSoundPlayer::MakeGlobal(){
    wav->Load();

    eSoundLocker locker;
    se_globalPlayers.Add(this,id);
}


// ***************************************************************

uMenu Sound_menu("$sound_menu_text");

static uMenuItemInt sources_men
(&Sound_menu,"$sound_menu_sources_text",
 "$sound_menu_sources_help",
 sound_sources,2,20,2);


static uMenuItemSelection<int> sc_men
(&Sound_menu,"$sound_menu_channels_text",
 "$sound_menu_channels_help",
 sound_channels);

static uSelectEntry<int> e(sc_men,
                           "$sound_menu_channels_mono_text",
                           "$sound_menu_channels_mono_help",
                           SOUND_MONO);
static uSelectEntry<int> f(sc_men,
                           "$sound_menu_channels_stereo_text",
                           "$sound_menu_channels_stereo_help",
                           SOUND_STEREO);


static uMenuItemSelection<int> sq_men
(&Sound_menu,"$sound_menu_quality_text",
 "$sound_menu_quality_help",
 sound_quality);

static uSelectEntry<int> a(sq_men,
                           "$sound_menu_quality_off_text",
                           "$sound_menu_quality_off_help",
                           SOUND_OFF);
static uSelectEntry<int> b(sq_men,
                           "$sound_menu_quality_low_text",
                           "$sound_menu_quality_low_help",
                           SOUND_LOW);
static uSelectEntry<int> c(sq_men,
                           "$sound_menu_quality_medium_text",
                           "$sound_menu_quality_medium_help",
                           SOUND_MED);
static uSelectEntry<int> d(sq_men,
                           "$sound_menu_quality_high_text",
                           "$sound_menu_quality_high_help",
                           SOUND_HIGH);


static uMenuItemSelection<int> bm_men
(&Sound_menu,
 "$sound_menu_buffer_text",
 "$sound_menu_buffer_help",
 buffer_shift);

static uSelectEntry<int> ba(bm_men,
                            "$sound_menu_buffer_vsmall_text",
                            "$sound_menu_buffer_vsmall_help",
                            -2);

static uSelectEntry<int> bb(bm_men,
                            "$sound_menu_buffer_small_text",
                            "$sound_menu_buffer_small_help",
                            -1);

static uSelectEntry<int> bc(bm_men,
                            "$sound_menu_buffer_med_text",
                            "$sound_menu_buffer_med_help",
                            0);

static uSelectEntry<int> bd(bm_men,
                            "$sound_menu_buffer_high_text",
                            "$sound_menu_buffer_high_help",
                            1);

static uSelectEntry<int> be(bm_men,
                            "$sound_menu_buffer_vhigh_text",
                            "$sound_menu_buffer_vhigh_help",
                            2);


void se_SoundMenu(){
    //	se_SoundPause(true);
    //	se_SoundLock();
    int oldsettings=sound_quality + 8 * sound_channels;
    int oldshift=buffer_shift;
    Sound_menu.Enter();
    if (oldsettings!=sound_quality + 8 * sound_channels || oldshift!=buffer_shift){
        se_SoundExit();
        se_SoundInit();
    }
    //	se_SoundUnlock();
    //  se_SoundPause(false);
}

eSoundLocker::eSoundLocker()
{
    se_SoundLock();
}

eSoundLocker::~eSoundLocker()
{
    se_SoundUnlock();
}

