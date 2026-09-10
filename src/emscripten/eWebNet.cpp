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

#include <emscripten/emscripten.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <errno.h>
#include <string.h>
#include <string>
#include <map>
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
    unsigned int index = static_cast< unsigned int >( HostToFake().size() ) + 1;
    unsigned int ip = htonl( ( 10u << 24 ) | ( 42u << 16 ) | ( index & 0xffffu ) );
    HostToFake()[ key ] = ip;
    FakeToHost()[ ip ] = key;
    return ip;
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

int Create()
{
    if ( !Enabled() )
        return -1;

    // aa_bridge_state() opens the socket on first call
    int waited = 0;
    int state = aa_bridge_state();
    while ( state == 0 && waited < sg_timeoutMs )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
        state = aa_bridge_state();
    }
    if ( state != 1 )
        return -1;

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
    return bound == 1 ? 0 : -1;
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
        return -1;

    return aa_bridge_send( handle, host.c_str(), port, buf, len );
}

int Recv( int handle, void * buf, int len, nAddress & from )
{
    char host[ 256 ];
    int port = 0;
    int ret = aa_bridge_recv( handle, buf, len, host, sizeof( host ), &port );
    if ( ret < 0 )
    {
        errno = EWOULDBLOCK;
        return -1;
    }

    sockaddr_in * in = reinterpret_cast< sockaddr_in * >( static_cast< sockaddr * >( from ) );
    memset( in, 0, sizeof( sockaddr_in ) );
    in->sin_family = AF_INET;
    in->sin_port = htons( static_cast< unsigned short >( port ) );
    in->sin_addr.s_addr = FakeAddressFor( host );
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
