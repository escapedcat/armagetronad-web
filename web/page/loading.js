// web/page/loading.js -- THE LOADING BAR'S NUMBERS.
//
// The game is two big downloads: armagetronad.wasm (~4.3 MB) and the
// armagetronad.data package (~0.7 MB). Emscripten reports only the second, and
// takes its total from Content-Length, which on a gzipping server (GitHub
// Pages) is the COMPRESSED size while it counts uncompressed bytes. So the bar
// used to be full after half of the small file, and a slow phone then sat on a
// full bar for most of the load.
//
// This module counts both files as they stream in, against their real sizes,
// which web/tools/stamp-sizes.mjs writes into the built page. It wraps
// win.fetch for those two names only and hands back a Response with the same
// status and headers, so WebAssembly.instantiateStreaming and the file
// packager read the same bytes they always did. Anything else it cannot do (no
// fetch, no streams) leaves the page loading as before, without numbers.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AALoading = (function () {
  'use strict';

  var FILES = ['armagetronad.wasm', 'armagetronad.data'];

  var fileOf = function (input) {
    var url = String(input && input.url !== undefined ? input.url : input);
    var name = url.split('?')[0].split('#')[0].split('/').pop();
    return FILES.indexOf(name) >= 0 ? name : null;
  };

  // env: { win (window), sizes ({ file: bytes }, or the unstamped string), onProgress(loaded,
  // total, done) }. total is 0 when the build stamped no sizes; done is true
  // once both files have arrived in full.
  var watch = function (env) {
    var win = env.win;
    if (typeof win.fetch !== 'function' || !win.Response || !win.ReadableStream) return;
    // The page passes the stamp's placeholder through untouched; still a
    // string means this build was not stamped.
    var sizes = env.sizes && typeof env.sizes === 'object' ? env.sizes : null;
    var total = 0, loaded = {}, finished = {};
    FILES.forEach(function (f) { loaded[f] = 0; if (sizes) total += sizes[f] || 0; });
    var report = function () {
      var sum = 0;
      FILES.forEach(function (f) { sum += sizes ? Math.min(loaded[f], sizes[f] || 0) : 0; });
      var done = FILES.every(function (f) { return finished[f]; });
      env.onProgress(sum, total, done);
    };

    var fetch = win.fetch;
    win.fetch = function (input, init) {
      var file = fileOf(input);
      var call = fetch.apply(this, arguments);
      if (!file) return call;
      return call.then(function (res) {
        if (!res.ok || !res.body) return res;
        var reader = res.body.getReader();
        var body = new win.ReadableStream({
          pull: function (c) {
            return reader.read().then(function (r) {
              if (r.done) {
                finished[file] = true;
                if (sizes) loaded[file] = sizes[file] || 0;
                report();
                c.close();
                return;
              }
              loaded[file] += r.value.byteLength;
              report();
              c.enqueue(r.value);
            }, function (err) { c.error(err); });
          },
          cancel: function (why) { return reader.cancel(why); },
        }, { highWaterMark: 0 });   // read only when the loader asks: count what it has
        return new win.Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      });
    };
    report();
  };

  return { FILES: FILES, watch: watch };
})();
