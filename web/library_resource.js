// Map downloads for the browser client: the page end of the relay's /resource
// route (bridge/resource.mjs says why the relay has to do the fetching).
//
// C++ calls aa_resource_fetch from tResourceManager::FetchURI, via
// src/emscripten/eWebFetch.cpp, and it SUSPENDS under Asyncify until the
// answer is in -- the same blocking shape as the nanoHTTP call it replaces,
// with the page staying responsive while it waits. It never calls C++ back.
mergeInto(LibraryManager.library, {
  $AAResource: {
    TIMEOUT_MS: 15000,   // longer than the relay's own 10 s upstream timeout
    // The relay serves /resource beside its WebSocket, so the route is the
    // bridge URL with an http scheme and /resource on the end of its path --
    // which keeps a token relay's /<token> prefix.
    endpoint: function (bridgeUrl) {
      if (!bridgeUrl) return null;
      var u;
      try { u = new URL(bridgeUrl); } catch (e) { return null; }
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      u.pathname = u.pathname.replace(/\/$/, '') + '/resource';
      u.search = '';
      u.hash = '';
      return u.href;
    },
  },

  // Returns the HTTP status, 0 when nothing answered. On 200, *outBuf is a
  // malloc'd copy of the body the caller frees; otherwise it is NULL.
  aa_resource_fetch__deps: ['$AABridge', '$AAResource', 'malloc'],
  aa_resource_fetch__async: true,
  aa_resource_fetch: function (uriPtr, outBufPtr, outLenPtr) {
    var uri = UTF8ToString(uriPtr);
    HEAP32[outBufPtr >> 2] = 0;
    HEAP32[outLenPtr >> 2] = 0;
    return Asyncify.handleAsync(async function () {
      var status = 0;
      var reason = '';
      var ep = AAResource.endpoint(AABridge.getUrl());
      if (ep) {
        var ctl = new AbortController();
        var timer = setTimeout(function () { ctl.abort(); }, AAResource.TIMEOUT_MS);
        try {
          var r = await fetch(ep + '?url=' + encodeURIComponent(uri), { signal: ctl.signal });
          status = r.status;
          if (status !== 200) {
            // The relay says WHY in a short text/plain body; the game can only
            // print the number, so the reason goes to the console.
            try { reason = (await r.text()).slice(0, 200); } catch (e) { reason = ''; }
          } else {
            var bytes = new Uint8Array(await r.arrayBuffer());
            var p = _malloc(bytes.length || 1);
            HEAPU8.set(bytes, p);           // HEAPU8 read AFTER malloc: it may grow memory
            HEAP32[outBufPtr >> 2] = p;
            HEAP32[outLenPtr >> 2] = bytes.length;
          }
        } catch (e) {
          status = 0;
        } finally {
          clearTimeout(timer);
        }
      }
      console.log('[RESOURCE] ' + status + ' ' + uri + (reason ? ' (' + reason + ')' : ''));
      return status;
    });
  },
});
