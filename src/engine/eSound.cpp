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

#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
// Named rather than inherited, matching src/emscripten/eCompat.cpp: everything
// the web client's additions to this file call comes from one of these two.
// <stdio.h> for fopen/fread/fseek/ftell/fclose and for the printf diagnostics,
// <string.h> for the memcmp that matches RIFF chunk ids. (free/malloc are
// already covered by this file's own <stdlib.h> above.) The rest of eSound.cpp
// reaches memset and memcpy through a transitive include; that is upstream's
// and is left alone, but new code should not add to it.
//
// They sit at the TOP rather than beside the WAV parser that first needed them
// because se_SoundInit's device-configuration line printfs from well above the
// parser. Guarded so the dedicated build's translation unit is unchanged --
// verified the usual way, by comparing the object's md5, not by reading this.
#include <stdio.h>
#include <string.h>
#endif

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

#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
// se_WavMayReport is the one budgeting mechanism these diagnostics use. It is
// DEFINED with the WAV parser further down, beside the [WAV] budgets and the
// measurements that explain why every line in this file needs an allowance;
// declared here because fill_audio sits above that point and uses it too.
// Declaring it beats open-coding `if (b > 0) { --b; printf(...); }` at each
// site: the rule about what an exhausted budget means is then stated once.
static bool se_WavMayReport( int & budget );

// State for the voice-limiter watch at the bottom of fill_audio; see the
// comment there for what each line means and why both are edge-triggered.
//
// TWO ALLOWANCES, NOT ONE, for the reason the [WAV] budgets are three and not
// one. The peak line fires once per new maximum, so a count climbing 0 -> 9 can
// spend nine lines before any limiter transition happens; the transition line
// then fired six times in a measured three-round run. Sharing sixteen between
// them means the ramp can silence the transitions -- the more interesting of
// the two events -- and one more oscillation than measured would have done it.
// Each also keeps a full allowance rather than a small one: the last peak is
// the number worth having, so a budget that runs out mid-climb would report a
// peak that is merely the budget.
static int se_peakSoundSources = 0;
static int se_peakBudget = 16;
static bool se_limiterCutting = false;
static int se_limiterBudget = 16;
#endif

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
    // Under M2 that was not a subtle glitch. NO WAV COULD LOAD -- Load() was
    // short-circuited (see eWavData::Load below) -- so nothing wrote to the
    // buffer at all, and uninitialised heap bytes got reinterpreted as signed
    // 16-bit samples and scheduled straight into the Web Audio graph. The
    // symptom was loud noise where the port intended silence.
    //
    // M3 gave eWavData::Load a real WAV decoder, so wavs DO load now and the
    // mixing paths below DO write. That removes the "nothing writes at all"
    // case; it does NOT remove the reason for this memset, because the "add
    // into a buffer whose prior contents are unspecified" hazard is unchanged
    // -- Emscripten still hands back the previous callback's mix. So this
    // stays. It outlived the short-circuit it was written alongside.
    //
    // EVERY SAME-FILE REFERENCE BELOW NAMES A SYMBOL, NOT A LINE, and that is
    // a rule rather than a style. Line citations in this file have now gone
    // stale twice in one milestone -- M2 left a ":270" that M3 task 2 was sent
    // to fix, and task 2's own replacement rotted by 67 lines before it was
    // committed, because inserting a comment block above a citation silently
    // invalidates it. A symbol survives that and is greppable; a line number is
    // neither. The project already applies this rule to emsdk citations for the
    // same reason. Keep line numbers only for CROSS-file pointers, where they
    // drift far less and there is nothing local to grep for.
    //
    // IT IS ONLY CORRECT FOR THE SDL_OpenAudio REGISTRATION, WHICH IS WHY IT
    // IS CONDITIONAL. fill_audio has a second registration: the
    // `Mix_SetPostMix( &fill_audio, NULL )` in se_SoundInit. A *post*-mix
    // callback is handed a buffer that ALREADY holds SDL_mixer's output, to be
    // modified in place -- zeroing it there would silence the music this
    // function is meant to mix on top of. That path is dead in this build (it
    // sits inside se_SoundInit's `#ifdef HAVE_LIBSDL_MIXER`, and
    // HAVE_LIBSDL_MIXER is `#define`d only under WIN32 near the top of this
    // file; nothing in src/emscripten/ or web/Makefile defines it), so
    // uses_sdl_mixer is false on every path this build can take and the memset
    // runs exactly as often as the unconditional version M2 shipped did. The
    // condition costs one load of a file-static bool per callback and buys the
    // property that enabling SDL_mixer stops being a silent-audio bug.
    //
    // WHY uses_sdl_mixer AND NOT #ifndef HAVE_LIBSDL_MIXER, which would be
    // free. Which callback fill_audio is registered as is a RUNTIME fact even
    // in a build that HAS SDL_mixer: se_SoundInit's format fallback -- the
    // `if (sound_is_there && (audio.format!=AUDIO_S16SYS))` block -- reacts to
    // Mix_OpenAudio handing back a format other than AUDIO_S16SYS by setting
    // uses_sdl_mixer = false, closing the mixer, and re-opening the device with
    // plain SDL_OpenAudio -- after which fill_audio is the SDL_OpenAudio
    // callback again and the memset is needed again. A compile-time guard would
    // zero nothing on exactly that path and play uninitialised heap, which is
    // the failure this whole comment is about.
    //
    // The static is assigned before every registration, on all three paths:
    // `uses_sdl_mixer=true` precedes Mix_OpenAudio/Mix_SetPostMix, and both
    // `uses_sdl_mixer=false` assignments precede their SDL_OpenAudio call (the
    // plain #else open, and the format-fallback re-open just described). Its
    // initialiser, `static bool uses_sdl_mixer=false` above, covers the window
    // before se_SoundInit runs at all. So it is never read here before it
    // describes reality.
    //
    // `len` is SDL's byte count for this callback, which is exactly the
    // buffer's size; SDL_AudioSpec::size is the same number. It is `int`,
    // while memset's third parameter is size_t, so a negative len would
    // convert to ~4GB and make this a catastrophic overrun rather than a
    // no-op. Nothing checks for that -- not here, and not in the original
    // mixing code below, which indexes with `len` just as trustingly. SDL
    // does not pass negative lengths, so this is an assumption rather than a
    // latent bug; it is written down because the assumption is unchecked.
    if ( !uses_sdl_mixer )
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

