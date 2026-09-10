/*
Armagetron Advanced -- M-A: the browser end of the multiplayer bridge.
See eWebNet.h for why this file is in src/emscripten/ rather than src/network/.

THE ADDRESS MAP. nAddress stores a 32-bit IP and the game compares addresses
by value; a page cannot resolve a hostname to one. So every distinct host
string gets a stable synthetic address out of 10.42.0.0/16. Datagrams go out
carrying the ORIGINAL text, the relay resolves it and echoes the same text
back, and Recv maps that text to the same synthetic address -- so every
comparison inside the game holds, and no DNS ever happens in the page.
*/

#include "config.h"

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "eWebNet.h"
#include "nSocket.h"
#include "tConsole.h"
#include "tLocale.h"

#include <emscripten/emscripten.h>
#include <emscripten/console.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <errno.h>
#include <string.h>
#include <string>
#include <map>
#include <set>
#include <vector>

extern "C" {
    int  aa_bridge_enabled( void );
    int  aa_bridge_state( void );
    void aa_bridge_bind( int handle );
    int  aa_bridge_bound( int handle );
    void aa_bridge_close( int handle );
    int  aa_bridge_send( int handle, const char * addr, int port, const void * buf, int len );
    int  aa_bridge_recv( int handle, void * buf, int maxLen, char * addr, int addrMax, int * port );
    int  aa_bridge_pending( void );
}

namespace
{
// how long to wait for the WebSocket and for a BOUND, in 5 ms steps
const int sg_stepMs   = 5;
const int sg_timeoutMs = 5000;

int sg_nextHandle = 1;

// Synthetic addresses are numbered from their own counter, not from the map's
// size: literal peers are cached in the same maps and would otherwise leave
// gaps in the numbering.
unsigned int sg_nextFake = 1;

// synthetic address <-> host text
std::map< std::string, unsigned int > & HostToFake()
{
    static std::map< std::string, unsigned int > m;
    return m;
}
std::map< unsigned int, std::string > & FakeToHost()
{
    static std::map< unsigned int, std::string > m;
    return m;
}
}

namespace eWebNet
{

bool Enabled()
{
    return aa_bridge_enabled() != 0;
}

unsigned int FakeAddressFor( const char * host )
{
    std::string key( host ? host : "" );
    std::map< std::string, unsigned int >::iterator it = HostToFake().find( key );
    if ( it != HostToFake().end() )
        return it->second;

    // 10.42.<n>.<n>, starting at 10.42.0.1
    unsigned int index = sg_nextFake++;
    unsigned int ip = htonl( ( 10u << 24 ) | ( 42u << 16 ) | ( index & 0xffffu ) );
    HostToFake()[ key ] = ip;
    FakeToHost()[ ip ] = key;
    return ip;
}

void ReportNoBridge()
{
    const bool configured = Enabled();

    tOutput title, message;
    title   << "Network play unavailable";
    if ( configured )
        message << "The bridge on this page's ?bridge= address did not answer, "
                   "so there is no way to send UDP. Check that the relay is "
                   "running and reload. Single player is unaffected.";
    else
        message << "This page was loaded without a bridge, so there is no way "
                   "to send UDP from a browser. Reload with "
                   "?bridge=ws://host:port -- with a relay listening there -- "
                   "to play online. Single player is unaffected.";

    // TWO lines, on purpose. con << reaches the game's own on-screen console,
    // which is what the player can scroll back to. It does NOT reach the
    // browser's: rConsole::DoPrint forwards to stdout only in a DEBUG build or
    // when there is no screen, so a gate cannot see it. The
    // emscripten_console_log is the greppable half, and
    // web/tools/bridge-absent-gate.steps counts it.
    con << "Network menu refused: no working bridge on this page.\n";
    emscripten_console_log( configured
        ? "[BRIDGE] network menu refused: the ?bridge= relay did not answer"
        : "[BRIDGE] network menu refused: this page has no ?bridge=" );
    tConsole::Message( title, message, 20 );
}

hostent * FakeHostent( const char * host )
{
    // nAddress::SetHostname reads h_addr_list[0] as an int, so the address
    // needs int alignment; a char buffer would not do.
    static unsigned int sg_addr;
    static char * sg_addrList[ 2 ];
    static std::string sg_name;
    static hostent sg_entry;

    sg_addr = FakeAddressFor( host );
    sg_name = host ? host : "";
    sg_addrList[ 0 ] = reinterpret_cast< char * >( &sg_addr );
    sg_addrList[ 1 ] = 0;

    memset( &sg_entry, 0, sizeof( sg_entry ) );
    sg_entry.h_name      = const_cast< char * >( sg_name.c_str() );
    sg_entry.h_addrtype  = AF_INET;
    sg_entry.h_length    = sizeof( sg_addr );
    sg_entry.h_addr_list = sg_addrList;
    return &sg_entry;
}

namespace
{
//! open the WebSocket if it is not open yet and wait for it, in 5 ms steps.
//! Returns the final state: 1 open, 2 closed or failed, -1 not configured.
int WaitForOpen()
{
    int waited = 0;
    int state = aa_bridge_state();      // opens the socket on the first call
    while ( state == 0 && waited < sg_timeoutMs )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
        state = aa_bridge_state();
    }
    return state;
}
}

