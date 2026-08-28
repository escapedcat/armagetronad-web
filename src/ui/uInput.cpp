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

#include "uInput.h"
#include "tMemManager.h"
#include "rScreen.h"
#include "tInitExit.h"
#include "tConfiguration.h"
#include "rConsole.h"
#include "uMenu.h"
#include "tSysTime.h"

bool su_mouseGrab = false;

static uAction* su_allActions[uMAX_ACTIONS];
static int     su_allActionsLen = 0;

uAction::uAction(uAction *&anchor,const char* name,
                 int priority_,
                 uInputType t)
        :tListItem<uAction>(anchor),tooltip_(NULL),type(t),priority(priority_),internalName(name){
    globalID = localID = su_allActionsLen++;

    tASSERT(localID < uMAX_ACTIONS);

    su_allActions[localID] = this;

    tString descname;
    descname << "input_" << name << "_text";
    tToLower( descname );

    const_cast<tOutput&>(description).AddLocale(descname);

    tString helpname;
    helpname << "input_" << name << "_help";
    tToLower( helpname );

    const_cast<tOutput&>(helpText).AddLocale(helpname);
}

uAction::uAction(uAction *&anchor,const char* name,
                 const tOutput& desc,
                 const tOutput& help,
                 int priority_,
                 uInputType t)
        :tListItem<uAction>(anchor),tooltip_(NULL),type(t),priority(priority_),internalName(name), description(desc), helpText(help){
    globalID = localID = su_allActionsLen++;

    tASSERT(localID < uMAX_ACTIONS);

    su_allActions[localID] = this;
}

uAction::~uAction(){
    su_allActions[localID] = NULL;
}

uAction * uAction::Find( char const * name )
{
    for(int i=su_allActionsLen-1;i>=0;i--)
        if(!strcmp(name,su_allActions[i]->internalName))
            return su_allActions[i];

    return 0;
}

// ****************************************
// a configuration class for keyboard binds
// ****************************************

