#!/bin/bash
# M5 task 2b: the dedicated wasm must still be 2,488,298 bytes AND md5
# 9718a2a64978cb6e9b95ea2f0454cca5. SIZE ALONE IS NOT SUFFICIENT -- M4 task 3
# found this project's byte-size invariant could not detect its own change --
# so the last step here is a control that proves the md5 half has detection
# power the size half does not.
#
# Run from the repo root, after `source deps/emsdk/emsdk_env.sh`.
#
# STEP 4 IS THE ONE THAT MATTERS AND IT IS DELIBERATELY A CONSTANT-SIZE
# PERTURBATION. Task 1's positive control APPENDED an object to the link line
# and got 2,488,290 / bde6d26b -- a different size, so a size check alone would
# have caught it too, and it therefore says nothing about whether the md5 is
# load-bearing. This one changes ONE CHARACTER inside a 23-character string
# literal, so the output cannot change size, and only the md5 can see it.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

WASM=web/dist-m0/armagetronad-dedicated.wasm
WANT_BYTES=2488298
WANT_MD5=9718a2a64978cb6e9b95ea2f0454cca5
SRC=src/network/nNetwork.cpp
OBJ=web/build-m0/network/nNetwork.o
CTL=$(mktemp -d)
trap 'rm -rf "$CTL"' EXIT

sz() { if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi; }
m5() { if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi; }

CXXFLAGS="-std=gnu++14 -O2 -MMD -MP -fexceptions -I src/emscripten -I deps/build/libxml2-install/include/libxml2 -iquote src -iquote src/tools -iquote src/network -iquote src/render -iquote src/ui -iquote src/engine -iquote src/tron -iquote src/thirdparty/binreloc -iquote src/thirdparty/particles"

echo "=== 1. STRUCTURAL: is eCompat anywhere near the dedicated build? ==="
echo "    eCompat on the dedicated link line : $(make -n -f web/Makefile dedicated 2>/dev/null | grep -c eCompat)  (want 0)"
echo "    eCompat objects under web/build-m0 : $(find web/build-m0 -name '*eCompat*' | wc -l | tr -d ' ')  (want 0)"
echo "    web/Makefile names eCompat.o in    : $(grep -n 'eCompat.o' web/Makefile | tr '\n' ' ')"
echo

echo "=== 2. THE INVARIANT, forced to actually relink ==="
touch "$SRC"
# The link line, taken verbatim from make, with only -o redirected later.
# CAPTURED HERE, BEFORE the build: once the target is up to date `make -n`
# prints "Nothing to be done" and this comes back EMPTY, which makes every
# control below link nothing and report a silent pass-shaped failure.
LINK=$(make -n -f web/Makefile dedicated 2>/dev/null | grep -- '-o web/dist-m0/armagetronad-dedicated.js')
[ -n "$LINK" ] || { echo "FAILED to capture the link line"; exit 1; }
make -f web/Makefile dedicated >/dev/null 2>&1 || { echo "BUILD FAILED"; exit 1; }
B=$(sz "$WASM"); M=$(m5 "$WASM")
echo "    $WASM"
echo "    bytes $B  (want $WANT_BYTES)   $([ "$B" = "$WANT_BYTES" ] && echo PASS || echo FAIL)"
echo "    md5   $M"
echo "          (want $WANT_MD5)   $([ "$M" = "$WANT_MD5" ] && echo PASS || echo FAIL)"
echo "    js md5 $(m5 web/dist-m0/armagetronad-dedicated.js)"
echo

# Everything below substitutes ONE object at ITS OWN POSITION on $LINK and
# changes nothing else -- no appending, no reordering.

echo "=== 3. DETERMINISM, so an object comparison means anything ==="
em++ $CXXFLAGS -c "$SRC" -o "$CTL/nNetwork.o" 2>/dev/null || { echo "COMPILE FAILED"; exit 1; }
echo "    $OBJ                 $(m5 "$OBJ")"
echo "    recompiled, unmodified, same path  $(m5 "$CTL/nNetwork.o")"
echo "    $([ "$(m5 "$OBJ")" = "$(m5 "$CTL/nNetwork.o")" ] && echo 'PASS  identical' || echo 'FAIL  not reproducible')"
echo

echo "=== 4. NEGATIVE CONTROL: substitute that identical object in place ==="
CMD=$(echo "$LINK" | sed "s#$OBJ#$CTL/nNetwork.o#; s#-o web/dist-m0/armagetronad-dedicated.js#-o $CTL/neg.js#")
eval "$CMD" || { echo "LINK FAILED"; exit 1; }
B=$(sz "$CTL/neg.wasm"); M=$(m5 "$CTL/neg.wasm")
echo "    bytes $B   md5 $M"
echo "    $([ "$B" = "$WANT_BYTES" ] && [ "$M" = "$WANT_MD5" ] && echo 'PASS  reproduces the shipped artefact exactly' || echo 'FAIL')"
echo

echo "=== 5. POSITIVE CONTROL: one character, same length, same position ==="
echo "    $SRC : \"Connektion kill request\" -> \"Connektion kill requesT\""
echo "    (23 characters either way; one occurrence in the wasm)"
cp "$SRC" "$CTL/nNetwork.cpp.orig"
# Edited IN PLACE and restored, so the compile sees the identical path as well
# as the identical basename: the only difference between this object and the
# one in step 3 is that single byte.
sed -i.bak 's/"Connektion kill request"/"Connektion kill requesT"/' "$SRC"
DIFFLINES=$(diff "$CTL/nNetwork.cpp.orig" "$SRC" | grep -c '^[<>]')
em++ $CXXFLAGS -c "$SRC" -o "$CTL/nNetwork-ctl.o" 2>/dev/null
RC=$?
cp "$CTL/nNetwork.cpp.orig" "$SRC"; rm -f "$SRC.bak"
[ "$RC" = 0 ] || { echo "COMPILE FAILED"; exit 1; }
echo "    changed lines: $DIFFLINES (want 2: one - one +)   source restored: $(diff -q "$CTL/nNetwork.cpp.orig" "$SRC" >/dev/null && echo yes || echo NO)"
echo "    control object md5 $(m5 "$CTL/nNetwork-ctl.o")  vs unmodified $(m5 "$CTL/nNetwork.o")"
CMD=$(echo "$LINK" | sed "s#$OBJ#$CTL/nNetwork-ctl.o#; s#-o web/dist-m0/armagetronad-dedicated.js#-o $CTL/pos.js#")
eval "$CMD" || { echo "LINK FAILED"; exit 1; }
B=$(sz "$CTL/pos.wasm"); M=$(m5 "$CTL/pos.wasm")
echo "    bytes $B   md5 $M"
echo "    size  check: $([ "$B" = "$WANT_BYTES" ] && echo 'SAME -- BLIND to this change' || echo "moved to $B")"
echo "    md5   check: $([ "$M" != "$WANT_MD5" ] && echo 'DIFFERENT -- caught it' || echo 'FAIL, md5 did not move')"
echo
echo "    Verdict: $( [ "$B" = "$WANT_BYTES" ] && [ "$M" != "$WANT_MD5" ] && echo 'the md5 half of the invariant is load-bearing; size alone is not' || echo 'see above' )"
echo

echo "=== 6. TREE RESTORED, invariant re-checked ==="
make -f web/Makefile dedicated >/dev/null 2>&1
echo "    bytes $(sz "$WASM")   md5 $(m5 "$WASM")"
echo "    $([ "$(sz "$WASM")" = "$WANT_BYTES" ] && [ "$(m5 "$WASM")" = "$WANT_MD5" ] && echo PASS || echo FAIL)"
