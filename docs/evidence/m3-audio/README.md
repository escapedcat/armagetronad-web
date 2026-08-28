# M3 gate evidence — non-zero PCM reaches the audio device interface

## What this shows, in one paragraph

Driven by one unmodified script through a first-time visitor's path and a real
three-round match against three AI opponents, the wasm client hands **non-zero
PCM to `SDL.audio.pushAudio`** — Emscripten's SDL 1.2 audio entry point, the
last place the mix exists as bytes the game produced. Chrome: **853 of 1021**
buffers in the measurement window carry a non-zero sample, peaking at
**5467/32768**. Firefox: **850 of 1014**, peaking at **5145**. Inside the
rounds themselves it is **every single buffer, in all three rounds, in both
engines**. The same measurement against a bundle whose two WAVs cannot be
decoded reads **0 of 1020** over the same call count at the same latency.

## What this does NOT show

Read this before quoting any number above.

1. **It does not show the buffers were rendered to a device.** `pushAudio` is
   *upstream* of the Web Audio graph: it is the function that creates an
   `AudioBufferSourceNode`, fills it from the heap and calls `start()` on it.
   Whether the graph then rendered anything, and whether a device played it, is
   outside this instrument entirely. The harness in fact guarantees the output
   end is silent — `drive-browser.mjs` passes Chrome `--mute-audio`, and
   Firefox is run headless.
2. **It does not show the mix is correct.** Whether the engine pitch tracks
   speed, whether the panning is the right way round, whether the explosion is
   too quiet, whether the 11025 Hz source is resampled correctly to the
   22050 Hz device — none of that is assessed anywhere in M3.
3. **Nobody has heard this.** No audio was captured to a file and no human
   listened. The strongest statement available is amplitude over time, and it
   is made below.

`check-audio-transcript.mjs` prints all three sentences after its verdict, so
they travel with the result instead of living only here.

## Re-check it rather than believing this file

```
node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/chrome-console.log
node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/firefox-console.log
```

Both exit **0**, with 20 checks each (A1–A19). The checker is the arbiter;
everything below is a description of what it is checking.

```
node docs/evidence/m3-audio/check-audio-transcript.mjs \
     docs/evidence/m3-audio/negative-control-chrome-console.log
```

exits **1**. That is the point of it.

## Re-run it from scratch

```
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out /tmp/audio-chrome \
     --script-file web/tools/audio-gate.steps
node web/tools/drive-firefox.mjs          --out /tmp/audio-firefox \
     --script-file web/tools/audio-gate.steps
```

`--headed` is required for Chrome and only for Chrome: headless Chrome 152
floods the page with thousands of spurious keydown events per real key press.
Chrome 152.0.7977.65 (headed, real GPU); Firefox 154.0.1 (headless). Canvas
1024x768 in both. Built with no `-O` added to `CLIENT_LDFLAGS` and `ASSERTIONS`
still on.

### The `.asrun` copy is deliberately stale

`audio-gate.steps.asrun` is the script **exactly as executed** for these
transcripts (`md5 8e38d0c901cbc2b2480e60efe33b36b5`). Do not take the following
on trust — run the diff:

```
diff docs/evidence/m3-audio/audio-gate.steps.asrun web/tools/audio-gate.steps
```

**No non-comment line differs**, and there is exactly one comment change: the
"WHAT IS CLAIMED" header used to say "non-zero, *structured* PCM" without
defining "structured". The live script now says what it means by it — the
amplitude series is silent through the menus and peaks once per round — because
an undefined adjective in a claim is how over-claiming starts.

## The measurement

### Where it is taken

`SDL.audio.pushAudio(ptr, sizeBytes)` is where Emscripten's SDL 1.2 emulation
takes the buffer `eSound.cpp`'s `fill_audio` has just filled and schedules it
into Web Audio. One call is one audio callback's worth of finished mix. The
probe in `web/tools/audio-gate.steps` wraps it from the page — **no source
change**: the loader is not modularised, so `SDL` and `HEAP16` are plain
globals — and for every call reads that buffer straight out of `HEAP16`,
recording the peak absolute sample, the count of non-zero samples,
`SDL.audio.paused`, the `AudioContext`'s state, and
`nextPlayTime - currentTime`.

Two independent instruments have to agree about what device this is before any
of it counts (check **A2**): `se_SoundInit` prints the spec `SDL_OpenAudio`
handed back, from C++, and the probe reads the same fields off `SDL.audio`,
from JavaScript.

