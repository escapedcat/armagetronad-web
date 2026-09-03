(() => {
  /* One frame = one flush/finish from rSysDep::SwapGL (swapMode_ defaults to
     rSwap_glFlush, so it is exactly one glFlush per swap). Per frame we keep
     the timestamp, the number of drawArrays/drawElements calls, and the bytes
     that went through bufferData/bufferSubData: draw calls and bytes are the
     direct measure of "geometry re-submitted through the emulation this
     frame", which is mechanism 1 -- so a frame that gets slower while its draw
     calls stay flat is NOT the renderer. */
  /* THIS FILE IS ONE EXPRESSION WITH BLOCK COMMENTS ONLY: run-arm.sh strips
     every newline to fit it into a single eval: step of drive-browser.mjs, so
     a // comment would swallow the rest of the program. */
  const N = 600000;
  const S = { t: new Float64Array(N), draws: new Uint32Array(N), bytes: new Float64Array(N), n: 0,
              marks: [], shots: [], cur: { draws: 0, bytes: 0 } };
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
        if (S.n < N) { S.t[S.n] = performance.now(); S.draws[S.n] = S.cur.draws; S.bytes[S.n] = S.cur.bytes; S.n++; }
        S.cur.draws = 0; S.cur.bytes = 0; return o.apply(this, arguments); }; }
    for (const m of ['drawArrays', 'drawElements']) { const o = P[m]; if (!o) continue;
      P[m] = function () { S.cur.draws++; return o.apply(this, arguments); }; }
    for (const m of ['bufferData', 'bufferSubData']) { const o = P[m]; if (!o) continue;
      P[m] = function () { const d = (m === 'bufferData') ? arguments[1] : arguments[2];
        S.cur.bytes += (d && d.byteLength) ? d.byteLength : (typeof d === 'number' ? d : 0);
        return o.apply(this, arguments); }; }
  };
  wrap(window.WebGLRenderingContext); wrap(window.WebGL2RenderingContext);
  const cl = console.log.bind(console);
  console.log = function () { const s = (arguments.length && typeof arguments[0] === 'string') ? arguments[0] : '';
    if (s.indexOf('[L] ') === 0) S.marks.push([performance.now(), s]); return cl.apply(null, arguments); };
  return 'sampler armed: frames, draw calls, buffer bytes, shot brackets';
})()