#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )
//! Re-encode a keysym read from a .cfg file from SDL 1.2's numbering into the
//! numbering this build's SDL actually delivers.
//!
//! WHY THIS EXISTS. Every shipped KEYBOARD line is DATA that means "the left
//! arrow key". 276 is merely SDL 1.2's encoding of that key. Emscripten's SDL
//! shim uses SDL 2's keycode scheme -- scancode | SDLK_SCANCODE_MASK -- with
//! the mask patched down from 1<<30 to 1<<10 (SDL_keycode.h:46, and the
//! comment there says why: "closer to old SDL, gives a better chance of SDL
//! 1.X apps working"). So the same physical key arrives as 80|1024 = 1104.
//! Nothing reconciles the two: keymap[] is indexed by the raw
//! e.key.keysym.sym (su_HandleEvent, below), so the shipped binds land on
//! array slots that no keystroke can ever reach and the arrow keys are simply
//! dead. Re-encoding the data where it is read is the honest fix, and it fixes
//! all five shipped keys_*.cfg layouts plus default.cfg's camera, message and
//! instant-chat binds in one place.
//!
//! The menus were never affected -- uMenu.cpp compares against SDLK_* NAMES,
//! which the compiler resolves to this build's values -- which is why M1 and
//! every M2 task before this one passed without noticing.
//!
//! IT IS IDEMPOTENT, AND THEREFORE SAFE FOR M4's user.cfg PERSISTENCE. The
//! source range (256-312) and the target range (1081-1255) are disjoint, so a
//! value that has already been translated passes through untouched. That
//! matters because WriteVal (below) writes whatever is in keymap[], i.e. the
//! NEW encoding: a player who rebinds turn-left onto the left arrow in the
//! binding menu gets keymap[1104] set from the live event, 1104 written to
//! user.cfg, and 1104 read back unchanged. Re-reading our own output is a
//! no-op, not a second translation.
//!
//! ONLY THE NON-ASCII RANGE IS TOUCHED. 0-127 already agree in both encodings
//! (SDL 1.2 and SDL 2 both use the ASCII value for printable keys, Return,
//! Escape, Tab, Backspace and Delete), and Emscripten's DOM->SDL map falls
//! back to the raw DOM keyCode for anything under 128 (libsdl.js:816), so
//! those binds -- 'v', 'z', Escape, Return, Tab -- have always worked. This
//! function must not disturb them.
//!
//! THE VALUES WERE MEASURED, NOT ASSUMED, in two independent ways:
//!   * compile-time: an em++ program built with -sUSE_SDL=1 printing every
//!     SDLK_* used below (SDLK_LEFT 1104, SDLK_UP 1106, SDLK_RIGHT 1103,
//!     SDLK_DOWN 1105, SDLK_LAST 1536, ...);
//!   * run-time: the browser client logging e.key.keysym.sym for each arrow
//!     press, which reported the same numbers.
//! The targets below are written as SDLK_* constants rather than as literals
//! precisely so this table cannot drift if a future emsdk changes the mask.
//!
//! DELIBERATELY NOT TRANSLATED, and each omission is load-bearing:
//!
//!   * 313-322 (SDL 1.2 MODE, COMPOSE, HELP, PRINT, SYSREQ, BREAK, MENU,
//!     POWER, EURO, UNDO). 316 is the reason for the cut line: SDL 1.2's
//!     SDLK_PRINT is 316 and Emscripten's DOM table maps the PrintScreen key
//!     to the literal 316 as well (libsdl.js:145, an SDL-1.2 leftover among
//!     otherwise SDL-2 values), so default.cfg's `KEYBOARD 316 ... SCREENSHOT`
//!     already works by that coincidence. Translating it to SDLK_PRINTSCREEN
//!     (1094) would BREAK a binding that works today.
//!
//!     There IS one other shipped bind in this range, and an earlier revision
//!     of this comment wrongly said there was none: default.cfg:88 binds 319
//!     (SDL 1.2's SDLK_MENU) to TOGGLE_FULLSCREEN. Leaving it dead costs
//!     nothing, because default.cfg:89-90 bind the same action to 110 ('n')
//!     and 102 ('f'), which are ASCII and therefore untranslated and live, so
//!     fullscreen is reachable either way.
//!     The rest of the range has no unambiguous same-key target and no
//!     shipped bind: across all six files under config/ that contain
//!     KEYBOARD lines, 316 and 319 are the only two keycodes bound anywhere
//!     in 313-322.
//!
//!   * 324-336. These are not SDL keysyms at all: they are this program's own
//!     mouse pseudo-keys, SDLK_MOUSE_X_PLUS and friends, defined in uInput.h
//!     as SDLK_LAST+1..SDLK_LAST+13. They are stale in the config files for
//!     the same underlying reason (SDL 1.2's SDLK_LAST was 323; here it is
//!     1536), so default.cfg's mouse camera binds at lines 31-35 are dead
//!     too. Fixing that needs the browser's pointer-lock behaviour verified
//!     first, so it is left for a later milestone rather than enabled blind.
//!
//! TWO TARGETS THE BROWSER CANNOT CURRENTLY PRODUCE, translated anyway because
//! the mapping is what it is and both were equally dead before:
//!   * the right-hand modifiers. A DOM keydown carries keyCode 16/17/18 for
//!     shift/ctrl/alt with no side information, and libsdl.js maps them to the
//!     LEFT variants only, so a bind on SDLK_RSHIFT never fires.
//!   * SDLK_KP_ENTER. The numpad Enter reports DOM keyCode 13, so it arrives
//!     as SDLK_RETURN. default.cfg binds CHAT to both 13 and 271, so chat
//!     still works through the 13.
//!
//! ALTERNATIVES CONSIDERED AND REJECTED:
//!   * a shipped keys_web.cfg -- the keys_*.cfg templates are only applied
//!     under st_FirstUse, so it would stop taking effect the moment M4
//!     persists a user.cfg;
//!   * KEYBOARD lines in web/webdefaults/autoexec.cfg -- that file loads
//!     AFTER user.cfg, which makes every line in it a hard override a player
//!     could never rebind away;
//!   * defaulting to WASD -- leaves the arrow keys dead, so the first thing a
//!     new player tries still does nothing and the game reads as broken.
static int su_TranslateSDL12Keysym( int keysym )
{
    switch ( keysym )
    {
        // numeric keypad: SDL 1.2 SDLK_KP0..SDLK_KP_EQUALS, 256-272
    case 256: return SDLK_KP_0;
    case 257: return SDLK_KP_1;
    case 258: return SDLK_KP_2;
    case 259: return SDLK_KP_3;
    case 260: return SDLK_KP_4;
    case 261: return SDLK_KP_5;
    case 262: return SDLK_KP_6;
    case 263: return SDLK_KP_7;
    case 264: return SDLK_KP_8;
    case 265: return SDLK_KP_9;
    case 266: return SDLK_KP_PERIOD;
    case 267: return SDLK_KP_DIVIDE;
    case 268: return SDLK_KP_MULTIPLY;
    case 269: return SDLK_KP_MINUS;
    case 270: return SDLK_KP_PLUS;
    case 271: return SDLK_KP_ENTER;
    case 272: return SDLK_KP_EQUALS;

        // arrows: SDL 1.2 SDLK_UP..SDLK_LEFT, 273-276. This is the whole
        // point of the exercise -- keys_cursor.cfg binds 276/275/274.
    case 273: return SDLK_UP;
    case 274: return SDLK_DOWN;
    case 275: return SDLK_RIGHT;
    case 276: return SDLK_LEFT;

        // Home/End pad: SDL 1.2 SDLK_INSERT..SDLK_PAGEDOWN, 277-281
    case 277: return SDLK_INSERT;
    case 278: return SDLK_HOME;
    case 279: return SDLK_END;
    case 280: return SDLK_PAGEUP;
    case 281: return SDLK_PAGEDOWN;

        // function keys: SDL 1.2 SDLK_F1..SDLK_F15, 282-296
    case 282: return SDLK_F1;
    case 283: return SDLK_F2;
    case 284: return SDLK_F3;
    case 285: return SDLK_F4;
    case 286: return SDLK_F5;
    case 287: return SDLK_F6;
    case 288: return SDLK_F7;
    case 289: return SDLK_F8;
    case 290: return SDLK_F9;
    case 291: return SDLK_F10;
    case 292: return SDLK_F11;
    case 293: return SDLK_F12;
    case 294: return SDLK_F13;
    case 295: return SDLK_F14;
    case 296: return SDLK_F15;

        // locks and modifiers: SDL 1.2 SDLK_NUMLOCK..SDLK_RSUPER, 300-312.
        // SDL 2 dropped the META/SUPER distinction, so 309-312 collapse onto
        // the two GUI keys. Harmless: the translation is read-only, and
        // WriteVal only ever emits the post-translation values.
    case 300: return SDLK_NUMLOCKCLEAR;
    case 301: return SDLK_CAPSLOCK;
    case 302: return SDLK_SCROLLLOCK;
    case 303: return SDLK_RSHIFT;
    case 304: return SDLK_LSHIFT;
    case 305: return SDLK_RCTRL;
    case 306: return SDLK_LCTRL;
    case 307: return SDLK_RALT;
    case 308: return SDLK_LALT;
    case 309: return SDLK_RGUI;   // SDL 1.2 SDLK_RMETA
    case 310: return SDLK_LGUI;   // SDL 1.2 SDLK_LMETA
    case 311: return SDLK_LGUI;   // SDL 1.2 SDLK_LSUPER
    case 312: return SDLK_RGUI;   // SDL 1.2 SDLK_RSUPER
    }

    return keysym;
}
#endif

