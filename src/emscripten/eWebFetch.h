#ifndef ArmageTron_eWebFetch_H
#define ArmageTron_eWebFetch_H

#include <ostream>

// Fetches uri through the relay's /resource route (web/library_resource.js,
// bridge/resource.mjs) and writes the body to o. Returns the HTTP status;
// 0 when nothing answered. Blocks (suspends under Asyncify) until done.
int eWebFetch( char const * uri, std::ostream & o );

#endif
