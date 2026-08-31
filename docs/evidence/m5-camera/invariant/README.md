# The dedicated build is unchanged, and the check that says so can see

`dedicated-invariant.sh` / `.asrun`. Run from the repo root after
`source deps/emsdk/emsdk_env.sh`.

    web/dist-m0/armagetronad-dedicated.wasm   2,488,298 bytes
                                              md5 9718a2a64978cb6e9b95ea2f0454cca5   PASS
    armagetronad-dedicated.js                 md5 6dd7f84eae1de362e4faf847a5d1b194    unchanged

Forced to relink rather than allowed to short-circuit: `make dedicated` on an
up-to-date tree prints "Nothing to be done" and re-reports yesterday's file,
which is not a measurement of anything.

## Why this one is structural

Task 2b edits `src/emscripten/eCompat.cpp` only, and that file is **not in the
dedicated build at all** — not compiled out of it, absent from it. `eCompat.o`
appears exactly once in `web/Makefile`, in `CLIENT_OBJS`; the dedicated link
line names 100 objects and none of them is it; `web/build-m0/` contains no
object of that name. All three counted in step 1.

That is a stronger position than task 1 was in — it edited `rViewport.cpp`,
which **is** in `$(SRCS)` and therefore in both builds, and had to establish
that the edited region was preprocessed away. Here there is nothing to
substitute in place, because there is nothing there.

## The control, and why it is not task 1's control

Steps 3-5. Determinism first (recompiling the unmodified `nNetwork.cpp` from
its own path reproduces `web/build-m0/network/nNetwork.o` bit for bit,
`c8136745…`), then a negative control (substituting that identical object at
its own position, 32nd of 100, on a link line taken verbatim from `make -n`,
reproduces 2,488,298 / `9718a2a6…`), then the positive control.

**The positive control is deliberately CONSTANT SIZE.** Task 1's appended an
object to the link line and moved the output to 2,488,290 — a different size,
which a size check alone would also have caught, so it proves nothing about the
md5. M4 task 3's finding is that this project's byte-size invariant could not
detect its own change; the control has to speak to that.

So step 5 changes **one character inside a 23-character string literal**
(`"Connektion kill request"` → `"…requesT"`, `nNetwork.cpp`, one occurrence in
the wasm), edited in place and restored, so the object differs from step 3's by
that byte and nothing else — same path, same basename, same flags, same
position on the link line.

    control object md5   62e019647b26e3c234c29102ca7dbd9e   (vs c8136745… unmodified)
    linked output        2,488,298 bytes   md5 8e3f17e94014052f9a2f13f94fce4573

    size : 2,488,298 — IDENTICAL. The size check is blind to this.
    md5  : 8e3f17e9… vs 9718a2a6… — caught it.

**The md5 half of the invariant is load-bearing and the size half, on its own,
is not.** Anyone tempted to drop the md5 from this check should read that
table first.

Step 6 rebuilds the restored tree and re-reports 2,488,298 / `9718a2a6…`, so
the run leaves the working tree and the artefact where it found them.