class tConfItem_key:public tConfItemBase{
public:
    tConfItem_key():tConfItemBase("KEYBOARD"){}
    ~tConfItem_key(){}

    // write the complete keymap
    virtual void WriteVal(std::ostream &s){
        int first=1;
        for(int keysym=SDLK_NEWLAST-1;keysym>=0;keysym--){
            if (keymap[keysym]){

                if (!first)
                    s << "\nKEYBOARD\t";
                else
                    first=0;

                s << keysym << '\t';
                keymap[keysym]->Write(s);
            }
        }
        if (first)
            s << "-1";
    }

    // read one keybind
    virtual void ReadVal(std::istream &s){
        tString in;
        int keysym;
        s >> keysym;
#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )
        // The shipped .cfg files spell their keysyms in SDL 1.2's numbering;
        // this build's SDL delivers SDL 2's. See su_TranslateSDL12Keysym above
        // for the full reasoning, the measured values, and why this is
        // idempotent (and so survives M4's user.cfg round-trip).
        keysym = su_TranslateSDL12Keysym( keysym );
#endif
        if (keysym>=0){
            tASSERT(keysym < SDLK_NEWLAST);
            s >> in;
            if (uBindPlayer::IsKeyWord(in))
            {
                keymap[keysym] = NULL;
                keymap[keysym]=uBindPlayer::NewBind(s);
                if (!keymap[keysym]->act)
                {
                    keymap[keysym]=NULL;
                }
                /* if (global_bind::IsKeyWord(in))
                   keymap[keysym]=new global_bind(s); */
            }
        }
        char c=' ';
        while(c!='\n' && s.good() && !s.eof()) c=s.get();
    }
};

// we need just one
static tConfItem_key x;

static uAction *s_playerActions;
static uAction *s_cameraActions;
static uAction *s_globalActions;

uActionPlayer::uActionPlayer(const char *name,
                             int priority,
                             uInputType t)
    :uAction(s_playerActions,name,priority,t){}

uActionPlayer::uActionPlayer(const char *name,
                             const tOutput& desc,
                             const tOutput& help,
                             int priority,
                             uInputType t)
        :uAction(s_playerActions,name,desc,help,priority,t){}

uActionPlayer::~uActionPlayer(){}

bool uActionPlayer::operator==(const uActionPlayer &x){
    return x.globalID == globalID;}

uActionPlayer *uActionPlayer::Find(int id){
    uAction *run = s_playerActions;

    while (run){
        if (run->ID() == id)
            return static_cast<uActionPlayer*>(run);
        run = run->Next();
    }

    return NULL;
}


uActionCamera::uActionCamera(const char *name,
                             int priority,
                             uInputType t)
    :uAction(s_cameraActions,name,priority,t){}

uActionCamera::~uActionCamera(){}

bool uActionCamera::operator==(const uActionCamera &x){
    return x.globalID == globalID;}


// global actions
uActionGlobal::uActionGlobal(const char *name,
                             int priority,
                             uInputType t)
        :uAction(s_globalActions,name,priority,t){}

uActionGlobal::~uActionGlobal(){}

bool uActionGlobal::operator==(const uActionGlobal &x){
    return x.globalID == globalID;}

bool uActionGlobal::IsBreakingGlobalBind(int sym){
    if (!keymap[sym])
        return false;
    uAction *act=keymap[sym]->act;
    if (!act)
        return false;

    return uActionGlobalFunc::IsBreakingGlobalBind(act);
}

// ***************************
//    the generic keymaps
// ***************************

tJUST_CONTROLLED_PTR< uBind > keymap[SDLK_NEWLAST];
bool                          pressed[SDLK_NEWLAST];

static void keyboard_init(){
    for(int i=0;i<SDLK_NEWLAST;i++)
        keymap[i]=NULL;
    //uBindPlayer::Init();
    //global_bind::Init();
}

static void keyboard_exit(){
    for(int i=0;i<SDLK_NEWLAST;i++)
        keymap[i] = 0;
    //uBindPlayer::Init();
    //global_bind::Init();
}

static tInitExit keyboard_ie(&keyboard_init, &keyboard_exit);

// *********************************************
// generic keypress/mouse movement binding class
// *********************************************

uBind::~uBind(){}

