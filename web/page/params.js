// web/page/params.js -- THE PAGE'S URL PARAMETERS.
//
// Every ?name= the page reads for an experiment or a test (?dpr=, ?cam=,
// ?sparks=, ?wallcut=, ?leaveafter=). Nothing in the shipped flow sets any.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAParams = (function () {
  'use strict';

  // A numeric parameter. Out of [min, max] it is IGNORED rather than clamped,
  // because a typo that silently half-ran an experiment would be worse than
  // one that visibly did nothing: `ignored` is the log line saying so, under
  // the tag of the feature that reads it (e.g. '[CAMERA]').
  // search: location.search. Returns { value: number|null, ignored: string|null }.
  var number = function (search, tag, name, min, max) {
    var raw = new URLSearchParams(search).get(name);
    if (raw === null) return { value: null, ignored: null };
    var v = parseFloat(raw);
    if (!isFinite(v) || v < min || v > max) {
      return { value: null,
               ignored: tag + ' ?' + name + '=' + raw + ' ignored (want ' + min + '..' + max + ')' };
    }
    return { value: v, ignored: null };
  };

  return { number: number };
})();
