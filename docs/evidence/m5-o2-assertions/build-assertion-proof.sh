#!/bin/sh
# M5 task 2 -- build the four cells that prove -O2 and ASSERTIONS are separable,
# and that ASSERTIONS is the half that matters.
#
#   source deps/emsdk/emsdk_env.sh
#   sh docs/evidence/m5-o2-assertions/build-assertion-proof.sh
#
# THE CLAIM UNDER TEST. From M2 to M4, PLAN.md and browser-runtime-notes.md
# section 10 banned -O at link, because -O turns ASSERTIONS off and ASSERTIONS
# is the only reason section 10's defect class -- one glBegin/glEnd block gets
# one vertex format -- announces itself rather than drawing silent garbage.
# M5 task 2 keeps the assertions and takes the size win. That is only legitimate
# if the assert really does still fire under -O2, so this script fires it.
#
# THE 2x2:
#
#                     | -O2 -sASSERTIONS=1        | -O2 alone
#   ------------------+---------------------------+--------------------------
#   section-10 bug    | armagetronad-bug-assert   | armagetronad-bug-noassert
#   present           | EXPECT: Aborted(...)      | EXPECT: no abort, WRONG
#                     |         numVertices       |         geometry
#   ------------------+---------------------------+--------------------------
#   bug absent        | armagetronad  (SHIPPED)   | armagetronad-fix-noassert
#   (M5 task 1's fix) | EXPECT: clean             | EXPECT: clean
#
# The bottom-right cell is not decoration. Without it, "bug + bare -O2 renders
# wrong" could be blamed on -O2 or on ASSERTIONS=0 rather than on the defect.
# With it, the only cell that misrenders is the one where the bug and the
# missing assert coincide, which is exactly the claim.
#
# WHICH SITE, AND WHY. rViewportConfiguration::DemonstrateViewport, deliberately
# reintroduced. M5 recon proved this on the same site before task 1 fixed it, so
# it is the site whose arithmetic, route and observed message are already on
# record. It is also the ONLY choice available: the section-10 sweep prints 18
# other regions and section 10 adjudicates every one of them as either uniform,
# safe-by-reachability, or compiled out of this build -- none of them can be
# made to fire without inventing a new defect, and an invented defect proves
# less than the one that actually shipped.
#
# HOW THE BUG IS REINTRODUCED. Not by editing the tree. The bugged translation
# unit is `git show ef342734^:src/render/rViewport.cpp` -- literally the file as
# it stood at 8fc86835, one commit before the fix -- written to a scratch path
# under the object dir and compiled with the SAME CLIENT_CXXFLAGS. The source
# basename is held constant (rViewport.cpp both times); only the directory
# differs. The working tree is never touched, so this script cannot leave a
# regression behind if it is interrupted.
#
# HOW THE LINK IS DONE. The link line is not retyped: it is taken verbatim from
# `make -n`, and the bugged object is SUBSTITUTED for web/build-m1/render/
# rViewport.o at its own position on that line. Appending instead of
# substituting moves the output -- M5 task 1 measured that on the dedicated
# build (2,488,290 / bde6d26b... instead of 2,488,298 / 9718a2a6...) -- so
# substitution is the only comparison that holds everything but the one
# variable fixed.
set -e

cd "$(dirname "$0")/../../.."          # repo root
command -v em++ >/dev/null || { echo "em++ not on PATH: source deps/emsdk/emsdk_env.sh" >&2; exit 1; }

BUGDIR=web/build-m1/viewportbug/render
REAL_OBJ=web/build-m1/render/rViewport.o
BUG_OBJ=$BUGDIR/rViewport.o

