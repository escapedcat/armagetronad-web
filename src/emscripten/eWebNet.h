/*
Armagetron Advanced -- M-A: the browser end of the multiplayer bridge.

The game speaks UDP and a browser page cannot. This translation unit is the
seam: nSocket.cpp calls in here at its four syscall sites, and the functions
below hand the work to web/library_bridge.js, which owns the WebSocket.

WHY THIS FILE LIVES IN src/emscripten/ AND NOT src/network/. web/Makefile's
$(SRCS) wildcards every .cpp under src/network into BOTH the client and the
dedicated server, and the dedicated wasm is byte-pinned. A file there would
change the server's size even if its whole body were guarded away -- the
Makefile's own comment puts it exactly: an empty translation unit is not a
non-existent one.
Files named only in $(CLIENT_OBJS) cannot reach the server at all.
*/

#ifndef ArmageTron_eWebNet_H
#define ArmageTron_eWebNet_H

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

struct sockaddr;
struct hostent;
class nAddress;

namespace eWebNet
{
    //! true when the page was loaded with ?bridge=ws://...
    bool Enabled();

    //! allocate a handle and make sure the WebSocket is open. -1 on failure.
    int Create();

    //! BIND the handle and wait for BOUND. 0 on success, -1 on failure.
    //! boundPort receives the UDP port the relay is sending from.
    int Bind( int handle, int & boundPort );

    //! release the handle
    void Close( int handle );

    //! send one datagram. Returns len, or -1.
    int Send( int handle, const void * buf, int len, const sockaddr * addr );

    //! read one datagram. Returns bytes, or -1 with errno = EWOULDBLOCK when
    //! nothing is queued.
    int Recv( int handle, void * buf, int len, nAddress & from );

    //! yield to the browser for up to this many seconds, returning early as
    //! soon as a datagram is queued. Returns true if anything is queued.
    bool Poll( double seconds );

    //! a stable synthetic address in 10.42.0.0/16 for a host string, so that
    //! nAddress comparisons keep working without DNS in the page.
    unsigned int FakeAddressFor( const char * host );

    //! FakeAddressFor() wrapped in a hostent, so that nAddress::SetHostname
    //! can reach it through the AA_GETHOSTBYNAME macro in nSocket.h without a
    //! single line being inserted into nSocket.cpp above nAddress::SetAddress.
    //! That is not cosmetic: see the note on the macro for why a line added
    //! there moves the dedicated server's pinned bytes. The returned pointer
    //! is to static storage and is valid until the next call.
    hostent * FakeHostent( const char * host );
}

#endif // __EMSCRIPTEN__ && !DEDICATED
#endif // ArmageTron_eWebNet_H
