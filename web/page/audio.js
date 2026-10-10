// web/page/audio.js -- SOUND ON A PHONE: RESUME ON THE GESTURE THAT COUNTS.
//
// The maintainer's phone played in silence for 3-7 minutes before the sound
// came on. Emscripten's $autoResumeAudioContext (libcore.js) calls
// ctx.resume() ONCE, on the first keydown, mousedown or touchstart. On a phone
// none of those is a user gesture when it arrives: the pad's keys are
// synthetic, the pad's preventDefault suppresses mousedown, and Chrome grants
// activation on pointerup/touchend, not touchstart. So the one resume() is
// refused and never retried. Measured (headless Chrome, --mobile 412,915,3,
// --autoplay-policy=document-user-activation-required): three pad taps,
// activation 'sticky' from the first pointerup, AudioContext still
// 'suspended' at the end.
//
// So: on every TRUSTED pointerup, touchend, click or keydown, resume the
// context if it is not running -- not once, every time, which also brings it
// back after the phone interrupted it (a call, the app backgrounded). The page
// listens in the capture phase on window, so no element's handler can hide it.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAAudio = (function () {
  'use strict';

  var GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];

  // env.context(): the game's AudioContext, or null before SDL opens audio.
  // env.log(line). env.resumed(): counts a resume (for the gates); returns
  // how many there were before this one.
  var resumer = function (env) {
    return function (ev) {
      if (!ev.isTrusted) return;
      var ctx = env.context();
      if (!ctx || ctx.state === 'running') return;
      ctx.resume().then(function () {
        if (env.resumed() === 0) env.log('[AUDIO] resumed on ' + ev.type);
      }, function () { /* refused; the next gesture tries again */ });
    };
  };

  return { GESTURES: GESTURES, resumer: resumer };
})();
