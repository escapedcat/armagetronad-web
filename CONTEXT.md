# Armagetron Web Port

Port of Armagetron Advanced (real C++ codebase) to the browser via Emscripten/WASM.

**Status: Phase 1 is closed and the Demo is live at
<https://escapedcat.github.io/armagetronad-web/>.** Read that as narrowly as it is
written — publicly reachable and playable, desktop Chrome and Firefox, on one
maintainer's machine — and read `PLAN.md`'s "Phase 1 — closed" section for what is
*not* met before using the word "done" about this project. Phase 2 and Phase 3
remain uncommitted and each needs its own go/no-go.

## Language

**The Demo**:
The project's success deliverable — a hosted web page where anyone can play single-player Armagetron vs AI in the browser. Its envelope: desktop Chrome + Firefox, keyboard required, ≥30 fps on the maintainer's machine. Safari is a non-target (working there is a bonus, never an obligation); mobile is deferred to Phase 3, not part of the Demo. Shipping the Demo is the committed goal; everything else is aspiration.
_Avoid_: the product, the release

**Phase 1**:
All work required to ship the Demo. Ends when the Demo is publicly hosted. **Ended
at M5** — M0 (dedicated server on Node) through M5 (validation, packaging, launch).
Note the ending condition is "publicly hosted", which is met, and is narrower than
"finished": twelve open items are enumerated in `PLAN.md`.
_Avoid_: reading "Phase 1 complete" as "the port is done"

**Phase 2**:
The aspirational multiplayer follow-up (browser clients joining community servers via a bridge). Explicitly *not* committed — it gets its own go/no-go decision after Phase 1 ships.
_Avoid_: treating Phase 2 as part of "done"

**Phase 3 (Touch)**:
Post-Demo phase adding minimal mobile play: a JavaScript overlay in the shell page that synthesizes the game's existing keyboard controls from touch input. No C++ changes by design. Ordered after the Demo ships; independent of Phase 2.

**Upstream**:
The Armagetron Advanced GitLab project this repo is cloned from. Offering the port upstream is a discipline (guarded patches), not a goal.
