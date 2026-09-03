#!/usr/bin/env node
// Build web/dist-m1/texprobe.html -- the shipped page plus one injected
// <script> that instruments the WebGL context.
//
//   make -f web/Makefile client -j8          # or use an existing dist-m1
//   node docs/evidence/m5-texture/make-texprobe-page.mjs
//   python3 -m http.server 8000 --directory web/dist-m1 &
//   node web/tools/drive-browser.mjs --headed --out docs/evidence/m5-texture/run \
//        --url http://localhost:8000/texprobe.html \
//        --script-file web/tools/texture-probe.steps
//
// ====================== WHY A PAGE AND NOT A REBUILD =======================
//
// Same reason docs/evidence/m5-startup/make-resolution-pages.mjs is a page:
// the quantity under measurement is what the RUNNING GAME asks WebGL for, and
// a rebuild would vary the binary as well. texprobe.html loads the SAME
// armagetronad.js / .wasm / .data by relative <script src> and fetch -- none of
// them is copied or edited -- so every number this records is a number the
// shipped client produced. Verified before the run: the four artefacts in
// web/dist-m1 are md5-identical to the four served from
// https://escapedcat.github.io/armagetronad-web/.
//
// The injection point is <body>, for the reason make-resolution-pages.mjs
// gives: -O2 minifies the shell into the HTML, so nothing in it can be matched
// on its readable form, and <body> is the one anchor that is structure rather
// than content. It must come before the shell's own inline <script>, and it
// must come before ANY canvas.getContext call -- the whole probe hangs off
// hooking HTMLCanvasElement.prototype.getContext, and a context created before
// the hook installs would be invisible to it. The wasm has not even been
// fetched at this point, so that ordering is not tight.
//
// ====================== WHAT IT RECORDS AND WHY EACH ========================
//
// The brief asks for state AT DRAW TIME, not state the source intends. Every
// number below is read back out of the live context with getParameter /
// getTexParameter / getContextAttributes; nothing is inferred from the C++.
//
//  ctx      -- VENDOR/RENDERER/VERSION exactly as the C++ sees them.
//              Emscripten's _glGetString (armagetronad.js) forwards GL_VENDOR
//              (7936) and GL_RENDERER (7937) to GLctx.getParameter verbatim, so
//              gl_vendor in rScreen.cpp IS this string. That settles
//              rScreen.cpp's strstr(gl_vendor,"ATI") downgrade by measurement.
//              Also the unmasked pair from WEBGL_debug_renderer_info, the
//              context attributes actually granted (antialias is the one that
//              matters for edge quality), SAMPLES/SAMPLE_BUFFERS, and the
//              drawing buffer size, which is the resolution the game renders at.
//
//  aniso    -- whether EXT_texture_filter_anisotropic is in
//              getSupportedExtensions(), and MAX_TEXTURE_MAX_ANISOTROPY_EXT
//              (0x84FF) if it is. This is the brief's live hypothesis.
//
//  tex[]    -- one entry per WebGLTexture, built from hooked texImage2D
//              (dimensions, format, type, and a cheap pixel fingerprint that
//              tells four differently-coloured copies of the same PNG apart),
//              generateMipmap (did a chain get built) and texParameteri (what
//              was ASKED for).
//
//  draw{}   -- for each texture, the state READ BACK off the context at the
//              moment it was bound for a draw call: MIN_FILTER, MAG_FILTER,
//              WRAP_S, WRAP_T and TEXTURE_MAX_ANISOTROPY_EXT. Sampled once per
//              texture per 5 s epoch rather than per draw, because
//              getTexParameter is a synchronous round trip and doing it on
//              every draw would depress the thing it is watching. Re-sampling
//              per epoch is what catches a filter that CHANGES mid-run
//              (rITexture::OnSelect re-issues the parameters whenever
//              rTextureGroups::TextureMode[] moves under it).
//
//  dump(id) -- reads level 0 of a texture back through a framebuffer and
//              returns it as a PNG data URL, so "which texture is the cycle
//              body" is answered by LOOKING at it rather than by argument from
//              dimensions. WebGL 1 only allows level 0 as a colour attachment,
//              so this cannot show a mip level; mipLevels() below is what
//              answers that question instead.
//
//  mipLevels(id) -- the direct test for "does a complete mip chain exist and
//              get used", which glGenerateMipmap returning without error does
//              NOT establish. It draws the texture into a 1x1 framebuffer at a
//              minification ratio that forces the smallest level, with the same
//              min filter the game left on it. A texture whose chain is missing
//              or incomplete is INCOMPLETE under a mipmapped min filter and
//              samples as opaque black (0,0,0,255); a complete chain samples as
//              the image's average colour. It reports both that pixel and, as
//              its own control, the same draw with the min filter forced to
//              LINEAR, which never consults a mip level at all.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIST = join(ROOT, 'web', 'dist-m1');
const SRC = join(DIST, 'armagetronad.html');

