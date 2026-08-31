#!/bin/sh
# M5 task 2 step 4 -- measure what -fexceptions actually costs the CLIENT.
#
#   source deps/emsdk/emsdk_env.sh
#   sh docs/evidence/m5-o2-assertions/measure-fexceptions-cost.sh
#
# WHY. PLAN.md quotes -fexceptions at +827,185 bytes in three places. That
# number is real and it is web/Makefile's own, but web/Makefile says in the same
# breath which build it came from: "Rebuilding all 100 translation units with
# EXCEPTIONS empty" -- the M0 DEDICATED build, which has no Asyncify. On the
# client the two multiply, because ASYNCIFY=1 instruments the personality and
# unwind paths -fexceptions adds just as it instruments everything else, so the
# client's cost is several times the dedicated one. PLAN.md's M5 size-budget
# paragraph reads the +827 KB as if it applied to the client. It does not.
#
# HOW. EXCEPTIONS and CLIENT_OBJDIR are both plain `:=` assignments in
# web/Makefile, so a command-line override wins. Overriding CLIENT_OBJDIR keeps
# the real objects in web/build-m1 untouched -- this script cannot damage the
# shipped build. Every compile and link line is taken from `make -n` rather than
# retyped, so the two configurations differ in exactly the one flag.
#
# Two links, because the answer moved this milestone:
#   A  the PRE-task-2 link settings (no -O, no -sASSERTIONS): comparable with
#      the 8,879,522-byte client task 1 left behind, and therefore with the
#      figure M5 recon measured.
#   B  the SHIPPED link settings (-O2 -sASSERTIONS=1): the number that is true
#      of what M5 actually deploys.
set -e
cd "$(dirname "$0")/../../.."
command -v em++ >/dev/null || { echo "em++ not on PATH: source deps/emsdk/emsdk_env.sh" >&2; exit 1; }

OBJDIR=web/build-m1-noexc
OUT=web/build-m1-noexc/dist
mkdir -p "$OUT"

echo "== compiling 102 translation units with EXCEPTIONS empty =="
make -f web/Makefile EXCEPTIONS= CLIENT_OBJDIR="$OBJDIR" -j8 \
     web/dist-m1/armagetronad.html --always-make -n \
  | grep -- '-c src/' > "$OBJDIR/compile-lines.sh"
test "$(wc -l < "$OBJDIR/compile-lines.sh")" -eq 102 || \
  { echo "FATAL: expected 102 compile lines, got $(wc -l < "$OBJDIR/compile-lines.sh")" >&2; exit 1; }
grep -q -- '-fexceptions' "$OBJDIR/compile-lines.sh" && \
  { echo "FATAL: -fexceptions survived the override" >&2; exit 1; }
# mkdir the per-library subdirs the Makefile's own recipe would have made
sed -n 's|.* -o \(.*\)/[^/]*\.o$|\1|p' "$OBJDIR/compile-lines.sh" | sort -u | xargs mkdir -p
# Run them 8-way. NOT via `xargs -I{} sh -c {}`: each em++ line is ~600
# characters and xargs refuses to assemble a command line that long.
rm -f "$OBJDIR"/part_*
# `split -n l/8` is GNU-only; macOS split has no -n. Chunk by line count.
split -l "$(( ($(wc -l < "$OBJDIR/compile-lines.sh") + 7) / 8 ))" \
      "$OBJDIR/compile-lines.sh" "$OBJDIR/part_"
for f in "$OBJDIR"/part_*; do sh "$f" & done; wait

LINK=$(make -f web/Makefile EXCEPTIONS= CLIENT_OBJDIR="$OBJDIR" \
            --always-make -n web/dist-m1/armagetronad.html \
       | grep -E '^em\+\+ .*-o web/dist-m1/armagetronad\.html$')
case "$LINK" in *-fexceptions*) echo "FATAL: -fexceptions on the link line" >&2; exit 1;; esac

echo "== link A: pre-task-2 settings (no -O at link, ASSERTIONS default on) =="
eval "$(printf '%s' "$LINK" | sed -e 's| -O2 -sASSERTIONS=1 | |' \
        -e "s|-o web/dist-m1/armagetronad\.html|-o $OUT/noexc-pretask2.html|")"

echo "== link B: shipped settings (-O2 -sASSERTIONS=1) =="
eval "$(printf '%s' "$LINK" | sed -e "s|-o web/dist-m1/armagetronad\.html|-o $OUT/noexc-shipped.html|")"

echo
echo "== results (wasm bytes) =="
printf '   %-42s %10s\n' 'configuration' 'wasm'
for f in "$OUT/noexc-pretask2.wasm" "$OUT/noexc-shipped.wasm" web/dist-m1/armagetronad.wasm; do
  printf '   %-42s %10d\n' "$f" "$(wc -c < "$f")"
done
echo "   (compare noexc-pretask2 against the 8,879,522-byte client M5 task 1"
echo "    left behind; noexc-shipped against web/dist-m1/armagetronad.wasm above)"

# The throwaway objects are left in $OBJDIR on purpose: the whole point of the
# separate CLIENT_OBJDIR is that a second run is cheap and that nothing here can
# touch web/build-m1. `rm -rf web/build-m1-noexc` when done; it is gitignored.