uBind::uBind(uAction *a ):lastValue_(0), delayedValue_(0), lastSym_(-1), lastTime_(-1), act(a){}

uBind::uBind(std::istream &s): lastValue_(0), delayedValue_(0), lastSym_(-1), lastTime_(-1), act(NULL)
{
    std::string name;
    s >> name;
    act = uAction::Find( name.c_str() );
}

void uBind::Write(std::ostream &s){
    s << act->internalName << '\t';
}

bool GlobalAct(uAction *act,REAL x){
    return uActionGlobalFunc::GlobalAct(act,x);
}

bool uBind::Activate(REAL x, bool delayed )
{
    delayedValue_ = x;

    if ( !delayed || !Delayable() )
    {
        lastValue_ = x;
        return this->DoActivate( x );
    }

    return true;
}

void uBind::HanldeDelayed()
{
    if ( lastValue_ != delayedValue_ )
    {
        lastValue_ = delayedValue_;
        this->DoActivate( delayedValue_ );
    }
}

REAL su_doubleBindTimeout=-10.0f;

bool uBind::IsDoubleBind( int sym )
{
    double currentTime = tSysTimeFloat();

    // if a different key was used for this action a short while ago, give alarm.
    bool ret = ( su_doubleBindTimeout > 0 && sym != lastSym_ && currentTime - lastTime_ < su_doubleBindTimeout );

    // store last usage
    lastSym_ = sym;
    lastTime_ = currentTime;

    // return result
    return ret;
}

// *******************
// player config
// *******************

static int nextid = 0;

uPlayerPrototype* uPlayerPrototype::PlayerConfig(int i){
    tASSERT(i>=0 && i<uMAX_PLAYERS);
    return playerConfig[i];
}


uPlayerPrototype::uPlayerPrototype(){
    static bool inited=false;
    if (!inited)
    {
        for(int i=uMAX_PLAYERS-1; i >=0; i--)
            playerConfig[i] = NULL;

        inited = true;
    }

    id = nextid++;
    tASSERT(id < uMAX_PLAYERS);
    playerConfig[id] = this;


}

uPlayerPrototype::~uPlayerPrototype(){
    playerConfig[id] = NULL;
}

uPlayerPrototype* uPlayerPrototype::playerConfig[uMAX_PLAYERS];

int uPlayerPrototype::Num(){return nextid;}

// *******************
// Input configuration
// *******************


// *****************************************************
//  Menuitem for input selection
// *****************************************************

#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )
//! Name a keysym for the controls menu, because Emscripten's SDL_GetKeyName
//! cannot.
//!
//! Its whole body (libsdl.js:1754-1764) is
//!
//!     var name = '';
//!     if ((key >= 97 && key <= 122) || (key >= 48 && key <= 57))
//!       name = String.fromCharCode(key);
//!
//! -- lowercase a-z and the digits 0-9, and the empty string for absolutely
//! everything else. So the controls menu renders a BLANK next to every action
//! bound to an arrow, Escape, Return, Tab, space, a function key, or any
//! punctuation. The bind works; the screen just does not say what it is.
//!
//! That was tolerable while the non-ASCII binds were dead anyway. It is not
//! tolerable now: su_TranslateSDL12Keysym (above) is precisely what puts the
//! arrow keys into this menu, so without this the first thing a player sees
//! after the steering fix is "Turn Left" with nothing beside it -- and this
//! screen is the one they would use to work around a binding problem.
//!
//! The strings match SDL 1.2's own keynames table (SDL_keyboard.c), so the
//! browser build labels its keys exactly as the native build does, rather than
//! inventing a second vocabulary. ASCII is handled here too, not delegated to
//! SDL_GetKeyName, so that the punctuation binds default.cfg ships ('`' for
//! CONSOLE_INPUT, '-' and '=' for instant chat, space for brake) are named as
//! well; SDL 1.2 returns the bare character for those, and so do we.
static char const * su_EmscriptenKeyName( int sym )
{
    switch ( sym )
    {
        // ASCII keys SDL 1.2 gives a word rather than a glyph
    case 8:   return "backspace";
    case 9:   return "tab";
    case 12:  return "clear";
    case 13:  return "return";
    case 19:  return "pause";
    case 27:  return "escape";
    case 32:  return "space";
    case 127: return "delete";

    case SDLK_KP_0: return "[0]";
    case SDLK_KP_1: return "[1]";
    case SDLK_KP_2: return "[2]";
    case SDLK_KP_3: return "[3]";
    case SDLK_KP_4: return "[4]";
    case SDLK_KP_5: return "[5]";
    case SDLK_KP_6: return "[6]";
    case SDLK_KP_7: return "[7]";
    case SDLK_KP_8: return "[8]";
    case SDLK_KP_9: return "[9]";
    case SDLK_KP_PERIOD:   return "[.]";
    case SDLK_KP_DIVIDE:   return "[/]";
    case SDLK_KP_MULTIPLY: return "[*]";
    case SDLK_KP_MINUS:    return "[-]";
    case SDLK_KP_PLUS:     return "[+]";
    case SDLK_KP_ENTER:    return "enter";
    case SDLK_KP_EQUALS:   return "equals";

    case SDLK_UP:       return "up";
    case SDLK_DOWN:     return "down";
    case SDLK_RIGHT:    return "right";
    case SDLK_LEFT:     return "left";
    case SDLK_INSERT:   return "insert";
    case SDLK_HOME:     return "home";
    case SDLK_END:      return "end";
    case SDLK_PAGEUP:   return "page up";
    case SDLK_PAGEDOWN: return "page down";

    case SDLK_F1:  return "f1";
    case SDLK_F2:  return "f2";
    case SDLK_F3:  return "f3";
    case SDLK_F4:  return "f4";
    case SDLK_F5:  return "f5";
    case SDLK_F6:  return "f6";
    case SDLK_F7:  return "f7";
    case SDLK_F8:  return "f8";
    case SDLK_F9:  return "f9";
    case SDLK_F10: return "f10";
    case SDLK_F11: return "f11";
    case SDLK_F12: return "f12";
    case SDLK_F13: return "f13";
    case SDLK_F14: return "f14";
    case SDLK_F15: return "f15";

    case SDLK_NUMLOCKCLEAR: return "numlock";
    case SDLK_CAPSLOCK:     return "caps lock";
    case SDLK_SCROLLLOCK:   return "scroll lock";
    case SDLK_RSHIFT:       return "right shift";
    case SDLK_LSHIFT:       return "left shift";
    case SDLK_RCTRL:        return "right ctrl";
    case SDLK_LCTRL:        return "left ctrl";
    case SDLK_RALT:         return "right alt";
    case SDLK_LALT:         return "left alt";
    case SDLK_RGUI:         return "right meta";
    case SDLK_LGUI:         return "left meta";
    case SDLK_MODE:         return "alt gr";
    case SDLK_APPLICATION:  return "menu";
    case SDLK_HELP:         return "help";
    case SDLK_PRINTSCREEN:  return "print screen";
    case 316:               return "print screen"; // what libsdl.js actually
                                                   // delivers for PrintScreen
                                                   // -- see the note in
                                                   // su_TranslateSDL12Keysym
    case SDLK_SYSREQ:       return "sys req";
    case SDLK_PAUSE:        return "pause"; // SDL 2 merged Pause and Break;
                                            // the browser reports the key as
                                            // DOM keyCode 19, so it arrives as
                                            // ASCII 19 above, not as this
    case SDLK_POWER:        return "power";
    case SDLK_UNDO:         return "undo";
    }

    // Printable ASCII: return the character itself, as SDL 1.2 does. The
    // buffer is static, so the result is valid only until the next call --
    // the same contract SDL_GetKeyName already has (it returns SDL.keyName,
    // one shared reallocated buffer), and every caller here copies it into a
    // tString immediately.
    if ( sym > 32 && sym < 127 )
    {
        static char single[2] = { 0, 0 };
        single[0] = static_cast< char >( sym );
        return single;
    }

    return "";
}
#endif

