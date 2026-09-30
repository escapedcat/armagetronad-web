/*
Armagetron Advanced -- map downloads in the browser client.

WHY THIS EXISTS. tResourceManager::FetchURI downloads a map the client lacks
with libxml2's nanoHTTP, which opens a TCP socket to the repository. A page
has no TCP: Emscripten's socket emulation turns that connect() into a ws://
dial the resource server does not speak (and an https page may not make), so
no status line ever arrives and the player sees "Return value 0 != 200". This
file hands the request to web/library_resource.js, which asks the relay.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard below is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "eWebFetch.h"

#include <stdlib.h>

extern "C" int aa_resource_fetch( const char * uri, void ** outBuf, int * outLen );

int eWebFetch( char const * uri, std::ostream & o )
{
    void * buf = NULL;
    int len = 0;
    int status = aa_resource_fetch( uri, &buf, &len );
    if ( status == 200 && buf )
        o.write( static_cast< char const * >( buf ), len );
    free( buf );
    return status;
}

#endif
