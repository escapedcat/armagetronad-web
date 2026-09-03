(() => {
  /* One frame = one flush/finish on the WebGL context. rSysDep::SwapGL calls
     exactly one of the two per swap, chosen by swapMode_: the static default
     is rSwap_glFlush, but sr_LoadDefaultConfig (rScreen.cpp) sets
     rSwap_glFinish and welcome() (gArmagetron.cpp) runs it under st_FirstUse
     -- and every harness run is a first-use boot (drive-browser.mjs makes a
     fresh profile), so the client the harness measures swaps with glFinish,
     a synchronous wait for the GPU. S.swaps counts each kind so the [PERF]
     line says which fired instead of assuming. Per frame we keep: the
     timestamp (taken BEFORE the swap call), the time spent INSIDE the swap
     call (the GPU wait), the timestamp of the frame's first draw call, the
     number of drawArrays/drawElements calls, and the bytes through
     bufferData/bufferSubData. Draw calls and bytes are the direct measure of
     "geometry re-submitted through the emulation this frame" (mechanism 1);
     the first-draw timestamp lets report.js split a frame interval into
     [end of previous swap -> first draw] (event-loop yield, input,
     simulation) and [first draw -> swap] (render submission), so a frame that
     gets slower in the first part while its draw calls stay flat is NOT the
     renderer. */
  /* THIS FILE IS ONE EXPRESSION WITH BLOCK COMMENTS ONLY: run-arm.sh strips
     every newline to fit it into a single eval: step of drive-browser.mjs, so
     a // comment would swallow the rest of the program. */
  const N = 600000;
  const S = { t: new Float64Array(N), wait: new Float32Array(N), first: new Float64Array(N),
              draws: new Uint32Array(N), bytes: new Float64Array(N), n: 0,
              swaps: { flush: 0, finish: 0 }, marks: [], shots: [], cur: { draws: 0, bytes: 0, first: 0 } };
  window.__fps = S;
  /* Screenshot bracket. Page.captureScreenshot spends real time on the page
     and can put a hitch INTO a measured window; the driver's own
     "[harness] screenshot" line is on the driver's clock, in the driver's
     transcript, where report.js cannot see it. The template therefore wraps
     every shot: step in eval:__fps.shot('name','begin') and
     eval:__fps.shot('name','end'), on the page's clock, and report.js drops
     the frames between the two (plus a pad) from every statistic. */
  S.shot = (name, edge) => { S.shots.push([performance.now(), name, edge]); return 'shot ' + edge + ' ' + name; };
  const wrap = (C) => {
    if (!C) return; const P = C.prototype;
    for (const m of ['flush', 'finish']) { const o = P[m]; if (!o) continue;
      P[m] = function () {
        const i = S.n, now = performance.now();
        if (i < N) { S.t[i] = now; S.draws[i] = S.cur.draws; S.bytes[i] = S.cur.bytes; S.first[i] = S.cur.first; S.n = i + 1; }
        S.swaps[m]++; S.cur.draws = 0; S.cur.bytes = 0; S.cur.first = 0;
        const r = o.apply(this, arguments);
        if (i < N) S.wait[i] = performance.now() - now;
        return r; }; }
    for (const m of ['drawArrays', 'drawElements']) { const o = P[m]; if (!o) continue;
      P[m] = function () { if (!S.cur.first) S.cur.first = performance.now(); S.cur.draws++; return o.apply(this, arguments); }; }
    for (const m of ['bufferData', 'bufferSubData']) { const o = P[m]; if (!o) continue;
      P[m] = function () { const d = (m === 'bufferData') ? arguments[1] : arguments[2];
        S.cur.bytes += (d && d.byteLength) ? d.byteLength : (typeof d === 'number' ? d : 0);
        return o.apply(this, arguments); }; }
  };
  wrap(window.WebGLRenderingContext); wrap(window.WebGL2RenderingContext);
  const cl = console.log.bind(console);
  console.log = function () { const s = (arguments.length && typeof arguments[0] === 'string') ? arguments[0] : '';
    if (s.indexOf('[L] ') === 0) S.marks.push([performance.now(), s]); return cl.apply(null, arguments); };
  return 'sampler armed: frames, swap kind and wait, first draw, draw calls, buffer bytes, shot brackets';
})()