bool Ready()
{
    return Enabled() && WaitForOpen() == 1;
}

int Create()
{
    // ENETDOWN, not a stale errno. nSocket::Read, ::Write and ::Bind all feed
    // whatever is in errno to ANET_Error(), and three of the values it knows
    // (ENOTSOCK, ECONNRESET, EFAULT, and the EOPNOTSUPP group) map to
    // nSocketError_Reset -- on which nSocket::Bind THROWS
    // nSocket::PermanentError. That throw unwinds through sn_SetNetState(),
    // leaving its static reentry flag set, and the next attempt dies in
    // tERR_ERROR("Invalid peer!"). So every -1 out of this file sets an errno
    // deliberately, and picks one ANET_Error() maps to nSocketError_Ignore.
    if ( !Enabled() )
    {
        errno = ENETDOWN;
        return -1;
    }

    if ( WaitForOpen() != 1 )
    {
        errno = ENETDOWN;
        return -1;
    }

    return sg_nextHandle++;
}

int Bind( int handle, int & boundPort )
{
    boundPort = 0;
    aa_bridge_bind( handle );

    int waited = 0;
    int bound = aa_bridge_bound( handle );
    while ( bound == 0 && waited < sg_timeoutMs )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
        bound = aa_bridge_bound( handle );
    }
    if ( bound == 1 )
        return 0;

    // see the note in Create(): a stale errno here can reach
    // nSocket::Bind's ANET_Error() and turn a refused bind into a throw.
    errno = ENETDOWN;
    return -1;
}

void Close( int handle )
{
    aa_bridge_close( handle );
}

int Send( int handle, const void * buf, int len, const sockaddr * addr )
{
    const sockaddr_in * in = reinterpret_cast< const sockaddr_in * >( addr );
    unsigned int ip = in->sin_addr.s_addr;
    int port = ntohs( in->sin_port );

    std::map< unsigned int, std::string >::iterator it = FakeToHost().find( ip );
    std::string host;
    if ( it != FakeToHost().end() )
    {
        host = it->second;
    }
    else
    {
        // a literal address the game built itself: send it as dotted quad
        char buffer[ INET_ADDRSTRLEN ];
        struct in_addr a;
        a.s_addr = ip;
        host = inet_ntop( AF_INET, &a, buffer, sizeof( buffer ) ) ? buffer : "";
    }
    if ( host.empty() )
    {
        errno = EADDRNOTAVAIL;
        return -1;
    }

    int sent = aa_bridge_send( handle, host.c_str(), port, buf, len );
    if ( sent < 0 )
    {
        // The WebSocket is gone, or the address is too long for the wire
        // format. Either way nothing was sent and nothing will be; ENETDOWN
        // keeps nSocket::Write on its Ignore path instead of resetting the
        // socket. See the note in Create().
        errno = ENETDOWN;
        return -1;
    }
    return sent;
}