const PROBE = `
window.AA_GLPROBE = { tex: [], byId: new Map(), draw: {}, ctx: null, errors: [] };
(function () {
  try {
    var P = window.AA_GLPROBE;
    var nextId = 1;

    function rec(t) {
      if (!t) return null;
      if (t.__aaid === undefined) {
        t.__aaid = nextId++;
        var e = { id: t.__aaid, uploads: [], mipmapCalls: 0, asked: {} };
        P.tex.push(e);
        P.byId.set(t.__aaid, e);
      }
      return P.byId.get(t.__aaid);
    }

    function bound(gl) { return gl.__aaBound2D || null; }

    var proto = WebGLRenderingContext.prototype;

    // ONE hook, and it does two jobs: it tracks what is bound to TEXTURE_2D so
    // every other hook below knows which texture it is looking at, and it keeps
    // a handle on the WebGLTexture object itself so dump()/mipLevels() can
    // rebind it later. WebGL has no way to enumerate texture objects and
    // Emscripten's GL.textures table is module-private, so without this handle
    // a texture seen at draw time could not be revisited afterwards.
    var oBind = proto.bindTexture;
    proto.bindTexture = function (target, tex) {
      if (target === 3553 /* TEXTURE_2D */) {
        this.__aaBound2D = tex;
        try { if (tex) { var e = rec(tex); if (e) e.obj = tex; } } catch (err) {}
      }
      return oBind.apply(this, arguments);
    };

    var oImg = proto.texImage2D;
    proto.texImage2D = function (target, level, internalformat, w, h, border, format, type, pixels) {
      var r = oImg.apply(this, arguments);
      try {
        if (target === 3553 && arguments.length >= 9) {
          var e = rec(bound(this));
          if (e) {
            var sum = 0, n = 0, head = [];
            if (pixels && pixels.length) {
              for (var i = 0; i < pixels.length; i += 1021) { sum = (sum + pixels[i]) >>> 0; n++; }
              for (var j = 0; j < 24 && j < pixels.length; j++) head.push(pixels[j]);
            }
            e.uploads.push({ level: level, w: w, h: h, internalformat: internalformat,
                             format: format, type: type,
                             bytes: pixels ? pixels.length : 0, fp: sum, head: head.join(',') });
            if (level === 0) { e.w = w; e.h = h; e.format = format; e.type = type; e.fp = sum; }
          }
        }
      } catch (err) { P.errors.push('texImage2D probe: ' + err); }
      return r;
    };

    var oGen = proto.generateMipmap;
    proto.generateMipmap = function (target) {
      var r = oGen.apply(this, arguments);
      try { if (target === 3553) { var e = rec(bound(this)); if (e) e.mipmapCalls++; } }
      catch (err) { P.errors.push('generateMipmap probe: ' + err); }
      return r;
    };

    function askedHook(name) {
      var o = proto[name];
      proto[name] = function (target, pname, param) {
        var r = o.apply(this, arguments);
        try { if (target === 3553) { var e = rec(bound(this)); if (e) e.asked[pname] = param; } }
        catch (err) { P.errors.push(name + ' probe: ' + err); }
        return r;
      };
    }
    askedHook('texParameteri');
    askedHook('texParameterf');

    // ---- draw-time readback -------------------------------------------------
    var EPOCH = 5000;
    function sampleAtDraw(gl) {
      var t = bound(gl);
      if (!t || t.__aaid === undefined) return;
      var id = t.__aaid;
      var slot = P.draw[id] || (P.draw[id] = { draws: 0, obs: [] });
      slot.draws++;
      var ep = Math.floor(performance.now() / EPOCH);
      if (slot.lastEpoch === ep || slot.obs.length >= 8) return;
      slot.lastEpoch = ep;
      var o = { t: Math.round(performance.now()),
                min: gl.getTexParameter(3553, 10241),
                mag: gl.getTexParameter(3553, 10240),
                wrapS: gl.getTexParameter(3553, 10242),
                wrapT: gl.getTexParameter(3553, 10243) };
      try { o.aniso = gl.getTexParameter(3553, 0x84FE); } catch (e) { o.aniso = 'unsupported'; }
      slot.obs.push(o);
    }
    ['drawArrays', 'drawElements'].forEach(function (m) {
      var o = proto[m];
      proto[m] = function () {
        try { sampleAtDraw(this); } catch (e) { P.errors.push(m + ' probe: ' + e); }
        return o.apply(this, arguments);
      };
    });


    // ---- the anisotropy A/B ------------------------------------------------
    // window.AA_FORCE_ANISO is set by ONE injected line in aniso-on.html and
    // to 0 in aniso-off.html; the two pages are otherwise byte-identical and
    // load the same .js/.wasm/.data. This is deliberately a JS shim and not a
    // C++ change: it proves whether anisotropic filtering is the cause while
    // holding the binary fixed, which a rebuild could not do. It is NOT the
    // shape a fix would ship in -- see the report.
    //
    // The rule mirrors what a C++ change would have to do: raise
    // TEXTURE_MAX_ANISOTROPY_EXT only on textures whose MIN filter is
    // mipmapped, because anisotropic filtering samples the mip chain and a
    // texture without one (title.jpg) must not be given it. Emscripten has
    // already called getExtension('EXT_texture_filter_anisotropic') on this
    // context in GL.initExtensions (libwebgl.js), so the enum is enabled and
    // this needs no cooperation from the page.
    var AF = Number(window.AA_FORCE_ANISO || 0);
    if (AF > 0) {
      var oTPi = proto.texParameteri;
      proto.texParameteri = function (target, pname, param) {
        var r = oTPi.apply(this, arguments);
        try {
          if (target === 3553 && pname === 10241 /* MIN_FILTER */ &&
              (param === 0x2700 || param === 0x2701 || param === 0x2702 || param === 0x2703)) {
            var ext = this.getExtension('EXT_texture_filter_anisotropic');
            if (ext) {
              var max = this.getParameter(0x84FF);
              oTPi.call(this, 3553, 0x84FE, Math.min(AF, max));
            }
          }
        } catch (err) { P.errors.push('aniso shim: ' + err); }
        return r;
      };
      console.log('[TEXPROBE] anisotropy shim armed at ' + AF + 'x');
    } else {
      console.log('[TEXPROBE] anisotropy shim NOT armed (AA_FORCE_ANISO=' + AF + ')');
    }

    // ---- context facts ------------------------------------------------------
    var oGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      var gl = oGet.apply(this, arguments);
      try {
        if (gl && !P.ctx && /webgl/i.test(String(type))) {
          P.gl = gl;
          var dbg = gl.getExtension('WEBGL_debug_renderer_info');
          var an = gl.getExtension('EXT_texture_filter_anisotropic');
          P.ctx = {
            type: String(type),
            requested: JSON.parse(JSON.stringify(arguments[1] || {})),
            granted: gl.getContextAttributes(),
            VENDOR: gl.getParameter(gl.VENDOR),
            RENDERER: gl.getParameter(gl.RENDERER),
            VERSION: gl.getParameter(gl.VERSION),
            SHADING_LANGUAGE_VERSION: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            UNMASKED_VENDOR: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
            UNMASKED_RENDERER: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
            SAMPLES: gl.getParameter(gl.SAMPLES),
            SAMPLE_BUFFERS: gl.getParameter(gl.SAMPLE_BUFFERS),
            MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            drawingBuffer: gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight,
            canvasAttr: this.width + 'x' + this.height,
            devicePixelRatio: window.devicePixelRatio,
            innerWindow: window.innerWidth + 'x' + window.innerHeight,
            screen: screen.width + 'x' + screen.height,
            anisotropic_supported: !!an,
            MAX_TEXTURE_MAX_ANISOTROPY_EXT: an ? gl.getParameter(0x84FF) : null,
            extensions: gl.getSupportedExtensions()
          };
        }
      } catch (err) { P.errors.push('getContext probe: ' + err); }
      return gl;
    };

    // ---- level-0 readback ---------------------------------------------------
    P.dump = function (id) {
      var gl = P.gl, e = P.byId.get(id);
      if (!gl || !e || !e.w) return null;
      var prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      var prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      var t = e.obj;
      if (!t) { gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); gl.deleteFramebuffer(fb); return 'no object handle'; }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      var out = null;
      if (st === gl.FRAMEBUFFER_COMPLETE) {
        var px = new Uint8Array(e.w * e.h * 4);
        gl.readPixels(0, 0, e.w, e.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var c = document.createElement('canvas');
        c.width = e.w; c.height = e.h;
        var cx = c.getContext('2d');
        var im = cx.createImageData(e.w, e.h);
        // GL origin is bottom-left; flip into image order.
        for (var y = 0; y < e.h; y++) {
          var s = (e.h - 1 - y) * e.w * 4, d = y * e.w * 4;
          for (var x = 0; x < e.w * 4; x++) im.data[d + x] = px[s + x];
        }
        cx.putImageData(im, 0, 0);
        out = c.toDataURL('image/png');
      } else { out = 'framebuffer incomplete: 0x' + st.toString(16); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.deleteFramebuffer(fb);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      return out;
    };

    // ---- does a usable mip chain exist? ------------------------------------
    P.mipLevels = function (id) {
      var gl = P.gl, e = P.byId.get(id);
      if (!gl || !e || !e.obj) return null;
      var vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, 'attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }');
      gl.compileShader(vs);
      var fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, 'precision highp float; varying vec2 uv; uniform sampler2D s; uniform float k; void main(){ gl_FragColor = texture2D(s, uv*k); }');
      gl.compileShader(fs);
      var pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return 'link failed: ' + gl.getProgramInfoLog(pr);

      var rt = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rt);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);

      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(pr, 'p');
      gl.useProgram(pr);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, 1, 1);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(gl.getUniformLocation(pr, 's'), 0);

      function shot(minFilter, k) {
        gl.bindTexture(gl.TEXTURE_2D, e.obj);
        var was = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
        if (minFilter !== null) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.uniform1f(gl.getUniformLocation(pr, 'k'), k);
        gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        var px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (minFilter !== null) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, was);
        return Array.from(px).join(',');
      }

      var asIs = shot(null, e.w);          // the filter the game left on it
      var forcedLinear = shot(gl.LINEAR, e.w);
      var forcedMipLinear = shot(gl.LINEAR_MIPMAP_LINEAR, e.w);
      var forcedMipNearest = shot(gl.NEAREST_MIPMAP_NEAREST, e.w);
      var err = gl.getError();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb); gl.deleteTexture(rt); gl.deleteBuffer(buf);
      gl.deleteProgram(pr); gl.deleteShader(vs); gl.deleteShader(fs);
      return { id: id, size: e.w + 'x' + e.h, minified_by: e.w,
               as_is: asIs, forced_LINEAR: forcedLinear,
               forced_LINEAR_MIPMAP_LINEAR: forcedMipLinear,
               forced_NEAREST_MIPMAP_NEAREST: forcedMipNearest,
               glGetError: '0x' + err.toString(16) };
    };


    // ---- 1:1 crops of the backing store -------------------------------------
    // A CDP screenshot is taken at the CSS size, so at a canvas larger than the
    // window it is a DOWNSCALE and useless for judging sharpness. These copy a
    // rectangle of the drawing buffer at 1:1 into a 2D canvas instead. The
    // canvas is created with preserveDrawingBuffer (web/shell.html forces it),
    // so the pixels are there to be read between frames.
    //
    // Rectangles are normalised so the same names mean the same part of the
    // frame at any resolution. 'cycle' is where the player's own machine sits a
    // few seconds into a round under the default CAMERA_CUSTOM; 'floor_far' is
    // the receding grid near the horizon, which is the oblique minified surface
    // anisotropic filtering exists for and is NOT the same question as the
    // cycle.
    P.RECTS = {
      cycle:     [0.42, 0.50, 0.16, 0.20],
      floor_far: [0.30, 0.28, 0.40, 0.12],
      floor_mid: [0.25, 0.40, 0.50, 0.16],
      wall_left: [0.00, 0.14, 0.30, 0.12]
    };
    P.crop = function (name) {
      var cv = document.getElementById('canvas');
      var r = P.RECTS[name];
      if (!cv || !r) return null;
      var x = Math.round(r[0] * cv.width), y = Math.round(r[1] * cv.height);
      var w = Math.round(r[2] * cv.width), h = Math.round(r[3] * cv.height);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(cv, x, y, w, h, 0, 0, w, h);
      return c.toDataURL('image/png');
    };

    // The player cycle's on-screen footprint, in pixels, measured rather than
    // eyeballed: the tightest box around texels that differ from the black
    // floor inside the 'cycle' rect. This is what decides whether the report is
    // about FILTERING or about the cycle simply covering more pixels natively.
    P.cycleFootprint = function () {
      var cv = document.getElementById('canvas');
      var r = P.RECTS.cycle;
      var x = Math.round(r[0] * cv.width), y = Math.round(r[1] * cv.height);
      var w = Math.round(r[2] * cv.width), h = Math.round(r[3] * cv.height);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(cv, x, y, w, h, 0, 0, w, h);
      var d = cx.getImageData(0, 0, w, h).data;
      // The floor is the dark grid; the cycle is the only saturated thing in
      // this rect. Threshold on channel spread, which the grey grid lines have
      // none of, rather than on brightness, which they do have.
      var x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
      for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
        var o = (j * w + i) * 4, R = d[o], G = d[o+1], B = d[o+2];
        var spread = Math.max(R, G, B) - Math.min(R, G, B);
        if (spread > 40) {
          n++;
          if (i < x0) x0 = i; if (i > x1) x1 = i;
          if (j < y0) y0 = j; if (j > y1) y1 = j;
        }
      }
      return { canvas: cv.width + 'x' + cv.height, rect: w + 'x' + h,
               saturated_px: n,
               bbox: x1 < 0 ? null : (x1 - x0 + 1) + 'x' + (y1 - y0 + 1) };
    };


    // ---- flip anisotropy on the live textures, mid-run --------------------
    // WHY THIS EXISTS AND THE TWO-PAGE A/B DOES NOT SUFFICE. Two separate runs
    // of this game are not the same scene: the local player's colour is not the
    // same from run to run, and the cycles are never in quite the same place at
    // the same wall-clock offset. Measured: an aniso-off run and an aniso-on run
    // drew a GREEN cycle and a YELLOW one. A pixel diff between those two is
    // dominated by that, not by filtering, and no amount of care with the step
    // timings fixes it.
    //
    // So the real experiment is within ONE run: crop, flip anisotropy on every
    // live texture, crop again. Same colours, same positions, ~200 ms apart --
    // and taken during the post-NEW_ROUND countdown, while the cycles are still
    // stationary. The step script takes a THIRD crop before the flip so the
    // run carries its own noise floor: whatever two crops 200 ms apart differ
    // by with nothing changed is the number the flip has to beat.
    //
    // isTexture() is not optional: rITexture::Unload deletes textures whenever
    // the texture mode changes, and binding a deleted one raises
    // INVALID_OPERATION -- which is exactly the warning the first probe run put
    // in its transcript.
    P.setAniso = function (n) {
      var gl = P.gl;
      if (!gl) return 'no context';
      var ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (!ext) return 'EXT_texture_filter_anisotropic unavailable';
      var max = gl.getParameter(0x84FF);
      var want = Math.min(n, max);
      var prev = gl.getParameter(gl.TEXTURE_BINDING_2D);
      var touched = 0, skipped = 0, dead = 0;
      P.tex.forEach(function (e) {
        if (!e.obj) return;
        if (!gl.isTexture(e.obj)) { dead++; return; }
        gl.bindTexture(gl.TEXTURE_2D, e.obj);
        var min = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
        if (min === 0x2700 || min === 0x2701 || min === 0x2702 || min === 0x2703) {
          gl.texParameterf(gl.TEXTURE_2D, 0x84FE, want);
          touched++;
        } else skipped++;
      });
      gl.bindTexture(gl.TEXTURE_2D, prev);
      return JSON.stringify({ set: want, max: max, mipmapped_touched: touched,
                              non_mipmapped_skipped: skipped, already_deleted: dead,
                              glGetError: '0x' + gl.getError().toString(16) });
    };

    P.summary = function () {
      var out = { ctx: P.ctx, errors: P.errors, textures: [] };
      P.tex.forEach(function (e) {
        var d = P.draw[e.id];
        out.textures.push({
          id: e.id, size: (e.w || '?') + 'x' + (e.h || '?'),
          format: e.format, type: e.type, fp: e.fp, head: e.uploads.length ? e.uploads[0].head : null,
          uploads: e.uploads.length, mipmapCalls: e.mipmapCalls,
          asked: e.asked, draws: d ? d.draws : 0, obs: d ? d.obs : []
        });
      });
      return out;
    };
    console.log('[TEXPROBE] installed');
  } catch (err) {
    console.log('[TEXPROBE] install FAILED: ' + err);
  }
})();
`;