static char const * keyname(int sym){
#ifndef DEDICATED
    if (sym<=SDLK_LAST)
#if defined( __EMSCRIPTEN__ )
        // Emscripten's SDL_GetKeyName names only a-z and 0-9; everything else
        // would render blank. Substitute a table that can name a key.
        return su_EmscriptenKeyName(sym);
#else
        return SDL_GetKeyName(static_cast<SDLKey>(sym));
#endif
    else switch (sym){
        case SDLK_MOUSE_X_PLUS: return "Mouse right";
        case SDLK_MOUSE_X_MINUS: return "Mouse left";
        case SDLK_MOUSE_Y_PLUS: return "Mouse up";
        case SDLK_MOUSE_Y_MINUS: return "Mouse down";
        case SDLK_MOUSE_Z_PLUS: return "Mouse z up";
        case SDLK_MOUSE_Z_MINUS: return "Mouse z down";
        case SDLK_MOUSE_BUTTON_1: return "Mousebutton 1";
        case SDLK_MOUSE_BUTTON_2: return "Mousebutton 2";
        case SDLK_MOUSE_BUTTON_3: return "Mousebutton 3";
        case SDLK_MOUSE_BUTTON_4: return "Mousebutton 4";
        case SDLK_MOUSE_BUTTON_5: return "Mousebutton 5";
        case SDLK_MOUSE_BUTTON_6: return "Mousebutton 6";
        case SDLK_MOUSE_BUTTON_7: return "Mousebutton 7";
        }
#endif
    return "";
}

class uMenuItemInput: uMenuItem{
    uAction      *act;
    int         ePlayer;
    bool        active;
public:
    uMenuItemInput(uMenu *M,uAction *a,int p)
            :uMenuItem(M,a->helpText),act(a),ePlayer(p),active(0){
    }

    virtual ~uMenuItemInput(){}

    virtual void Render(REAL x,REAL y,REAL alpha=1,bool selected=0){
        DisplayText(REAL(x-.02),y,act->description,selected,alpha,1);

        if (active)
        {
            tString s;
            s << tOutput("$input_press_any_key");
            DisplayText(REAL(x+.02),y,s,selected,alpha,-1);
        }
        else{
            tString s;

            bool first=1;

            for(int keysym=SDLK_NEWLAST-1;keysym>=0;keysym--)
                if(keymap[keysym] &&
                        keymap[keysym]->act==act &&
                        keymap[keysym]->CheckPlayer(ePlayer)){
                    if (!first)
                        s << ", ";
                    else
                        first=0;

                    s << keyname(keysym);
                }
            if(!first)
                DisplayText(REAL(x+.02),y,s,selected,alpha,-1);
            else
                DisplayText(REAL(x+.02),y,tOutput("$input_items_unbound"),selected,alpha,-1);
        }
    }

