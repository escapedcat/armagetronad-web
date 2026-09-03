(() => {
  /* ONE EXPRESSION, BLOCK COMMENTS ONLY: run-arm.sh strips newlines to make
     this a single eval: step (see sampler.js). TAGHERE and CPURATE are
     substituted by run-arm.sh. The object this prints after "[PERF] <arm> " is
     the schema Tasks 2-4 read; web/tools/perf/README.md documents it. */
  const S = window.__fps, n = S.n;
  const PAD_BEFORE = 100, PAD_AFTER = 250;
  const nr = S.marks.filter(m => m[1].indexOf('[L] NEW_ROUND') === 0).map(m => m[0]);
  const rw = S.marks.filter(m => m[1].indexOf('[L] ROUND_WINNER') === 0).map(m => m[0]);
  /* Screenshot exclusions: [begin - PAD_BEFORE, end + PAD_AFTER] for every
     bracketed shot (sampler.js S.shot); a begin with no end -- the driver died
     mid-shot -- excludes two seconds. */
  const ex = []; const open = {};
  for (const [t, name, edge] of S.shots) {
    if (edge === 'begin') open[name] = t;
    else if (edge === 'end' && open[name] != null) { ex.push({ a: open[name] - PAD_BEFORE, b: t + PAD_AFTER, name: name, dur: t - open[name] }); delete open[name]; } }
  for (const name in open) ex.push({ a: open[name] - PAD_BEFORE, b: open[name] + 2000, name: name, dur: null });
  const excluded = (t) => ex.some(e => t >= e.a && t <= e.b);
  const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
  const r2 = (x) => (x == null) ? null : Math.round(x * 100) / 100;
  /* A window's statistics use only frames outside every exclusion, and only
     deltas between frames that were ADJACENT samples, so a gap that straddles
     an exclusion is never counted as a frame time. raw_ms_max ignores the
     exclusions on purpose: it is where a screenshot hitch stays visible, so a
     reader can see what was excluded and that it did not leak into ms_p50. */
  const win = (t0, t1) => {
    const ix = []; let dropped = 0, rawMax = 0, prev = -1;
    for (let i = 0; i < n; i++) { const t = S.t[i]; if (t < t0 || t > t1) continue;
      if (prev >= 0) rawMax = Math.max(rawMax, t - S.t[prev]); prev = i;
      if (excluded(t)) dropped++; else ix.push(i); }
    const d = []; let dr = 0, by = 0;
    for (let k = 1; k < ix.length; k++) if (ix[k] === ix[k - 1] + 1) d.push(S.t[ix[k]] - S.t[ix[k - 1]]);
    for (const i of ix) { dr += S.draws[i]; by += S.bytes[i]; }
    const f = ix.length || 1;
    let exms = 0; for (const e of ex) exms += Math.max(0, Math.min(t1, e.b) - Math.max(t0, e.a));
    const span = Math.max(1, (t1 - t0) - exms);
    return { frames: ix.length, frames_excluded: dropped, ms_p50: r2(q(d, .5)), ms_p90: r2(q(d, .9)),
             fps: r2(ix.length / (span / 1000)), draws_per_frame: r2(dr / f),
             kb_per_frame: r2(by / f / 1024), hitches_over_50ms: d.filter(x => x > 50).length,
             raw_ms_max: r2(rawMax) }; };
  const perSec = (t0, t1) => { const ms = [], dr = [], mx = [];
    for (let k = 0; k * 1000 < t1 - t0; k++) { const w = win(t0 + k * 1000, Math.min(t1, t0 + (k + 1) * 1000));
      ms.push(w.ms_p50); dr.push(w.draws_per_frame); mx.push(w.raw_ms_max); }
    return { ms_p50: ms, draws_per_frame: dr, raw_ms_max: mx }; };
  const rounds = [];
  for (let i = 0; i < Math.min(nr.length, rw.length); i++) {
    const t0 = nr[i], t1 = rw[i], len = (t1 - t0) / 1000; if (len < 8) continue;
    const e = win(t0, t0 + 5000), l = win(t1 - 5000, t1), all = win(t0, t1);
    const shots = ex.filter(x => x.a >= t0 && x.a <= t1).map(x => ({ name: x.name, at_s: r2((x.a + PAD_BEFORE - t0) / 1000), dur_ms: r2(x.dur) }));
    rounds.push({ round: i + 1, length_s: r2(len), early_5s: e, late_5s: l,
      ratio_ms: e.ms_p50 ? r2(l.ms_p50 / e.ms_p50) : null,
      ratio_draws: e.draws_per_frame ? r2(l.draws_per_frame / e.draws_per_frame) : null,
      hitches_over_50ms: all.hitches_over_50ms, frames: all.frames, frames_excluded: all.frames_excluded,
      raw_ms_max: all.raw_ms_max, shots: shots, per_second: perSec(t0, t1) }); }
  return '[PERF] TAGHERE ' + JSON.stringify({ arm: 'TAGHERE', cpu_rate: CPURATE, frames: n,
    rounds_started: nr.length, rounds_won: rw.length,
    shots_bracketed: ex.filter(x => x.dur != null).length, shot_pad_ms: [PAD_BEFORE, PAD_AFTER], rounds });
})()
