/*
Armagetron Advanced -- text from a phone: the player's name and chat lines.

WHY THIS EXISTS. A phone only shows its keyboard for a real text box, and the
game draws everything into one canvas. So web/shell.html shows HTML inputs (a
name dialog, a chat bar) and hands their text to the game here.

WHY A POLL, NOT A CALL. The page's handlers run in browser events, and the game
may be suspended in an Asyncify sleep at that moment; calling into it with a
string would allocate on a stack that is not ours to touch. So the page only
parks the text in a JS slot (window.AA_TEXT_PEEK / AA_TEXT_TAKE), and this
per-frame task -- on the game's own stack, from rSysDep::SwapGL -- pulls it out
through EM_JS and acts on it. The same pattern as eWebLeave.cpp.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "ePlayer.h"
#include "nNetwork.h"
#include "rScreen.h"
#include "tString.h"

#include <emscripten/emscripten.h>

extern "C" void aa_web_save_config( void ); // src/emscripten/eWebPersist.cpp

// kind 1 = name, 2 = chat. Non-zero when text of that kind is waiting.
EM_JS( int, aa_js_text_pending, ( int kind ), {
    var t = ( typeof window !== 'undefined' && window.AA_TEXT_PEEK ) ? window.AA_TEXT_PEEK( kind ) : null;
    return t ? 1 : 0;
});

// Consumes the waiting text of that kind into buf as latin-1 -- characters
// above U+00FF become '?' -- NUL-terminated, at most cap-1 bytes. Returns the
// number of bytes written.
EM_JS( int, aa_js_text_take, ( int kind, char * buf, int cap ), {
    var t = window.AA_TEXT_TAKE( kind ) || '';
    var n = Math.min( t.length, cap - 1 );
    for ( var i = 0; i < n; i++ ) { var c = t.charCodeAt( i ); HEAPU8[ buf + i ] = c <= 255 ? c : 63; }
    HEAPU8[ buf + n ] = 0;
    return n;
});

static tString sg_TakeText( int kind, int cap )
{
    char buf[ 128 ];
    if ( cap > static_cast< int >( sizeof( buf ) ) )
        cap = sizeof( buf );
    aa_js_text_take( kind, buf, cap );
    // trim what the latin-1 cut or the page may have left at the ends
    tString s( buf );
    return s;
}

static bool sg_Blank( tString const & s )
{
    for ( int i = 0; i < s.Len() - 1; ++i )
        if ( s[i] != ' ' )
            return false;
    return true;
}

static void sg_ApplyName( tString const & name )
{
    ePlayer * p = ePlayer::PlayerConfig( 0 );
    if ( !p || sg_Blank( name ) )
        return;
    p->name = name;
    ePlayerNetID::Update();
    aa_web_save_config();
    emscripten_log( EM_LOG_CONSOLE, "[TEXT] name set to %s", static_cast< char const * >( name ) );
}

static void sg_SendChat( tString const & say )
{
    if ( sg_Blank( say ) )
        return;
    if ( sn_GetNetState() != nCLIENT )
    {
        emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat dropped: not connected" );
        return;
    }
    ePlayer * p = ePlayer::PlayerConfig( 0 );
    ePlayerNetID * net = p ? static_cast< ePlayerNetID * >( p->netPlayer ) : 0;
    if ( !net )
    {
        emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat dropped: no player on the server" );
        return;
    }
    net->Chat( say );
    emscripten_log( EM_LOG_CONSOLE, "[TEXT] chat sent (%d bytes)", say.Len() - 1 );
}

static void sg_TextPerFrame()
{
    if ( aa_js_text_pending( 1 ) )
        sg_ApplyName( sg_TakeText( 1, 17 ) );    // 16 characters + NUL
    if ( aa_js_text_pending( 2 ) )
        sg_SendChat( sg_TakeText( 2, 121 ) );    // 120 characters + NUL
}

static rPerFrameTask sg_textTask( &sg_TextPerFrame );

#endif
