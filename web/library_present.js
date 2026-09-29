// Present only finished frames. Linked into the client with
// -sOFFSCREEN_FRAMEBUFFER=1 (web/Makefile); the dedicated server never sees it.
//
// THE SYMPTOM. On an Android phone in the Game Boy layout, walls flickered
// once a cycle had been grinding one for a while. A Mac showed nothing.
//
// THE CAUSE. This game's frames are not drawn in one piece. It is a desktop
// main loop that Asyncify pauses at every emscripten_sleep(), and several of
// those land INSIDE a frame (see the preserveDrawingBuffer note in
// web/shell.html). The browser may put the canvas on screen at any pause, so
// a frame caught half-drawn -- some walls painted, some not yet -- can reach
// the display. Phones are slow enough for that to happen; the heaviest frames,
// a cycle grinding a wall, make it most likely. Whether Chrome then shows it
// depends on its compositing path, which is why the ?diag=1 readout box hid
// it and why every attempt to reproduce that invisibly failed (#40 and #42,
// both reverted).
//
// THE FIX. Never draw into the canvas's own buffer during a frame.
// -sOFFSCREEN_FRAMEBUFFER=1 makes Emscripten's SDL 1.2 create the context with
// a hidden framebuffer and remap "bind the default framebuffer" to it, so the
// game draws there without knowing. What that flag does NOT do on this path is
// ever copy the hidden buffer to the canvas: SDL_GL_SwapBuffers only calls
// Browser.doSwapBuffers?.(), which nothing sets outside proxied builds, and the
// result would be a black screen. So this overrides SDL_GL_SwapBuffers -- the
// game's own end-of-frame call, reached once per frame from rSysDep::SwapGL --
// to copy the finished frame across with Emscripten's own
// GL.blitOffscreenFramebuffer. The copy is one synchronous step with no pause
// inside it, so the canvas only ever changes from one complete frame to the
// next. The canvas keeps preserveDrawingBuffer, so between copies it goes on
// showing the last complete frame whenever the browser composites.
//
// THE DEPTH BUFFER, OR THIS FIX WOULD CAUSE THE BUG IT FIXES. Emscripten gives
// the hidden framebuffer a 16-bit depth buffer (GL.createOffscreenFramebuffer:
// DEPTH_COMPONENT16, with a TODO). The canvas's own is 24-bit, and effectively
// 32-bit float on Apple Silicon. The game's near clipping plane falls to 0.0001
// as the camera nears the arena rim, and at 16 bits that is exactly where walls
// a fraction of a unit apart stop being told apart -- on every device. So on the
// first frame the depth attachment is replaced with a 24-bit one: DEPTH_STENCIL
// on WebGL 1 (24/8 in practice), DEPTH_COMPONENT24 on WebGL 2. If the driver
// refuses it, the 16-bit one goes back and the console says so.
//
// Resize: Emscripten's GL.resizeOffscreenFramebuffer would re-store the OLD
// depth target at 16 bits, not ours. The canvas is sized once before main() and
// never after (web/shell.html, sizeCanvas), so it never runs; if that ever
// changes, this has to change with it.
mergeInto(LibraryManager.library, {
  SDL_GL_SwapBuffers__deps: ['$GL'],
  SDL_GL_SwapBuffers: () => {
    var ctx = GL.currentContext;
    // No hidden framebuffer means the flag did not take; drawing is going to
    // the canvas as it always did, and there is nothing to copy.
    if (!ctx || !ctx.defaultFbo) return;
    if (!ctx.aaDepthChecked) {
      ctx.aaDepthChecked = true;
      var gl = ctx.GLctx;
      var prevFbo = gl.getParameter(0x8CA6 /*FRAMEBUFFER_BINDING*/);
      var prevRb = gl.getParameter(0x8CA7 /*RENDERBUFFER_BINDING*/);
      gl.bindFramebuffer(0x8D40 /*FRAMEBUFFER*/, ctx.defaultFbo);
      var rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(0x8D41 /*RENDERBUFFER*/, rb);
      var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      var gl2 = typeof WebGL2RenderingContext != 'undefined' && gl instanceof WebGL2RenderingContext;
      var what;
      if (gl2) {
        gl.renderbufferStorage(0x8D41, 0x81A6 /*DEPTH_COMPONENT24*/, w, h);
        gl.framebufferRenderbuffer(0x8D40, 0x8D00 /*DEPTH_ATTACHMENT*/, 0x8D41, rb);
        what = 'DEPTH_COMPONENT24';
      } else {
        gl.renderbufferStorage(0x8D41, 0x84F9 /*DEPTH_STENCIL*/, w, h);
        gl.framebufferRenderbuffer(0x8D40, 0x8D00 /*DEPTH_ATTACHMENT*/, 0x8D41, null);
        gl.framebufferRenderbuffer(0x8D40, 0x821A /*DEPTH_STENCIL_ATTACHMENT*/, 0x8D41, rb);
        what = 'DEPTH_STENCIL';
      }
      var status = gl.checkFramebufferStatus(0x8D40);
      if (status != 0x8CD5 /*FRAMEBUFFER_COMPLETE*/) {
        if (!gl2) gl.framebufferRenderbuffer(0x8D40, 0x821A, 0x8D41, null);
        gl.framebufferRenderbuffer(0x8D40, 0x8D00, 0x8D41, ctx.defaultDepthTarget);
        gl.deleteRenderbuffer(rb);
        console.log('[PRESENT] hidden framebuffer on, but the driver refused ' + what +
                    ' (status 0x' + status.toString(16) + '); keeping Emscripten\'s 16-bit depth');
      } else {
        console.log('[PRESENT] hidden framebuffer on: finished frames only, depth ' + what +
                    ' ' + w + 'x' + h + ' (depth bits ' + gl.getParameter(0x0D56 /*DEPTH_BITS*/) + ')');
      }
      gl.bindRenderbuffer(0x8D41, prevRb);
      gl.bindFramebuffer(0x8D40, prevFbo);
    }
    GL.blitOffscreenFramebuffer(ctx);
  },
});