namespace
{
//! one line the first time a peer's address text is seen, because "addresses
//! travel as text" is the single most confusing thing about this design and
//! the mapping is otherwise invisible. Also what
//! web/tools/bridge-gate.steps asserts on.
void LogPeerOnce( const char * host, nAddress const & mapped, bool literal )
{
    static std::set< std::string > seen;
    if ( !seen.insert( std::string( host ) ).second )
        return;

    char buffer[ INET_ADDRSTRLEN ];
    struct in_addr a;
    a.s_addr = reinterpret_cast< const sockaddr_in * >(
                   static_cast< const sockaddr * >( mapped ) )->sin_addr.s_addr;
    const char * text = inet_ntop( AF_INET, &a, buffer, sizeof( buffer ) );

    std::string line( "[BRIDGE] peer " );
    line += host;
    line += " -> ";
    line += text ? text : "?";
    line += literal ? " (literal)" : " (synthetic)";
    emscripten_console_log( line.c_str() );
}
}

int Recv( int handle, void * buf, int len, nAddress & from )
{
    char host[ 256 ];
    int port = 0;
    int ret = aa_bridge_recv( handle, buf, len, host, sizeof( host ), &port );
    if ( ret < 0 )
    {
        // nothing queued. This is the errno nSocket::Read is built around:
        // ANET_Error() maps it to nSocketError_Ignore and Read returns -1.
        errno = EWOULDBLOCK;
        return -1;
    }

    // THE PEER'S TEXT IS MAPPED THE WAY THE GAME ITSELF MAPS ONE, and it has
    // to be, because the game then compares the result with an address it
    // built from the player's own input -- nAddress::Compare on
    // ( family, s_addr, port ) in nNetwork.cpp's
    // nAddress::Compare( addrFrom, peers[claim_id] ).
    //
    // Mapping everything through FakeAddressFor() was wrong and would have
    // failed on the first real connection. nAddress::SetHostname takes a
    // NUMERIC branch for anything starting with a digit -- PartialIPAddress,
    // no DNS, no map -- so a dotted quad the player typed is stored as the
    // real address, while the reply came back as a fresh synthetic 10.42.0.N
    // matching nothing. A logged-in client takes the sn_myNetID != 0 continue
    // and silently drops every packet from its own server.
    //
    // So: the digit test and PartialIPAddress, via nAddress::SetAddress,
    // which is that branch's body verbatim. Reusing the game's parser rather
    // than inet_pton also gets the PARTIAL forms right -- "127" is a legal
    // thing to type and PartialIPAddress fills in the rest, where inet_pton
    // would refuse it and drop us back to a synthetic address, i.e. straight
    // back into this bug for a narrower input.
    from = nAddress();                 // also resets addrLen_
    const bool literal = ( host[ 0 ] >= '0' && host[ 0 ] <= '9' );
    if ( literal )
    {
        from.SetAddress( host );
    }
    else
    {
        sockaddr_in * in = reinterpret_cast< sockaddr_in * >( static_cast< sockaddr * >( from ) );
        in->sin_family = AF_INET;
        in->sin_addr.s_addr = FakeAddressFor( host );
    }
    from.SetPort( port );

    LogPeerOnce( host, from, literal );
    return ret;
}

bool Poll( double seconds )
{
    int budget = static_cast< int >( seconds * 1000 );
    int waited = 0;
    while ( aa_bridge_pending() == 0 && waited < budget )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
    }
    return aa_bridge_pending() > 0;
}

}

#endif // __EMSCRIPTEN__ && !DEDICATED
