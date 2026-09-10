// The browser end of the bridge. C++ calls these; they never call C++ back.
//
// THE RULE THIS FILE EXISTS TO KEEP: onmessage only ENQUEUES. The client runs
// under Asyncify, which suspends and resumes the C++ stack; calling into C++
// from a WebSocket event during an unwind corrupts the rewind, and the symptom
// is a random crash rather than a network error. So messages land in a queue
// and C++ drains it from its own stack, in eWebNet::Recv.
mergeInto(LibraryManager.library, {
  $AABridge: {
    ws: null,
    state: 0,            // 0 connecting, 1 open, 2 closed or failed
    queues: {},          // handle -> array of {addr, port, bytes}
    bound: {},           // handle -> 1 bound, -1 refused, undefined pending
    binding: {},         // handle -> 1 while a BIND is outstanding
    sentSinceBind: {},   // handle -> DATA frames sent since that BIND
    dataErrors: 0,       // ERROR frames that answered a datagram, not a BIND
    lastDataError: null,
    dropped: 0,          // DATA frames for a handle with no live queue
    sendFailures: 0,     // ws.send() calls that threw
    MAX_ADDR: 255,       // one byte of address length on the wire
    url: null,
    urlChecked: false,
    VERSION: 1,
    TYPE: { BIND: 1, BOUND: 2, DATA: 3, CLOSE: 4, ERROR: 5 },

    getUrl: function () {
      if (!AABridge.urlChecked) {
        AABridge.urlChecked = true;
        try {
          var v = new URLSearchParams(location.search).get('bridge');
          AABridge.url = (v && /^wss?:\/\//.test(v)) ? v : null;
        } catch (e) { AABridge.url = null; }
      }
      return AABridge.url;
    },

    // THE ONLY PLACE ws.send IS CALLED. AABridge.state does not reach 2 until
    // onclose fires, so a socket in CLOSING state still looks open here and
    // send() throws InvalidStateError -- out of a JS library function, into
    // wasm, mid-Asyncify. Nothing in this file may throw at C++, so the throw
    // is caught, the socket is marked dead, and the caller gets false.
    send: function (bytes) {
      try {
        AABridge.ws.send(bytes);
        return true;
      } catch (e) {
        AABridge.state = 2;
        AABridge.sendFailures++;
        console.log('[BRIDGE] send failed: ' + e);
        return false;
      }
    },

    frame: function (type, handle, port, addr, payload) {
      // & 0xff, NOT & 0x7f: bridge/frame.mjs writes the address with
      // Buffer.from(addr, 'ascii'), and Node's 'ascii' encoding is latin1
      // with no masking of the high bit (measured: 'e-acute' stays 233, where
      // & 0x7f would have made it 105). The two ends have to agree.
      var a = [];
      for (var i = 0; i < addr.length; i++) a.push(addr.charCodeAt(i) & 0xff);
      var out = new Uint8Array(7 + a.length + (payload ? payload.length : 0));
      out[0] = AABridge.VERSION;
      out[1] = type;
      out[2] = (handle >> 8) & 0xff; out[3] = handle & 0xff;
      out[4] = (port >> 8) & 0xff;   out[5] = port & 0xff;
      out[6] = a.length;
      out.set(a, 7);
      if (payload) out.set(payload, 7 + a.length);
      return out;
    },

    onmessage: function (ev) {
      var b = new Uint8Array(ev.data);
      if (b.length < 7 || b[0] !== AABridge.VERSION) return;
      var type = b[1];
      var handle = (b[2] << 8) | b[3];
      var port = (b[4] << 8) | b[5];
      var addrLen = b[6];
      if (b.length < 7 + addrLen) return;
      var addr = '';
      for (var i = 0; i < addrLen; i++) addr += String.fromCharCode(b[7 + i]);
      if (type === AABridge.TYPE.BOUND) {
        delete AABridge.binding[handle];
        AABridge.bound[handle] = 1;
        console.log('[BRIDGE] handle ' + handle + ' bound to udp port ' + port);
        return;
      }
      if (type === AABridge.TYPE.ERROR) {
        var reason = '';
        for (var j = 7 + addrLen; j < b.length; j++) reason += String.fromCharCode(b[j]);
        // WHICH ERRORS ANSWER A BIND, AND WHY THE TEST IS STATE AND NOT TEXT.
        // bridge/relay.mjs emits ERROR from four places: a BIND naming a handle
        // it already holds, and three DATA failures -- handle not bound, cannot
        // resolve, destination refused by policy. The frame carries no request
        // id and the wire format is committed, so the only discriminator
        // available here is our own state: while a BIND is outstanding on this
        // handle and no DATA has been sent on it since, an ERROR naming it can
        // only be the relay answering that BIND.
        //
        // Anything else is a datagram error and must NOT touch bound[handle].
        // The old code wrote -1 whenever the entry was undefined, which is
        // exactly the state a BIND in flight is in -- so a refused datagram
        // could fail an unrelated bind, and an ERROR arriving after a close
        // could resurrect a stale entry for a dead handle.
        if (AABridge.binding[handle] && !AABridge.sentSinceBind[handle]) {
          delete AABridge.binding[handle];
          AABridge.bound[handle] = -1;
          console.log('[BRIDGE] bind refused on handle ' + handle + ': ' + reason);
        } else {
          AABridge.dataErrors++;
          AABridge.lastDataError = reason;
          console.log('[BRIDGE] error on handle ' + handle + ': ' + reason);
        }
        return;
      }
      if (type === AABridge.TYPE.DATA) {
        // A handle aa_bridge_close deleted is gone, and re-creating its queue
        // here would leave one that nothing ever drains: aa_bridge_pending()
        // sums EVERY queue, so eWebNet::Poll would return true without ever
        // yielding, nBasicNetworkSystem::Select would report data-ready on
        // every call, and the game loop would hot-spin while nSocket::Read
        // returns EWOULDBLOCK -- with the queue growing without bound.
        // Reachable: the client recycles handles (1 then 2) whenever
        // sn_SetNetState cycles, and a datagram for the old one can still be
        // in flight. Only aa_bridge_bind creates a queue.
        var q = AABridge.queues[handle];
        if (!q) {
          AABridge.dropped++;
          return;
        }
        q.push({ addr: addr, port: port, bytes: b.subarray(7 + addrLen) });
      }
    },
  },

  aa_bridge_enabled: function () {
    return AABridge.getUrl() ? 1 : 0;
  },
  aa_bridge_enabled__deps: ['$AABridge'],

  // 0 connecting, 1 open, 2 closed or failed, -1 not configured
  aa_bridge_state: function () {
    var url = AABridge.getUrl();
    if (!url) return -1;
    if (!AABridge.ws) {
      try {
        AABridge.ws = new WebSocket(url);
        AABridge.ws.binaryType = 'arraybuffer';
        AABridge.state = 0;
        AABridge.ws.onopen = function () { AABridge.state = 1; console.log('[BRIDGE] open ' + url); };
        AABridge.ws.onclose = function () { AABridge.state = 2; console.log('[BRIDGE] closed'); };
        AABridge.ws.onerror = function () { AABridge.state = 2; console.log('[BRIDGE] error'); };
        AABridge.ws.onmessage = AABridge.onmessage;
      } catch (e) {
        AABridge.state = 2;
        console.log('[BRIDGE] cannot open ' + url + ': ' + e);
      }
    }
    return AABridge.state;
  },
  aa_bridge_state__deps: ['$AABridge'],

  aa_bridge_bind: function (handle) {
    delete AABridge.bound[handle];
    AABridge.queues[handle] = [];
    AABridge.sentSinceBind[handle] = 0;
    if (AABridge.state !== 1) {
      // No socket to send the BIND on, so the bind has already failed. Saying
      // so now rather than staying silent saves eWebNet::Bind five seconds of
      // emscripten_sleep() -- five seconds during which the game is frozen.
      AABridge.bound[handle] = -1;
      return;
    }
    if (!AABridge.send(AABridge.frame(AABridge.TYPE.BIND, handle, 0, '', null))) {
      AABridge.bound[handle] = -1;
      return;
    }
    AABridge.binding[handle] = 1;
  },
  aa_bridge_bind__deps: ['$AABridge'],

  // 1 bound, -1 refused, 0 still waiting
  aa_bridge_bound: function (handle) {
    var v = AABridge.bound[handle];
    return v === undefined ? 0 : v;
  },
  aa_bridge_bound__deps: ['$AABridge'],

  aa_bridge_close: function (handle) {
    if (AABridge.state === 1) AABridge.send(AABridge.frame(AABridge.TYPE.CLOSE, handle, 0, '', null));
    delete AABridge.queues[handle];
    delete AABridge.bound[handle];
    delete AABridge.binding[handle];
    delete AABridge.sentSinceBind[handle];
  },
  aa_bridge_close__deps: ['$AABridge'],

  aa_bridge_send: function (handle, addrPtr, port, bufPtr, len) {
    if (AABridge.state !== 1) return -1;
    var addr = UTF8ToString(addrPtr);
    // Refused rather than truncated, the way bridge/frame.mjs refuses it:
    // the length goes on the wire in ONE byte, so 256 characters would wrap
    // to 0 and shift the payload offset, and the relay would read the
    // datagram as part of the address. FakeAddressFor keys on whatever text
    // Custom Connect was given, so this is reachable input, not a theory.
    if (addr.length > AABridge.MAX_ADDR) {
      console.log('[BRIDGE] address too long, ' + addr.length + ' > ' + AABridge.MAX_ADDR + ' bytes: not sent');
      return -1;
    }
    var payload = HEAPU8.subarray(bufPtr, bufPtr + len);
    // counted so that an ERROR provoked by this datagram cannot be mistaken
    // for the answer to a BIND -- see onmessage
    AABridge.sentSinceBind[handle] = (AABridge.sentSinceBind[handle] || 0) + 1;
    if (!AABridge.send(AABridge.frame(AABridge.TYPE.DATA, handle, port, addr, payload))) return -1;
    return len;
  },
  aa_bridge_send__deps: ['$AABridge'],

  // Returns bytes written, or -1 when the queue is empty.
  aa_bridge_recv: function (handle, bufPtr, maxLen, addrPtr, addrMax, portPtr) {
    var q = AABridge.queues[handle];
    if (!q || q.length === 0) return -1;
    var m = q.shift();
    var n = Math.min(m.bytes.length, maxLen);
    HEAPU8.set(m.bytes.subarray(0, n), bufPtr);
    stringToUTF8(m.addr, addrPtr, addrMax);
    HEAP32[portPtr >> 2] = m.port;
    return n;
  },
  aa_bridge_recv__deps: ['$AABridge'],

  aa_bridge_pending: function () {
    var n = 0;
    for (var h in AABridge.queues) n += AABridge.queues[h].length;
    return n;
  },
  aa_bridge_pending__deps: ['$AABridge'],
});