#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
    // WATCHING THE LIMITER ABOVE, WHICH HAS NEVER RUN AGAINST REAL VOICES.
    // Until M3 no wav could load, so every eSoundPlayer::Mix that incremented
    // real_sound_sources did so for a voice that produced no samples; the
    // arithmetic above ran, and it ran on a number that meant nothing. This is
    // the first build in which it means something, and the two facts worth
    // knowing about it -- how many voices this game really has live at once,
    // and whether that is ever enough to make the limiter start cutting -- are
    // not observable from anything else. Both are in this one line.
    //
    // EDGE-TRIGGERED ON A NEW PEAK, so it is self-limiting without needing to
    // be trusted: real_sound_sources only ever produces a finite number of new
    // maxima, and each one is printed at most once. se_peakBudget is belt and
    // braces on top of that, and it is a SEPARATE allowance from the three
    // [WAV] ones and from the transition line below, for the same reason those
    // are separate from each other -- a different event at a different rate
    // must not spend their lines.
    //
    // WHAT THE NUMBER MEANS, EXACTLY: real_sound_sources is zeroed at the top
    // of this function and read here at the bottom, and eSoundPlayer::Mix -- its
    // only writer -- runs nowhere except between those two points. So each
    // reading is the COMPLETE voice count for that callback, not a sample of a
    // continuously varying quantity, and there is no window between callbacks in
    // which a higher count could hide. Measured 9 at every buffer size, i.e. at
    // callback rates from 5.4/s to 43/s, which is a consistency check rather
    // than a coincidence.
    if ( real_sound_sources > se_peakSoundSources )
    {
        se_peakSoundSources = real_sound_sources;
        if ( se_WavMayReport( se_peakBudget ) )
            printf( "[SND] live voices peaked at %d (SOUND_SOURCES %d, loudness_thresh %.4f)\n",
                    real_sound_sources, sound_sources, double( loudness_thresh ) );
    }

    // AND THE OTHER EDGE: loudness_thresh leaving or returning to zero, which
    // is the limiter starting and stopping to CUT. It is a separate event from
    // a new peak and cannot be inferred from one -- the threshold moves in
    // .0001-to-.01 steps per callback, so it crosses zero long after whatever
    // voice count pushed it there, and it can oscillate without the peak ever
    // changing again. It gets its OWN allowance for exactly that reason: a
    // count ramping up to its peak can spend nine lines on peak reporting
    // before the limiter does anything at all, and a measured three-round run
    // produced six transitions -- fifteen of a shared sixteen, with one more
    // oscillation enough to silence the half worth reading.
    //
    // Measured in the shipped configuration: the count peaks at 9 against
    // SOUND_SOURCES 10, so neither raising arm ever fires and this never
    // prints. One voice of margin. Lowering SOUND_SOURCES or raising the AI
    // count crosses it, and then this is the line that says so.
    if ( ( loudness_thresh > 0 ) != se_limiterCutting )
    {
        se_limiterCutting = ( loudness_thresh > 0 );
        if ( se_WavMayReport( se_limiterBudget ) )
            printf( "[SND] voice limiter %s cutting: %d live voices, SOUND_SOURCES %d, "
                    "loudness_thresh %.4f\n",
                    se_limiterCutting ? "STARTED" : "stopped",
                    real_sound_sources, sound_sources, double( loudness_thresh ) );
    }
