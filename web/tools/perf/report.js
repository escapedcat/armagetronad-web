(() => {
  /* ONE EXPRESSION, BLOCK COMMENTS ONLY: run-arm.sh strips newlines to make
     this a single eval: step (see sampler.js). TAGHERE and CPURATE are
     substituted by run-arm.sh. The object this prints after "[PERF] <arm> " is
     the schema Tasks 2-4 read; web/tools/perf/README.md documents it. */
  const S = window.__fps, n = S.n;
  const PAD_BEFORE = 100, PAD_AFTER = 250;
  const marks = (p) => S.marks.filter(m => m[1].indexOf(p) === 0);
  const nr = marks('[L] NEW_ROUND').map(m => m[0]);
  const rw = marks('[L] ROUND_WINNER').map(m => m[0]);
  /* The human is the first PLAYER_ENTERED name; the AIs never enter that way.
     A DEATH_* line names its victim first, so the human's deaths are the
     DEATH_ marks whose first name is that one. */
  const pe = marks('[L] PLAYER_ENTERED ');
  const human = pe.length ? pe[0][1].split(/\s+/)[2] : 'web_user';
  const deaths = S.marks.filter(m => /^\[L\] DEATH_\w+ /.test(m[1]) && m[1].split(/\s+/)[2] === human).map(m => m[0]);
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
     reader can see what was excluded and that it did not leak into ms_p50.
     Each frame interval t[i]-t[p] (p the previous sample) is also split into
     the three parts the sampler timestamps: ms_in_swap = the previous swap
     call itself (glFinish's wait for the GPU), ms_to_first_draw = from that
     call's return to this frame's first draw call (the emscripten_sleep(0)
     yield, input, the simulation, render setup), ms_first_draw_to_swap = from
     the first draw call to this frame's swap call (render submission). */
  const win = (t0, t1) => {
    const ix = []; let dropped = 0, rawMax = 0, prev = -1;
    for (let i = 0; i < n; i++) { const t = S.t[i]; if (t < t0 || t > t1) continue;
      if (prev >= 0) rawMax = Math.max(rawMax, t - S.t[prev]); prev = i;
      if (excluded(t)) dropped++; else ix.push(i); }
    const d = [], sw = [], pre = [], ren = []; let dr = 0, by = 0;
    for (let k = 1; k < ix.length; k++) if (ix[k] === ix[k - 1] + 1) { const i = ix[k], p = ix[k - 1];
      d.push(S.t[i] - S.t[p]); sw.push(S.wait[p]);
      if (S.first[i] > 0) { pre.push(S.first[i] - (S.t[p] + S.wait[p])); ren.push(S.t[i] - S.first[i]); } }
    for (const i of ix) { dr += S.draws[i]; by += S.bytes[i]; }
    const f = ix.length || 1;
    let exms = 0; for (const e of ex) exms += Math.max(0, Math.min(t1, e.b) - Math.max(t0, e.a));
    const span = Math.max(1, (t1 - t0) - exms);
    return { frames: ix.length, frames_excluded: dropped, ms_p50: r2(q(d, .5)), ms_p90: r2(q(d, .9)),
             fps: r2(ix.length / (span / 1000)), draws_per_frame: r2(dr / f),
             kb_per_frame: r2(by / f / 1024), hitches_over_50ms: d.filter(x => x > 50).length,
             raw_ms_max: r2(rawMax), ms_in_swap_p50: r2(q(sw, .5)),
             ms_to_first_draw_p50: r2(q(pre, .5)), ms_first_draw_to_swap_p50: r2(q(ren, .5)) }; };
  const perSec = (t0, t1) => { const ms = [], dr = [], mx = [], pre = [], ren = [];
    for (let k = 0; k * 1000 < t1 - t0; k++) { const w = win(t0 + k * 1000, Math.min(t1, t0 + (k + 1) * 1000));
      ms.push(w.ms_p50); dr.push(w.draws_per_frame); mx.push(w.raw_ms_max); pre.push(w.ms_to_first_draw_p50); ren.push(w.ms_first_draw_to_swap_p50); }
    return { ms_p50: ms, draws_per_frame: dr, raw_ms_max: mx, ms_to_first_draw_p50: pre, ms_first_draw_to_swap_p50: ren }; };
  /* Pre-round frames. For the first half second of game time after a round
     starts (gGame.cpp GameLoop, the gtime <= -PREPARE_TIME + .5 branch) the
     game clears the screen and swaps WITHOUT calling Render: overlay only, no
     arena, a handful of draw calls at a fraction of a world frame's cost.
     They sit right after NEW_ROUND and would otherwise fill the early window
     with frames that have no geometry in them. They are found by their draw
     count: the threshold is halfway between the fewest draws of any frame in
     the round's first two seconds (an overlay-only frame) and the median of
     its second second (world frames); the measured span starts at the first
     frame after the last frame under the threshold. The frame that straddles
     NEW_ROUND itself (drawn mostly before it) is above the threshold and is
     left out of both. */
  const preRound = (t0) => {
    const a = [], b = [];
    for (let i = 0; i < n; i++) { const t = S.t[i]; if (t < t0) continue; if (t >= t0 + 2000) break; a.push(i); if (t >= t0 + 1000) b.push(S.draws[i]); }
    const none = { start: t0, stats: { frames: 0, ms_p50: null, draws_per_frame: null, span_ms: 0, split_at_draws: null } };
    if (!a.length) return none;
    let lo = Infinity; for (const i of a) lo = Math.min(lo, S.draws[i]);
    const med = q(b, .5); if (med == null || !(med > lo)) return none;
    const thr = (lo + med) / 2; const ov = a.filter(i => S.draws[i] <= thr);
    if (!ov.length) return none;
    const last = ov[ov.length - 1]; const d = []; let dr = 0;
    for (let k = 1; k < ov.length; k++) if (ov[k] === ov[k - 1] + 1) d.push(S.t[ov[k]] - S.t[ov[k - 1]]);
    for (const i of ov) dr += S.draws[i];
    return { start: (last + 1 < n) ? S.t[last + 1] : t0,
             stats: { frames: ov.length, ms_p50: r2(q(d, .5)), draws_per_frame: r2(dr / ov.length),
                      span_ms: r2(S.t[last] - S.t[ov[0]]), split_at_draws: r2(thr) } }; };
  const rounds = [];
  for (let i = 0; i < Math.min(nr.length, rw.length); i++) {
    const t0 = nr[i], t1 = rw[i], len = (t1 - t0) / 1000; if (len < 8) continue;
    /* The measured span runs from the first world frame to the human's death
       when the human dies before ROUND_WINNER (after it the camera shows an
       explosion and the AIs' endgame, which is not what the maintainer
       plays), else to ROUND_WINNER. */
    const death = deaths.find(t => t > t0 && t < t1); const te = death != null ? death : t1;
    const pr = preRound(t0); const ts = pr.start;
    const e = win(ts, ts + 5000), l = win(te - 5000, te), all = win(ts, te);
    const shots = ex.filter(x => x.a >= t0 && x.a <= t1).map(x => ({ name: x.name, at_s: r2((x.a + PAD_BEFORE - t0) / 1000), dur_ms: r2(x.dur) }));
    rounds.push({ round: i + 1, length_s: r2(len),
      measured_from_s: r2((ts - t0) / 1000), measured_to_s: r2((te - t0) / 1000),
      human_death_s: death != null ? r2((death - t0) / 1000) : null, ends_at: death != null ? 'human_death' : 'round_winner',
      pre_round: pr.stats, early_5s: e, late_5s: l,
      ratio_ms: e.ms_p50 ? r2(l.ms_p50 / e.ms_p50) : null,
      ratio_draws: e.draws_per_frame ? r2(l.draws_per_frame / e.draws_per_frame) : null,
      hitches_over_50ms: all.hitches_over_50ms, frames: all.frames, frames_excluded: all.frames_excluded,
      raw_ms_max: all.raw_ms_max, shots: shots, per_second: perSec(t0, t1) }); }
  return '[PERF] TAGHERE ' + JSON.stringify({ arm: 'TAGHERE', cpu_rate: CPURATE, frames: n, human: human,
    swaps: S.swaps, rounds_started: nr.length, rounds_won: rw.length,
    shots_bracketed: ex.filter(x => x.dur != null).length, shot_pad_ms: [PAD_BEFORE, PAD_AFTER], rounds });
})()