```
[SND] device opened: 22050 Hz, 2 ch, 16-bit, 1024 frames/callback (46.4 ms per callback, SOUND_BUFFER_SHIFT 1)
[AUDIOPROBE] installed on SDL.audio.pushAudio at 8481ms after 141 polls:
  {"freq":22050,"samples":1024,"channels":2,"format":32784,"bytesPerSample":2,
   "bufferSize":4096,"bufferDurationSecs":0.046439909297052155,
   "bufferingDelay":0.05,"queued":5,"ctxSampleRate":48000}
```

### The numbers

|  | Chrome 152 (headed) | Firefox 154.0.1 (headless) |
|---|---|---|
| window | 47.41 s from the first trusted key press | 47.07 s |
| unpaused `pushAudio` calls in it | 1021 | 1014 |
| buffers carrying a non-zero sample | **853 (0.835)** | **850 (0.838)** |
| peak sample | **5467/32768 = 16.7%** | **5145/32768 = 15.7%** |
| per-buffer peak, p10 / p50 / p90 | 0 / 967 / 2321 | 0 / 990 / 2259 |
| gap between calls, p50 / p99 / max | 49 / 54 / **151** ms | 48 / 57 / **66** ms |
| scheduling lead, p50 / max | 278 / 282 ms | 278 / 282 ms |
| `AudioContext` state at every call | `running` | `running` |
| starvation warnings | 0 | 0 |

Per round — this is the strongest row in the table, and the one an overall
average would have hidden:

|  | round 1 | round 2 | round 3 |
|---|---|---|---|
| Chrome | 219/219 buffers, peak 4473 | 219/219, peak 5467 | 240/240, peak 4619 |
| Firefox | 218/218 buffers, peak 4156 | 218/218, peak 4879 | 240/240, peak 5145 |

**Every buffer of every round, in both engines.** The overall fraction is 0.835
rather than 1.0 because the window also contains the seven seconds of menus
between the first key press and the start of round 1, where silence is the
correct answer.

The 278 ms scheduling lead is not a free parameter: `queueNewAudioData` keeps
`bufferingDelay + numSimultaneouslyQueuedBuffers x bufferDuration` =
`0.05 + 5 x 0.0464` = 0.282 s of audio ahead of the clock. That single quantity
is both the latency and the main-thread stall the device can survive, which is
the trade `SOUND_BUFFER_SHIFT 1` was chosen on in M3 task 2.

### Amplitude per second of the window — why this is the game's sound

Loudest sample in each whole second, starting at the first key press:

```
Chrome   0,0,0,0,0,0,0, 2094,1512,1400,1347,1429,1368,2259, 4473, 2885,2894,
         1234,1115,1249,861,937,1428,1146,1349,1270,1331,2115, 5467, 3138,
         3607,1905,1297,1278,1172,1201,2098,1407,1189,1363,1415,1395, 4619,
         3485,2143,2808,3146,1103,1390,1124,1149,1153,1658,1962,1294,1722

Firefox  0,0,0,0,0,0,0, 1959,1347,1475,1360,1227,1326,2899, 4156, 2737,2842,
         1184,1166,1363,899,2576,1502,1245,1305,1261,1303,3674, 4879, 2865,
         3063,1848,1433,1135,1162,1651,1725,1053,1050,1018,1110,2299, 5145,
         3735,1702,2761,1837,1101,1256,1166,1433,1458,1355,1461,1614,1321
```

Seven seconds of exact zero — the menus — then never zero again, with **three
spikes, one per round**, at seconds 14, 28 and 42 in Chrome and 14, 28 and 42
in Firefox. Two different browsers, two different matches, the same shape. That
correlation is what makes these samples the *game's* sound rather than
something else in the buffer; it is not a claim that they sound right.

## Falsifiability: two controls, because one is not enough

### 1. Every check can be made to fail — 20 of 20

```
node docs/evidence/m3-audio/prove-checks-can-fail.mjs docs/evidence/m3-audio/chrome-console.log
```

Exits 0, and so does the same command against `firefox-console.log`. It applies
one targeted mutation per check to a copy of the passing transcript, re-runs
**the real checker** as a child process, and requires the targeted check to
flip to FAIL. All 20 flip in both engines' transcripts, and — reported rather
than assumed — each flips **in isolation**: no mutation took a second check
down with it. It also refuses to run if the unmutated transcript does not pass,
and fails if any check has no mutation aimed at it, so the list cannot rot by
someone adding a check and forgetting the control for it.

This proves a property of the *checker*. It says nothing about the game, which
is why it is not the only control here.