    virtual void Enter(){
        active=1;
    }

#define MTHRESH 5
#define MREL    2

#ifndef DEDICATED

    virtual bool Event(SDL_Event &e){
        int sym=-1;
        switch (e.type){
        case SDL_MOUSEMOTION:
            if(active){
                REAL xrel=e.motion.xrel;
                REAL yrel=-e.motion.yrel;

                if (fabs(xrel)>MREL*fabs(yrel)){ // x motion
                    if (xrel>MTHRESH) // left
                        sym=SDLK_MOUSE_X_PLUS;
                    if (xrel<-MTHRESH) // left
                        sym=SDLK_MOUSE_X_MINUS;
                }

                if (fabs(yrel)>MREL*fabs(xrel)){ // x motion
                    if (yrel>MTHRESH) // left
                        sym=SDLK_MOUSE_Y_PLUS;
                    if (yrel<-MTHRESH) // left
                        sym=SDLK_MOUSE_Y_MINUS;
                }

                if (sym>0)
                    active=0;
            }

            break;
        case SDL_MOUSEBUTTONDOWN:
            if(active){
                int button=e.button.button;
                if (button<=MOUSE_BUTTONS)
                    sym=SDLK_MOUSE_BUTTON_1+button-1;

                active=0;
            }
            break;

        case SDL_KEYDOWN:{
                SDL_keysym &c=e.key.keysym;
                if(!active){
                    if (c.sym==SDLK_DELETE || c.sym==SDLK_BACKSPACE)
                    {
                        for(int keysym=SDLK_NEWLAST-1;keysym>=0;keysym--)
                            if(keymap[keysym] &&
                                    keymap[keysym]->act==act &&
                                    keymap[keysym]->CheckPlayer(ePlayer)){
                                keymap[keysym]=NULL;
                            }
                        return true;
                    }
                    return false;
                }

                active=0;

                if (c.sym!=SDLK_ESCAPE)
                    sym=c.sym;
                else
                    return true;
            }
            break;
        default:
            return(false);
        }

        if(sym>=0){
            if(keymap[sym] &&
                    keymap[sym]->act==act &&
                    keymap[sym]->CheckPlayer(ePlayer)){
                keymap[sym]=NULL;
            }
            else{
                keymap[sym]=NULL;
                keymap[sym]=uBindPlayer::NewBind(act,ePlayer);
            }
            return true;
        }
        return false;
    }
#endif

    virtual tString Help(){
        tString ret;
        ret << helpText << "\n";
        ret << tOutput("$input_item_help");
        return ret;
    }
};

namespace
{
class Input_Comparator
{
public:
    static int Compare( const uAction* a, const uAction* b )
    {
        if ( a->priority < b->priority )
            return 1;
        else if ( a->priority > b->priority )
            return -1;
        return tString::CompareAlphaNumerical( a->internalName, b->internalName );
    }
};
}

static void s_InputConfigGeneric(int ePlayer, uAction *&actions,const tOutput &title){
    uMenuItemInput **input;

    uMenu input_menu(title);

    uActionTooltip::Disable(ePlayer+1);

    uAction::Sort<Input_Comparator>(actions);

    int len = uAction::Len(actions);

    input=tNEW(uMenuItemInput*)[len];
    int a=0;
    for(uAction *A=actions;A; A = A->Next()){
        input[a++]=new uMenuItemInput(&input_menu,
                                      A,
                                      ePlayer+1);

    }

    input_menu.ReverseItems();
    input_menu.Enter();

    for(int b=a-1;b>=0;b--)
        delete input[b];
    delete[] input;
}

void su_InputConfig(int ePlayer){

    tOutput name;
    name.SetTemplateParameter(1, ePlayer+1);
    name.SetTemplateParameter(2, uPlayerPrototype::PlayerConfig(ePlayer)->Name());
    name << "$input_for_player";

    s_InputConfigGeneric(ePlayer,s_playerActions,name);
}

void su_InputConfigCamera(int player){

    tOutput name;
    name.SetTemplateParameter(1, uPlayerPrototype::PlayerConfig(player)->Name());
    name << "$camera_controls";

    s_InputConfigGeneric(player,s_cameraActions,name);
}

void su_InputConfigGlobal(){
    s_InputConfigGeneric(-1,s_globalActions,"$input_items_global");
}


REAL mouse_sensitivity=REAL(.1);
REAL key_sensitivity=40;
static double lastTime=0;
static REAL ts=0;

static bool su_delayed = false;

void su_HandleDelayedEvents ()
{
    // nothing to do
    if ( !su_delayed )
    {
        return;
    }

    su_delayed = false;

    for ( int i = SDLK_NEWLAST - 1; i>=0; --i )
    {
        if ( keymap[i] )
        {
            keymap[i]->HanldeDelayed();
        }
    }
}