// The anisotropy shim ON ITS OWN, with none of the probe's hooks. The image A/B
// can afford the probe -- both sides carry it, so it cancels -- but a FRAME RATE
// A/B cannot: the probe wraps both draw entry points, and under
// -sLEGACY_GL_EMULATION every glBegin/glEnd pair is a draw call, so it is on the
// hottest path in the program. These two pages exist so the frame-rate cost of
// anisotropic filtering is measured against a page that is otherwise the
// shipped client, not against a page carrying an instrument.
const SHIM = `
(function () {
  try {
    var AF = Number(window.AA_FORCE_ANISO || 0);
    if (AF <= 0) { console.log('[ANISO] not armed'); return; }
    var proto = WebGLRenderingContext.prototype;
    var oTPi = proto.texParameteri;
    proto.texParameteri = function (target, pname, param) {
      var r = oTPi.apply(this, arguments);
      if (target === 3553 && pname === 10241 &&
          (param === 0x2700 || param === 0x2701 || param === 0x2702 || param === 0x2703)) {
        var ext = this.getExtension('EXT_texture_filter_anisotropic');
        if (ext) oTPi.call(this, 3553, 0x84FE, Math.min(AF, this.getParameter(0x84FF)));
      }
      return r;
    };
    console.log('[ANISO] armed at ' + AF + 'x');
  } catch (e) { console.log('[ANISO] install failed: ' + e); }
})();
`;