### 2. A genuinely silent build — the pipeline control

`make-silent-bundle.mjs` copies `web/dist-m1` and sets both WAVs' `fmt` chunk
`audioFormat` from 1 (PCM) to 0x11 (IMA ADPCM) inside `armagetronad.data`. The
file stays valid RIFF at exactly the same length, so **the `.wasm` is
byte-identical** (`md5 364233c6542fd97a21e9a5fe872e0507` for both) and only the
sound content differs. M3 task 1's parser then refuses both files.

```
node docs/evidence/m3-audio/make-silent-bundle.mjs web/dist-m1 /tmp/dist-silent
python3 -m http.server 8001 --directory /tmp/dist-silent &
node web/tools/drive-browser.mjs --headed --url http://localhost:8001/armagetronad.html \
     --out /tmp/silent-chrome --script-file web/tools/audio-gate.steps
```

Result (`negative-control-chrome-console.log`, checker exits **1**):

```
PCM in the window: 0/1020 unpaused pushAudio calls carried a non-zero sample (0), peak 0/32768
round 1: 0/220 buffers non-zero, peak 0        FAIL  A5  non-zero fraction 0 (bar: 0.5)
round 2: 0/218 buffers non-zero, peak 0        FAIL  A6  peak 0/32768 (bar: 1000)
round 3: 0/240 buffers non-zero, peak 0        FAIL  A7  fractions 0, 0, 0
                                               FAIL  A13 neither WAV decoded
                                               FAIL  A14 two budgets spent
```

**Exactly zero, over the same ~1020 unpaused calls at the same 278 ms lead**,
with all three rounds still completed, no exception and no hang. The plumbing
is identical and only the content differs, which is the strongest form this
control can take. Silence and success do not look the same to this measurement.

Everything structural still passed in that run — A1–A4b, A8–A12, A15–A19 — so
the failure is localised to the audio content rather than to the harness
falling over, which is what makes it a control rather than a crash.

## Two traps this gate is built around

### The window starts at the first *trusted* key press

`click:#start` goes through `Runtime.evaluate` / `script.evaluate`, which is
**not a user gesture**, so the `AudioContext` stays parked after the device
opens. This is measured here, not inherited:

| | Chrome | Firefox |
|---|---|---|
| `pushAudio` calls before the first trusted keydown | **0** | **5**, all in state `suspended`, all zero PCM |
| worst gap over the **whole run** | 151 ms | **6078 ms** |
| worst gap over the **window** | 151 ms | **66 ms** |
| starvation warning for that gap | — | **none** |

A suspended context's clock does not advance, so Emscripten stops asking for
buffers and Emscripten's own starvation warning never fires. A continuity
assertion over the whole run would therefore fail in Firefox and pass in Chrome
for a reason that has nothing to do with the game. So the window starts at the
first keydown with `event.isTrusted` — the same event
`autoResumeAudioContext()` resumes on — watched from inside the page, and
cross-checked (**A3**) against the driver's own wall-clock stamp for its first
`key:` step: 49 ms apart in Chrome, 3 ms in Firefox.

The checker prints the unwindowed figure next to the windowed one and, when
they differ, says so explicitly:

```
note  the UNWINDOWED worst gap is 6078ms. That is the suspended AudioContext before the
      first trusted key press, not a defect, and it is exactly why A8 is measured over the
      window. This same check applied to the whole run would fail here.
```

### No assertion counts log lines

`eSound.cpp` gives each diagnostic class **16 lines** and then falls silent for
the rest of the run: `se_wavFailureBudget`, `se_wavSuccessBudget`,
`se_wavRetireBudget`, `se_peakBudget`, `se_limiterBudget`. A gate that measured
anything by counting `[WAV]` lines could pass *because a line stopped
printing*. So:

- the PCM measurement is a single JSON payload from the in-page probe, which no
  budget can reach;
- every log-line check is "must appear" or "must not appear at all" — both fail
  safe, because the budget prints the **first** 16 of a class, so a class with
  zero lines really did have zero events;
- and **A14 fails outright if any class reaches 16**, because past that point
  the log is a lower bound and nothing counted off it means what it says.

In a passing run nothing is near the cap (5 successes, 0 failures, 1 retire,
1 peak, 0 limiter). In the negative control two classes *are* spent, and A14
fails accordingly — which is the check doing its job, not noise.

## What each screenshot shows, and what it does not

