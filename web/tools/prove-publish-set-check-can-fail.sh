#!/bin/sh
# Prove web/tools/check-publish-set.mjs can fail, and fail for the right
# reason -- by SET EQUALITY, the standard this project's provers hold to: a
# case is green only when the observed failure set EQUALS what it declared.
#
#     sh web/tools/prove-publish-set-check-can-fail.sh
#
# Every case runs against a scratch copy of the release set built with
# `--list`, so this never touches web/dist-m1 and never needs a build. The
# baseline case is what makes the others mean something: if an empty rig did
# not pass, "the mutation failed it" would be worth nothing.
#
# The two stray cases are not decoration. Case 2 replays the exact defect that
# is live on gh-pages today (a probe BUILD published beside the release), and
# case 3 replays what the texture work left in dist-m1 (a generated PAGE). The
# checker treats both identically, which is the point: it enumerates rather
# than pattern-matching on a name shape.
set -eu

HERE=$(dirname "$0")
CHECK=$HERE/check-publish-set.mjs
RIG=$(mktemp -d)
trap 'rm -rf "$RIG"' EXIT

PASS=0
FAIL=0

# rig <dir>  -- lay down exactly the declared release set, one byte each
rig() {
  rm -rf "$1"; mkdir -p "$1"
  node "$CHECK" --list | while read -r n; do printf 'x' > "$1/$n"; done
}

# case <name> <want-exit> <want-substring>
run_case() {
  name=$1; want=$2; needle=$3
  out=$(node "$CHECK" "$RIG/d" 2>&1) && got=0 || got=$?
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -q "$needle"; then
    printf 'ok    %-46s exit %s, matched: %s\n' "$name" "$got" "$needle"
    PASS=$((PASS+1))
  else
    printf 'NOT OK %-45s exit %s (wanted %s), needle %s\n' "$name" "$got" "$want" "$needle"
    printf '%s\n' "$out" | sed 's/^/       | /'
    FAIL=$((FAIL+1))
  fi
}

echo "=== 1. baseline: the declared set alone passes"
rig "$RIG/d"
run_case "clean release set" 0 "PASS  the set equals"

echo
echo "=== 2. a stray probe BUILD -- the defect live on gh-pages today"
rig "$RIG/d"
for e in data html js wasm; do printf 'x' > "$RIG/d/armagetronad-oldyield.$e"; done
run_case "4 stray probe-build files" 1 "armagetronad-oldyield.wasm"

echo
echo "=== 3. a stray generated PAGE -- what the texture work left in dist-m1"
rig "$RIG/d"
printf 'x' > "$RIG/d/aniso-on.html"
run_case "1 stray generated page" 1 "aniso-on.html"

echo
echo "=== 4. a stray hidden in a SUBDIRECTORY (gh-pages -v descends)"
rig "$RIG/d"
mkdir -p "$RIG/d/probes"; printf 'x' > "$RIG/d/probes/res-1920x1080.html"
run_case "stray one level down" 1 "probes/res-1920x1080.html"

echo
echo "=== 5. a stray DOTFILE (gh-pages -v matches '**/.*')"
rig "$RIG/d"
printf 'x' > "$RIG/d/.DS_Store"
run_case "stray dotfile" 1 ".DS_Store"

echo
echo "=== 6. missing release file: index.html, i.e. deploying without the cp"
rig "$RIG/d"
rm "$RIG/d/index.html"
run_case "index.html absent" 1 "release file(s) absent"

echo
echo "=== 7. missing release file: the engine itself"
rig "$RIG/d"
rm "$RIG/d/armagetronad.wasm"
run_case "armagetronad.wasm absent" 1 "armagetronad.wasm"

echo
echo "=== 8. both at once -- the shape a half-cleaned dist takes"
rig "$RIG/d"
rm "$RIG/d/armagetronad.data"; printf 'x' > "$RIG/d/texprobe.html"
out=$(node "$CHECK" "$RIG/d" 2>&1) && got=0 || got=$?
if [ "$got" = 1 ] \
   && printf '%s' "$out" | grep -q 'texprobe.html' \
   && printf '%s' "$out" | grep -q 'armagetronad.data'; then
  echo "ok    stray and missing reported together      exit 1, both named"
  PASS=$((PASS+1))
else
  echo "NOT OK stray and missing reported together     exit $got"
  printf '%s\n' "$out" | sed 's/^/       | /'
  FAIL=$((FAIL+1))
fi

echo
echo "=== 9. a directory that does not exist is exit 2, not a silent pass"
out=$(node "$CHECK" "$RIG/nope" 2>&1) && got=0 || got=$?
if [ "$got" = 2 ]; then
  echo "ok    absent directory                         exit 2"
  PASS=$((PASS+1))
else
  echo "NOT OK absent directory                        exit $got (wanted 2)"
  FAIL=$((FAIL+1))
fi

echo
echo "=== summary"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
echo "EVERY CASE BEHAVED AS DECLARED"