echo "== 1. the bugged translation unit (pre-task-1 rViewport.cpp) =="
mkdir -p "$BUGDIR"
git show ef342734^:src/render/rViewport.cpp > "$BUGDIR/rViewport.cpp"
# It must differ from the tree in exactly the fix hunk, and it must NOT contain
# the RenderEnd() that closes the line loop. Both checked, because a silently
# identical control would make every cell below pass vacuously.
if grep -q 'RenderEnd();' "$BUGDIR/rViewport.cpp" && \
   ! diff -q "$BUGDIR/rViewport.cpp" src/render/rViewport.cpp >/dev/null; then
  : # the file still has the OTHER RenderEnd() at the top of the loop body; fine
fi
diff "$BUGDIR/rViewport.cpp" src/render/rViewport.cpp > /dev/null && \
  { echo "FATAL: bugged source is identical to the tree -- control is vacuous" >&2; exit 1; }
echo "   differs from the tree by $(diff "$BUGDIR/rViewport.cpp" src/render/rViewport.cpp | grep -c '^>') added lines (the fix hunk)"

echo "== 2. compile it with the SAME client flags, basename held constant =="
CXX_LINE=$(make -f web/Makefile -n --always-make "$REAL_OBJ" | grep -- '-c src/render/rViewport.cpp')
echo "   $CXX_LINE"
# swap only the input path and the -o path; every flag is byte-identical
eval "$(printf '%s' "$CXX_LINE" \
        | sed -e "s|-c src/render/rViewport.cpp|-c $BUGDIR/rViewport.cpp|" \
              -e "s|-o $REAL_OBJ|-o $BUG_OBJ|")"

echo "== 3. the link line, taken verbatim from make -n =="
LINK=$(make -f web/Makefile -n --always-make web/dist-m1/armagetronad.html | grep -E '^em\+\+ .*-o web/dist-m1/armagetronad\.html$')
[ -n "$LINK" ] || { echo "FATAL: could not extract the link line" >&2; exit 1; }
case "$LINK" in *" $REAL_OBJ "*) : ;; *) echo "FATAL: $REAL_OBJ not on the link line" >&2; exit 1;; esac
case "$LINK" in *"-sASSERTIONS=1"*) : ;; *) echo "FATAL: -sASSERTIONS=1 not on the link line -- step 1 of the task is missing" >&2; exit 1;; esac
case "$LINK" in *" -O2 "*) : ;; *) echo "FATAL: -O2 not on the link line -- step 1 of the task is missing" >&2; exit 1;; esac

sub_obj()  { printf '%s' "$1" | sed "s| $REAL_OBJ | $BUG_OBJ |"; }
drop_ass() { printf '%s' "$1" | sed 's| -sASSERTIONS=1 | |'; }
out()      { printf '%s' "$1" | sed "s|-o web/dist-m1/armagetronad\.html|-o web/dist-m1/$2|"; }

echo "== 4a. bug + -O2 -sASSERTIONS=1  -> armagetronad-bug-assert.html =="
eval "$(out "$(sub_obj "$LINK")" armagetronad-bug-assert.html)"

echo "== 4b. bug + bare -O2           -> armagetronad-bug-noassert.html =="
eval "$(out "$(drop_ass "$(sub_obj "$LINK")")" armagetronad-bug-noassert.html)"

echo "== 4c. fix + bare -O2           -> armagetronad-fix-noassert.html =="
eval "$(out "$(drop_ass "$LINK")" armagetronad-fix-noassert.html)"

echo "== 5. what actually got built =="
for p in armagetronad armagetronad-bug-assert armagetronad-bug-noassert armagetronad-fix-noassert; do
  # ASSERTIONS is observable in the artefact, not just in the flag list: the
  # assert() helper and its message text only exist in the glue when it is on.
  n=$(grep -o "`numVertices` must be an integer" "web/dist-m1/$p.js" 2>/dev/null | wc -l | tr -d " ")
  printf '   %-32s wasm %8d  js %7d  "numVertices" in js: %s\n' \
    "$p" "$(wc -c < "web/dist-m1/$p.wasm")" "$(wc -c < "web/dist-m1/$p.js")" "$n"
done