#endif
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
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
            // THE OBTAINED SPEC, WHICH IS NOT THE ONE ASKED FOR. Reported
            // because three separate things downstream are decided by it and
            // none of them is otherwise observable from a transcript:
            //
            //  - audio.freq is the divisor in eWavData::Mix's resampling
            //    (Speed *= spec.freq; Speed /= audio.freq), so if it is not
            //    the rate the device actually runs at, every sound is
            //    detuned by the ratio. Emscripten CLAMPS the request upward
            //    -- libsdl.js's SDL_OpenAudio rounds anything <= 22050 up to
            //    22050 -- so SOUND_QUALITY 1 (11025) does NOT give an 11025 Hz
            //    device, and the number here is the one Mix will use.
            //  - audio.samples is the callback buffer in frames, set by the
            //    doubling loop above from SOUND_BUFFER_SHIFT. It is the whole
            //    of the latency/starvation trade, and the config file that
            //    chooses it cannot report what it produced.
            //  - the derived figures let a reader check the buffer-shift
            //    choice against the transcript instead of against a comment.
            //
            // Unbudgeted, unlike the [WAV] lines, and the difference is the
            // call rate, not a difference of opinion about noise:
            // se_SoundInit runs once from SDLSoundCleanup's constructor and
            // again only when se_SoundMenu (below) sees SOUND_QUALITY,
            // SOUND_CHANNELS or SOUND_BUFFER_SHIFT change. It is not reachable
            // from fill_audio.
            //
            // The format is printed as a NUMBER unless it is one of the two the
            // mixer can actually handle. A line whose job is to report the
            // obtained spec must not answer "8-bit" for a format it does not
            // recognise -- that is the kind of confident-and-wrong diagnostic
            // that costs an afternoon. AUDIO_U8 is unreachable here (se_SoundInit
            // re-opens the device forcing AUDIO_S16SYS if it gets anything else)
            // and is listed anyway, because "unreachable" has been wrong before
            // on this port.
            if ( audio.format == AUDIO_S16SYS || audio.format == AUDIO_U8 )
                printf( "[SND] device opened: %d Hz, %d ch, %d-bit, %d frames/callback"
                        " (%.1f ms per callback, SOUND_BUFFER_SHIFT %d)\n",
                        int( audio.freq ), int( audio.channels ),
                        ( audio.format == AUDIO_S16SYS ) ? 16 : 8,
                        int( audio.samples ),
                        audio.freq > 0 ? ( 1000.0 * audio.samples / audio.freq ) : 0.0,
                        buffer_shift );
            else
                printf( "[SND] device opened: %d Hz, %d ch, UNSUPPORTED FORMAT 0x%x,"
                        " %d frames/callback (%.1f ms per callback,"
                        " SOUND_BUFFER_SHIFT %d)\n",
                        int( audio.freq ), int( audio.channels ),
                        unsigned( audio.format ), int( audio.samples ),
                        audio.freq > 0 ? ( 1000.0 * audio.samples / audio.freq ) : 0.0,
                        buffer_shift );
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

// The parser's <stdio.h> and <string.h> now live at the top of the file, in
// the include block beside upstream's <stdlib.h>, because M3 task 2 added a
// printf ABOVE this point -- se_SoundInit's device line -- and a declaration
// cannot be used before the #include that provides it. The reasoning for
// naming them rather than inheriting them is unchanged and is recorded there.

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