bool su_HandleEvent(SDL_Event &e, bool delayed ){
#ifndef DEDICATED
    int sym=-1;
    REAL pm=0;

    if ( su_delayed && !delayed )
    {
        su_HandleDelayedEvents();
    }

    su_delayed = delayed;

    // there is nearly allways a mouse motion tEvent:
    int xrel=e.motion.xrel;
    int yrel=-e.motion.yrel;


    switch (e.type){
    case SDL_MOUSEMOTION:
        if ( !su_mouseGrab ||
                e.motion.x!=sr_screenWidth/2 || e.motion.x!=sr_screenHeight/2)
        {
            if (keymap[SDLK_MOUSE_X_PLUS])
                keymap[SDLK_MOUSE_X_PLUS]->Activate(xrel*mouse_sensitivity, delayed );

            if (keymap[SDLK_MOUSE_X_MINUS])
                keymap[SDLK_MOUSE_X_MINUS]->Activate(-xrel*mouse_sensitivity, delayed );

            if (keymap[SDLK_MOUSE_Y_PLUS])
                keymap[SDLK_MOUSE_Y_PLUS]->Activate(yrel*mouse_sensitivity, delayed );

            if (keymap[SDLK_MOUSE_Y_MINUS])
                keymap[SDLK_MOUSE_Y_MINUS]->Activate(-yrel*mouse_sensitivity, delayed );
        }


        return true; // no fuss: allways pretend to have handled this.
        break;

    case SDL_MOUSEBUTTONDOWN:
    case SDL_MOUSEBUTTONUP:{
            int button=e.button.button;
            if (button<=MOUSE_BUTTONS){
                sym=SDLK_MOUSE_BUTTON_1+button-1;
            }
        }
        if (e.type==SDL_MOUSEBUTTONDOWN)
            pm=1;
        else
            pm=-1;
        break;

    case SDL_KEYDOWN:
        sym=e.key.keysym.sym;
        pm=1;
        break;

    case SDL_KEYUP:
        sym=e.key.keysym.sym;
        pm=-1;
        break;

    default:
        break;
    }
    if (sym>=0 && keymap[sym]){
        REAL realpm=pm;
        if (keymap[sym]->act->type==uAction::uINPUT_ANALOG)
            pm*=ts*key_sensitivity;
        pressed[sym]=(realpm>0);
        if ( pm > 0 && keymap[sym]->IsDoubleBind( sym ) )
            return true;
        return (keymap[sym]->Activate(pm, delayed ));

    }
    else
#endif  
        return false;
}

void su_InputSync(){
    double time=tSysTimeFloat();
    ts=REAL(time-lastTime);

    //static REAL tsSmooth=0;
    //tsSmooth+=REAL(ts*.1);
    //tsSmooth/=REAL(1.1);
    lastTime=time;

    for(int sym=SDLK_NEWLAST-1;sym>=0;sym--)
        if (pressed[sym] && keymap[sym] &&
                keymap[sym]->act->type==uAction::uINPUT_ANALOG)
            keymap[sym]->Activate(ts*key_sensitivity, su_delayed );
}

void su_ClearKeys()
{
    for(int sym=SDLK_NEWLAST-1;sym>=0;sym--)
    {
        if (pressed[sym] && keymap[sym] )
            keymap[sym]->Activate(-1, su_delayed );
        pressed[sym] = false;
    }
}

// *****************
// Player binds
// *****************

static char const * Player_keyword="PLAYER_BIND";

uBindPlayer::uBindPlayer(uAction *a,int p):uBind(a),ePlayer(p){}

uBindPlayer::~uBindPlayer(){}

uBindPlayer * uBindPlayer::NewBind(std::istream &s)
{
    // read action
    std::string actionName;
    s >> actionName;
    uAction * act = uAction::Find( actionName.c_str() );

    // read player ID
    int player;
    s >> player;

    // delegate
    return NewBind( act, player );
}

uBindPlayer * uBindPlayer::NewBind( uAction * action, int player )
{
    // see if the bind has an alias
    for ( int i = SDLK_NEWLAST-1; i >= 0; --i )
    {
        // compare action
        uBind * old = keymap[i];
        if ( old && old->act == action )
        {
            uBindPlayer * oldPlayer = dynamic_cast< uBindPlayer * >( old );
            if ( oldPlayer && oldPlayer->ePlayer == player )
                return oldPlayer;
        }
    }

    // no alias found, return new bind
    return tNEW(uBindPlayer)( action, player );
}

bool uBindPlayer::IsKeyWord(const char *n){
    return !strcmp(n,Player_keyword);
}

bool uBindPlayer::CheckPlayer(int p){
    return p==ePlayer;
}

void uBindPlayer::Write(std::ostream &s){
    s << Player_keyword << '\t';
    uBind::Write(s);
    s << ePlayer;
}

bool uBindPlayer::Delayable()
{
    return ( ePlayer!=0 );
}

bool uBindPlayer::DoActivate(REAL x){
    bool ret = false;
    if (ePlayer==0)
        ret = GlobalAct(act,x);
    else
        ret = uPlayerPrototype::PlayerConfig(ePlayer-1)->Act(act,x);

    if( ret && act && act->GetTooltip() && x > 0 )
    {
        act->GetTooltip()->Count(ePlayer);
    }
    
    return ret;
}


// *****************
// Global actions
// *****************

static uActionGlobalFunc *uActionGlobal_anchor=NULL;

uActionGlobalFunc::uActionGlobalFunc(uActionGlobal *a, ACTION_FUNC *f,
                                     bool rebind )
        :tListItem<uActionGlobalFunc>(uActionGlobal_anchor), func (f), act(a),