const html = readFileSync(SRC, 'utf8');
const occurrences = html.split('<body>').length - 1;
if (occurrences !== 1) {
  console.error(`expected exactly one <body> in ${SRC}, found ${occurrences}`);
  process.exit(1);
}

// THE A/B PAIR IS 3600x2086 BECAUSE THAT IS WHAT THIS DISPLAY ACTUALLY GETS.
// Measured in a maximised Chrome with no CDP metrics override: CSS 1800x1169 at
// devicePixelRatio 2, maximised inner 1800x1043, so web/shell.html's rule
// yields 3600x2086 = 7.51 Mpx and the 3840x2160 area cap does NOT bite. The
// probe run at the harness's default 1280x800 renders the cycle at about an
// eighth of the pixels it really has, which is exactly the confound this pair
// has to avoid: a screenshot taken at the wrong resolution cannot tell
// "filtered badly" from "smaller".
const CANVAS = [3600, 2086];

const pages = [
  ['texprobe.html',     null,   0,  PROBE],   // whatever the window gives; aniso off
  ['aniso-off.html',    CANVAS, 0,  PROBE],   // image A/B, instrumented
  ['aniso-on.html',     CANVAS, 16, PROBE],
  ['fps-aniso-off.html', CANVAS, 0,  SHIM],   // frame-rate A/B, not instrumented
  ['fps-aniso-on.html',  CANVAS, 16, SHIM],
];