// EVERY "[WAV]" line goes through a budget -- successes included, not just
// failures -- because every one of them can be emitted from inside the audio
// callback and none of them is bounded by anything else.
//
// Failures: eSoundPlayer::Reset() calls Load() unconditionally -- it does NOT
// consult loadError -- and so does the eSoundPlayer(w,loop=true) constructor.
// Measured against a deliberately corrupted cyclrun.wav: a permanently failing
// cycle_run produces EIGHT load attempts per round (four cycles x constructor
// + Reset), in 26 ms, forever.
//
// Successes: eWavData::Unload sets loadError = false and data = NULL, so the
// next eWavData::Mix re-arms its `if( !loadError ) Load()` -- from fill_audio.
// se_SoundExit -> UnloadAll runs on every SOUND_QUALITY change, so a load that
// succeeds is not a once-per-program event either.
//
// The two have SEPARATE allowances so neither can starve the other: a flood of
// failures must not be what hides the successful loads, and vice versa. When
// an allowance runs out the lines simply stop -- absence of a later "[WAV]"
// line means the budget is spent, NOT that no further load happened.
// A THIRD ALLOWANCE, not a share of either of the two above, because it counts
// a different event and one that fires at a different rate. The two above count
// LOADS; this one counts VOICES RETIRED for want of samples, at the two early
// returns in eWavData::Mix (the `!data` arm and the `0 == samples` guard),
// which is called once per player per camera per audio callback. At the buffer
// size this port ships -- 1024 frames against a 22050 Hz device, SOUND_BUFFER_
// SHIFT 1 -- that is 21.5 callbacks a second (see the note beside the setting
// in web/webdefaults/autoexec.cfg), each one walking every gCycle's three
// players, so a single unloadable wav in a four-cycle round can reach this line
// well over a hundred times a second -- orders of magnitude above the load rate
// the other two budgets were measured against, and enough to bury them if it
// shared their allowance.
//
// It exists at all because the retirement is otherwise INVISIBLE: it turns a
// voice off, and a voice that was already producing no samples sounds exactly
// the same afterwards. Without a line, the only way to tell the fix from its
// absence is to reason about it. With one, a deliberately unloadable wav shows
// the retirement happening a bounded number of times instead of on every
// callback forever, which is the claim being made.
static int se_wavFailureBudget = 16;
static int se_wavSuccessBudget = 16;
static int se_wavRetireBudget  = 16;

static bool se_WavMayReport( int & budget )
{
    if ( budget <= 0 )
        return false;
    --budget;
    return true;
}

// Single exit for every "the file exists but I will not guess at it" case.
static SDL_AudioSpec * se_WavReject( char const * file, char const * why, FILE * f, Uint8 * buffer )
{
    if ( se_WavMayReport( se_wavFailureBudget ) )
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
    // This is the last fmt field that reaches eWavData::Mix's arithmetic
    // unchecked, and one end of the range hangs the audio callback.
    //
    // THE HANG IS THE SIGNED ONE. spec.freq is `int`, so a rate above INT_MAX
    // arrives NEGATIVE. Mix clamps with `if (Speed<0) Speed=0;` BEFORE it
    // applies `Speed *= spec.freq`, so the clamp does not catch it and Speed
    // is never re-checked; `speed` goes negative; and eAudioPos::pos is Uint32
    // (eSound.h), so `pos.pos += speed` unsigned-wraps to just under 2^32.
    // The `pos.pos < samples` guard still keeps every read in bounds -- this
    // is not a memory-safety bug -- but for a LOOPING player the outer
    // `while (goon)` then walks `pos.pos -= samples` all the way down, about
    // 2^32/samples iterations, and does it again on EVERY callback because the
    // next `pos.pos += speed` re-wraps. Measured on this target with a rate of
    // 0xF0000000 and Speed 1: spec.freq -268435456, speed -12174, pos.pos
    // 4294955122, and 106302 outer iterations against cyclrun.wav's 40403
    // samples -- 42949551 against a 100-sample file. The float-to-int
    // conversion does not trap (speed stays well inside int), so this is a
    // hang, not an abort. Same failure the empty-data-chunk rejection above
    // exists to prevent.
    //
    // A large rate that is still POSITIVE does not hang -- measured: 3000000
    // Hz gives speed 136 and ZERO outer iterations, because the walk costs
    // only about speed/samples and `speed` cannot get far ahead of `samples`
    // while it stays inside int. That half of the range is rejected because
    // the parser's contract is to reject what it does not understand, not
    // because it is dangerous: 3 MHz mono PCM is a corrupt field, and
    // accepting it would play the sound at 136x.
    //
    // 192000 is the highest rate in common use and comfortably above the
    // 22050/11025 this tree ships. It covers the signed case as a side effect,
    // which is the property that actually matters.
    if ( 0 == sampleRate || sampleRate > 192000 )
        return se_WavReject( file, "sample rate outside 1..192000 Hz; above INT_MAX "
                                   "it turns negative and hangs the mixer's loop",
                             f, buffer );

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

    if ( se_WavMayReport( se_wavSuccessBudget ) )
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
                if ( se_WavMayReport( se_wavFailureBudget ) )
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
                if ( se_WavMayReport( se_wavFailureBudget ) )
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
                // UPSTREAM'S SILENT-PLACEHOLDER IDIOM, AND THE ONE IN-TREE
                // PRODUCER OF THE SHAPE THE PARSER REFUSES TO LOAD. This keeps
                // sound/expl.wav's buffer but reports zero bytes, so the
                // eWavData ends up with data != NULL and samples == 0 -- the
                // exact wav the "empty data chunk" rejection above (see the
                // comment on it) exists to keep out of eWavData::Mix, because
                // Mix's outer `while (goon)` cannot terminate on one when
                // loop is true. Reachable only for gGame.cpp's intro/extro,
                // which have no alternative filename; both are driven by the
                // NON-looping eSoundPlayer(w) overload, which is the only
                // reason this is safe. Anyone who makes them loop, or who
                // copies this idiom for a looping sound, freezes the tab.
                //
                // New as of M3: under M2 no eWavData ever had data at all, so
                // this line could not produce anything.
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
        if ( se_WavMayReport( se_wavFailureBudget ) )
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
#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
            // RETIRE THE VOICE INSTEAD OF LEAVING IT RUNNING SILENT. This
            // function's return value means "end reached"; the
            // `goon[viewer]=!wav->Mix(...)` in eSoundPlayer::Mix inverts it,
            // so `false` here says
            // "still playing, call me again next callback" about a sound that
            // has no data and, once loadError is set, will not acquire any
            // before the next eSoundPlayer::Reset(). The player then never
            // retires, and each callback pays for it twice: it re-enters this
            // function, and -- the part that has teeth now that sound actually
            // plays -- eSoundPlayer::Mix increments real_sound_sources on the
            // way in. That counter is the ONLY input to the loudness_thresh
            // voice limiter -- the block of `real_sound_sources` comparisons
            // at the bottom of fill_audio -- which
            // raises the threshold by .01 per callback once the count exceeds
            // SOUND_SOURCES+4. Voices that produce no samples would therefore
            // push the threshold up until they silenced the voices that do.
            // Reporting "finished" costs nothing that matters: Reset() and
            // MakeGlobal() both call Load() unconditionally, so a sound whose
            // file comes back re-arms at the start of the next round anyway.
            //
            // Returning TRUE from a function whose contract is "end reached"
            // for a sound that never started is a small lie, and the honest
            // alternative -- a third return state -- does not exist in this
            // signature and cannot be added without touching the dedicated
            // build. The lie is confined to the failure path.
            if ( se_WavMayReport( se_wavRetireBudget ) )
                printf( "[WAV] retiring a voice on %s: no sample data (loadError=%d)\n",
                        static_cast< char const * >( filename ), int( loadError ) );
            return true;
#else
            return false;
#endif
        }
    }