| file | what is in the frame |
|---|---|
| `01-language-menu` | the language menu, first thing after Play |
| `02-welcome-message` | "Welcome to Armagetron Advanced!" (Enter chose a language, Escape accepted the First Setup defaults) |
| `03/04/05-roundN-driving` | 5.5 s into each round: the round banner (`Go (round N of 3)!`), the AI roster messages, the grid, and a first-use hint |
| `06-after-the-match` | the post-match screen — the match ended at three rounds, which `SP_LIMIT_ROUNDS`' shipped default of 10 would not have done |
| `07-after-deliberate-uncaught-error` | the page AFTER the script deliberately throws. The red failure banner is `web/shell.html` doing its job and is **expected in this shot only** |

**The cockpit HUD is not in any of the driving shots, and that is not a
finding.** Its first draw within a round varies run to run, which M2 already
recorded (`docs/evidence/m2-gate/README.md`, on Firefox's `04`). That was
checked here rather than assumed, because "it varies" is exactly the sort of
thing that gets said instead of measured: M2's **own** gate script was re-run
unmodified against this same M3 build, and the three
`m2-gate-rerun-roundN-*.png` files in this directory are its driving shots at
the same 5.5 s offset — **no cockpit in round 1, cockpit in round 2, no cockpit
in round 3**. Same script, same build, same offset, different answer per round.

That re-run also passes M2's checker unchanged (`m2-gate-rerun-console.log`):

```
node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m3-audio/m2-gate-rerun-console.log
-> ALL CHECKS PASSED
   3 rounds completed, ai_team roster = 3 in all three,
   frames-per-second median 60 / minimum 52 over 39.61 s,
   0 non-zero glGetError out of 126 polls
```

So M3's audio work has not regressed anything M2 measured. That is a byproduct
of chasing the missing HUD, and it is worth more than the HUD was.

Nothing in `01`–`06` is staged or edited. `07` is a deliberate fault.

## The two controls inside every run

Both are in the transcript itself, after the run:

1. **`[AUDIOCONTROL] all-zero=>[0,0] three-non-zero=>[32767,3]`** — the probe's
   own scanner, the same function it calls per buffer, run over two hand-made
   arrays whose answers are fixed before the run starts (**A18**). It proves
   the code that reported "853 non-zero buffers" answers 0 for silence. It
   proves nothing about the pipeline: a build whose mix never wrote a sample
   would print this line unchanged. That is what control 2 above is for.
2. **A deliberate uncaught `TypeError`** — reported as `[EXCEPTION]` by both
   engines (**A19**), which is what makes "no `[EXCEPTION]` during the run" an
   observation rather than a silence. M1's Firefox transcript was read as clean
   when it was merely deaf (`docs/porting/browser-runtime-notes.md` section 9).

## The caveats, in full

- **`pushAudio` is upstream of the Web Audio graph.** Repeated because it is
  the caveat most likely to be dropped when this is quoted.
- **Chrome runs with `--mute-audio` and Firefox headless.** The output end is
  deliberately silent in both. Nothing here could have been heard even in
  principle.
- **This is the tutorial match.** The gate drives a first-time visitor's path
  unmodified, so `welcome()` temporarily changes six settings for it — see
  `docs/evidence/m2-gate/README.md`. It does not touch `numAIs` or
  `limitRounds`, and no audio figure here depends on any of the six, but a
  busier arena would mix more voices.
- **The voice limiter never engages in the shipped configuration.** `[SND] live
  voices peaked at 9 (SOUND_SOURCES 10, loudness_thresh 0.0000)` in every run
  here. One voice of margin. Raising `SP_NUM_AIS`, or a player lowering
  `SOUND_SOURCES` in the sound menu, crosses it — and changes what this gate
  measures. If you change the AI count, you have changed the experiment.
- **`0.5` and `1000` are separation bars, not quality bars.** They sit far
  below both engines (0.835/0.838 and 5467/5145) and far above the negative
  control (0 and 0). They are set to tell sound from silence, not to pin down a
  level nobody has judged.
- **One run per engine.** The peak varies run to run — M3 task 2 measured 5349
  and then 4593 on the same build — so treat it as a scale, not a constant.
  What has been stable across every run taken is the shape: the windowed
  fraction is 0.835 and 0.838 here (task 2 measured 0.862 and 0.858 over a
  wider, unwindowed span, so those figures are not directly comparable), and
  the per-round fraction is 1.000 everywhere it has been measured.
- **The device runs at 48000 Hz while `SDL.audio.freq` is 22050**, so Web Audio
  resamples every buffer. Nothing here depends on it; it is noted so a future
  reader comparing sample rates is not surprised.
