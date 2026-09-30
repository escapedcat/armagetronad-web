// Present only finished frames.
//
// WHY. The browser shows the canvas whenever the game hands it control, and
// this game hands it control in the MIDDLE of frames: Asyncify pauses land in
// network waits (tDelay in the server query loop, eWebNet::Poll under
// sn_Delay, the client's sync-ack wait) that run after the menu loop has
// cleared the canvas and before it has drawn anything. Measured 2026-09-30
// (docs/evidence/menu-flicker/): 144 of 729 frames black while the server
// browser scanned, 46 of 529 in the in-game menu while a server waited for
// players -- every one of them during such a pause. Some of those waits cannot
// be removed (the browser has to deliver the data they wait for), so the fix is
// to make any pause harmless: the game draws into a hidden framebuffer
// (-sOFFSCREEN_FRAMEBUFFER=1, see web/Makefile), and this swap copies a frame
// to the visible canvas only once it is finished. A pause anywhere now shows
// the last finished frame.
//
// WHAT #43 GOT WRONG, fixed here. The first version of this (PR #43, reverted
// by #44) squeezed the picture, for two reasons that are both in Emscripten's
// helper and neither in the idea:
//   1. GL.blitOffscreenFramebuffer draws its full-screen quad through whatever
//      viewport the game left set, and the game draws into sub-rectangle
//      viewports -- so the copy landed in a sub-rectangle. The copy here sets
//      a full-canvas viewport and restores the game's afterwards.
//   2. The hidden framebuffer is sized once, when the context is created, and
//      only emscripten_set_canvas_element_size resizes it -- which this game
//      never calls; the page and SDL_SetVideoMode set canvas.width/height
//      directly. fit() below follows the drawing buffer's size after every
//      copy, so the next frame is drawn at the canvas's real size.
//
// DEPTH. Emscripten's hidden framebuffer has a 16-bit depth buffer; the visible
// one it replaces is 24-bit. fit() attaches a 24-bit one (DEPTH_STENCIL on
// WebGL 1, whose depth is at least 24 bits in practice) and keeps it sized with
// the colour buffer, and falls back to Emscripten's own if the driver refuses.
mergeInto(LibraryManager.library, {
  $AAPresent: {
    // Size the hidden framebuffer (colour + depth) to the drawing buffer.
    // Cheap when nothing changed: two integer compares.
    fit: function (ctx) {
      var gl = ctx.GLctx;
      var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      if (ctx.aaW === w && ctx.aaH === h) return;
      var first = ctx.aaW === undefined;
      var was = first ? 'startup' : ctx.aaW + 'x' + ctx.aaH;
      ctx.aaW = w; ctx.aaH = h;
      var prevFbo = gl.getParameter(0x8CA6 /*FRAMEBUFFER_BINDING*/);
      var prevRb = gl.getParameter(0x8CA7 /*RENDERBUFFER_BINDING*/);
      // Colour texture (and Emscripten's own 16-bit depth) to w x h. At
      // startup they were created at the canvas size of that moment.
      GL.resizeOffscreenFramebuffer(ctx);
      gl.bindFramebuffer(0x8D40 /*FRAMEBUFFER*/, ctx.defaultFbo);
      var gl2 = typeof WebGL2RenderingContext != 'undefined' && gl instanceof WebGL2RenderingContext;
      if (!ctx.aaDepthRb && !ctx.aaDepthRefused) {
        var rb = gl.createRenderbuffer();
        var fmt = gl2 ? 0x81A6 /*DEPTH_COMPONENT24*/ : 0x84F9 /*DEPTH_STENCIL*/;
        var point = gl2 ? 0x8D00 /*DEPTH_ATTACHMENT*/ : 0x821A /*DEPTH_STENCIL_ATTACHMENT*/;
        gl.bindRenderbuffer(0x8D41 /*RENDERBUFFER*/, rb);
        gl.renderbufferStorage(0x8D41, fmt, w, h);
        if (!gl2) gl.framebufferRenderbuffer(0x8D40, 0x8D00 /*DEPTH_ATTACHMENT*/, 0x8D41, null);
        gl.framebufferRenderbuffer(0x8D40, point, 0x8D41, rb);
        var status = gl.checkFramebufferStatus(0x8D40);
        if (status == 0x8CD5 /*FRAMEBUFFER_COMPLETE*/) {
          ctx.aaDepthRb = rb; ctx.aaDepthFmt = fmt;
        } else {
          if (!gl2) gl.framebufferRenderbuffer(0x8D40, 0x821A, 0x8D41, null);
          gl.framebufferRenderbuffer(0x8D40, 0x8D00, 0x8D41, ctx.defaultDepthTarget);
          gl.deleteRenderbuffer(rb);
          ctx.aaDepthRefused = true;
          console.log('[PRESENT] the driver refused a 24-bit depth buffer (status 0x' +
                      status.toString(16) + '); keeping Emscripten\'s 16-bit one');
        }
      } else if (ctx.aaDepthRb) {
        gl.bindRenderbuffer(0x8D41, ctx.aaDepthRb);
        gl.renderbufferStorage(0x8D41, ctx.aaDepthFmt, w, h);
      }
      console.log('[PRESENT] hidden framebuffer ' + was + ' -> ' + w + 'x' + h +
                  ', depth bits ' + gl.getParameter(0x0D56 /*DEPTH_BITS*/));
      gl.bindRenderbuffer(0x8D41, prevRb);
      gl.bindFramebuffer(0x8D40, prevFbo);
    },
  },

  SDL_GL_SwapBuffers__deps: ['$GL', '$AAPresent'],
  SDL_GL_SwapBuffers: () => {
    var ctx = GL.currentContext;
    if (!ctx || !ctx.defaultFbo) return;
    var gl = ctx.GLctx;
    // The copy uses the whole canvas, whatever viewport the game left set.
    var vp = gl.getParameter(0x0BA2 /*VIEWPORT*/);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    GL.blitOffscreenFramebuffer(ctx);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    window.AA_PRESENTED = (window.AA_PRESENTED | 0) + 1;
    // Follow the canvas size for the NEXT frame.
    AAPresent.fit(ctx);
  },
});