rebindable(rebind){}

bool uActionGlobalFunc::IsBreakingGlobalBind(uAction *act){
    for(uActionGlobalFunc *run = uActionGlobal_anchor; run ; run = run->Next())
        if (run->act == act && !run->rebindable)
            return true;

    return false;
}

bool uActionGlobalFunc::GlobalAct(uAction *act, REAL x){
    for(uActionGlobalFunc *run = uActionGlobal_anchor; run ; run = run->Next())
        if (run->act == act && run->func(x))
            return true;

    return false;
}

static uActionGlobal mess_up("MESS_UP",1);

static uActionGlobal mess_down("MESS_DOWN",2);

static uActionGlobal mess_end("MESS_END",3);

static bool messup_func(REAL x){
    if (x>0){
        sr_con.Scroll(-1);
    }
    return true;
}

static bool messdown_func(REAL x){
    if (x>0){
        sr_con.Scroll(1);
    }
    return true;
}

static bool messend_func(REAL x){
    if (x>0){
        sr_con.End(2);
    }
    return true;
}

static uActionGlobalFunc mu(&mess_up,&messup_func);
static uActionGlobalFunc md(&mess_down,&messdown_func);
static uActionGlobalFunc me(&mess_end,&messend_func);

// ********
// tooltips
// ********

uActionTooltip::uActionTooltip( uAction & action, int numHelp, VETOFUNC * veto )
: tConfItemBase(action.internalName + "_TOOLTIP"), action_( action ), veto_(veto)
{
    help_ = tString("$input_") + action.internalName + "_tooltip";
    tToLower( help_ );

    // initialize array holding the number of help attempts to give left
    for( int i = uMAX_PLAYERS; i >= 0; --i )
    {
        activationsLeft_[i] = 0; // numHelp;
    }

    action.tooltip_ = this;
}

uActionTooltip::~uActionTooltip()
{
    if( action_.tooltip_ == this )
        action_.tooltip_ = NULL;
        
}

bool uActionTooltip::Help( int player )
{
    if(player < 0 || player > uMAX_PLAYERS)
        return false;

    // find most needed tooltip
    uActionTooltip * mostWanted{};

    // keys bound to the action of the tooltip that needs help
    tString maps;
    tString last;

    // run through binds
    for( int i = SDLK_NEWLAST - 1; i >= 0; --i )
    {
        uBind * bind = keymap[i];
        if( !bind ||!bind->CheckPlayer(player) )
            continue;
        uAction * action = bind->act;
        if( !action )
            continue;
        uActionTooltip * tooltip = action->GetTooltip();
        if( !tooltip || ( tooltip->veto_ && (*tooltip->veto_)(player) ) )
        {
            continue;
        }
        
        int activationsLeft = tooltip->activationsLeft_[player];
        if( activationsLeft > 0 && 
            ( !mostWanted || mostWanted->activationsLeft_[player] < activationsLeft ) )
        {
            mostWanted = tooltip;
            maps = "";
            last = "";
        }

        // build up key list
        if( mostWanted == tooltip )
        {
            if ( maps.Len() > 1 )
            {
                maps << ", ";
            }
            if ( last.Len() > 1 )
            {
                maps << last;
            }
            last = tString("<") + keyname(i) + ">";
        }
    }

    if( mostWanted )
    {
        // notice repeats, hint at how to silence them
        {
            static uActionTooltip * lastMostWanted{};
            static int identicalTooltipCount{};

            if(mostWanted == lastMostWanted)
            {
                identicalTooltipCount++;
                if(identicalTooltipCount >= 3)
                {
                    identicalTooltipCount-=2;
                    con.CenterDisplay(tString(tOutput("$tooltip_how_to_get_rid_of")));
                    return true;
                }
            }
            else
            {
                identicalTooltipCount = 0;
            }

            lastMostWanted = mostWanted;
        }


        if( last.Len() > 1 )
        {
            if( maps.Len() > 1 )
                maps << " " << tOutput("$input_or") << " " << last;
            else
                maps = last;
        }

        con.CenterDisplay(tString(tOutput(mostWanted->help_, maps)));

        return true;
    }

    return false;
}

void uActionTooltip::Disable(int player)
{
    if(player < 0 || player > uMAX_PLAYERS)
        return;

    // run through binds
    for( int i = SDLK_NEWLAST - 1; i >= 0; --i )
    {
        uBind * bind = keymap[i];
        if( !bind ||!bind->CheckPlayer(player) )
            continue;
        uAction * action = bind->act;
        if( !action )
            continue;
        uActionTooltip * tooltip = action->GetTooltip();
        if( !tooltip )
        {
            continue;
        }

        tooltip->activationsLeft_[player] = 0;
    }
}

void uActionTooltip::Count( int player )
{
    if ( activationsLeft_[player] > 0 )
    {
        activationsLeft_[player]--;
        Help(player);
    }
}

void uActionTooltip::WriteVal(std::ostream & s )
{
    for( int i = 0; i <= uMAX_PLAYERS; ++i )
    {
        s << activationsLeft_[i] << " ";
    }
}

void uActionTooltip::ReadVal(std::istream & s )
{
    for( int i = 0; i <= uMAX_PLAYERS; ++i )
    {
        s >> activationsLeft_[i];
    }
}
