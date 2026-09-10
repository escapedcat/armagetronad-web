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

    frame: function (type, handle, port, addr, payload) {
      var a = [];
      for (var i = 0; i < addr.length; i++) a.push(addr.charCodeAt(i) & 0x7f);
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
        AABridge.bound[handle] = 1;
        console.log('[BRIDGE] handle ' + handle + ' bound to udp port ' + port);
        return;
      }
      if (type === AABridge.TYPE.ERROR) {
        var reason = '';
        for (var j = 7 + addrLen; j < b.length; j++) reason += String.fromCharCode(b[j]);
        if (AABridge.bound[handle] === undefined) AABridge.bound[handle] = -1;
        console.log('[BRIDGE] error on handle ' + handle + ': ' + reason);
        return;
      }
      if (type === AABridge.TYPE.DATA) {
        if (!AABridge.queues[handle]) AABridge.queues[handle] = [];
        AABridge.queues[handle].push({ addr: addr, port: port, bytes: b.subarray(7 + addrLen) });
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
    if (AABridge.state !== 1) return;
    delete AABridge.bound[handle];
    AABridge.queues[handle] = [];
    AABridge.ws.send(AABridge.frame(AABridge.TYPE.BIND, handle, 0, '', null));
  },
  aa_bridge_bind__deps: ['$AABridge'],

  // 1 bound, -1 refused, 0 still waiting
  aa_bridge_bound: function (handle) {
    var v = AABridge.bound[handle];
    return v === undefined ? 0 : v;
  },
  aa_bridge_bound__deps: ['$AABridge'],

  aa_bridge_close: function (handle) {
    if (AABridge.state === 1) AABridge.ws.send(AABridge.frame(AABridge.TYPE.CLOSE, handle, 0, '', null));
    delete AABridge.queues[handle];
    delete AABridge.bound[handle];
  },
  aa_bridge_close__deps: ['$AABridge'],

  aa_bridge_send: function (handle, addrPtr, port, bufPtr, len) {
    if (AABridge.state !== 1) return -1;
    var addr = UTF8ToString(addrPtr);
    var payload = HEAPU8.subarray(bufPtr, bufPtr + len);
    AABridge.ws.send(AABridge.frame(AABridge.TYPE.DATA, handle, port, addr, payload));
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