for (const [name, size, af, script] of pages) {
  const pre = (size ? `window.AA_CANVAS_SIZE=[${size[0]},${size[1]}];` : '') +
              `window.AA_FORCE_ANISO=${af};`;
  const inject = `<script>${pre}</script><script>${script}</script>`;
  const out = html.replace('<body>', `<body>${inject}`);
  if (!out.includes(inject)) { console.error(`injection failed for ${name}`); process.exit(1); }
  const file = join(DIST, name);
  writeFileSync(file, out);
  console.log(`${file}  canvas=${size ? size.join('x') : 'from window'}  aniso=${af || 'off'}`);
}

// The pair must differ in EXACTLY the anisotropy number, or the A/B is not a
// control. Asserted rather than trusted.
for (const [off, on] of [['aniso-off.html', 'aniso-on.html'],
                        ['fps-aniso-off.html', 'fps-aniso-on.html']]) {
  const a = readFileSync(join(DIST, off), 'utf8');
  const b = readFileSync(join(DIST, on), 'utf8');
  if (a.replace('AA_FORCE_ANISO=0', 'AA_FORCE_ANISO=16') !== b) {
    console.error(`${off} and ${on} differ in more than AA_FORCE_ANISO`);
    process.exit(1);
  }
  console.log(`control check: ${off} and ${on} differ in AA_FORCE_ANISO and nothing else`);
}