#if defined( __EMSCRIPTEN__ ) && !defined( DEDICATED )
    // THE ZERO-SAMPLE WAV, WHICH IS A HANG BELOW RATHER THAN A SILENCE. `data`
    // being non-NULL does not imply there is anything to play: Load()'s
    // stand-in arm -- the `len=0` in Load()'s no-alternative else -- keeps
    // sound/expl.wav's buffer and then reports zero bytes,
    // upstream's silent-placeholder idiom, which leaves this object with
    // data != NULL and samples == 0. On that shape the outer `while (goon)`
    // below cannot terminate when loop is true -- every inner loop is guarded
    // by `pos.pos < samples` so none of them runs or advances pos, the
    // `loop && pos.pos >= samples` test is then permanently true, and
    // `pos.pos -= samples` subtracts nothing. That is an infinite loop inside
    // the audio callback: a frozen tab, not a muted one.
    //
    // It is LATENT, not live, and this check is what keeps it from mattering
    // which one it is. The only two eWavData that can reach the len = 0 arm
    // are gGame.cpp:181-182's intro/extro (they name a moviepack file with no
    // sound/ alternative), and gGame.cpp:4530-4531 drive both through the
    // non-looping eSoundPlayer(w) overload -- eSound.h:112's `loop` default --
    // so today the loop exits on its first pass regardless. One `true` at
    // either of those two call sites is the whole distance between here and a
    // hang, which is too little for a comment to be the only thing holding it.
    //
    // The parser cannot close this: it already rejects an empty data chunk, so
    // the shape cannot arrive from a FILE. This is the consumer-side half of
    // that same rejection, for the one producer inside this file.
    if ( 0 == samples )
    {
        if ( se_WavMayReport( se_wavRetireBudget ) )
            printf( "[WAV] retiring a voice on %s: loaded but zero samples\n",
                    static_cast< char const * >( filename ) );
        return true;
    }
#endif

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

