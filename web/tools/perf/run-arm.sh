#!/bin/sh
# sh web/tools/perf/run-arm.sh <set-dir> <arm> <cpu-rate> '<autoexec lines, \\n-separated>' [template]
# e.g. sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig base 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
#
# Runs ONE arm and refuses to call it a number until it has proved itself.
# Drives the shipped web/dist-m1 client in headed Chrome at a phone's geometry,
# clears the tutorial with two real key presses, throttles the CPU, measures
# rounds 2 and 3, prints the [PERF] line, and exits with check-arm.mjs's
# status: 0 only for VALID. Run it from the repository root. Read README.md.
#
# Serves nothing. Start the static server first:
#   python3 -m http.server ${AA_PERF_PORT:-8006} --directory web/dist-m1 &
# AA_PERF_PORT defaults to 8006. The M6 plan wrote 8000, but on the machine
# this was developed on 8000 is another worktree's server with a DIFFERENT
# build behind it; measuring that would be measuring the wrong binary.
#
# Outputs, all under <set-dir>:
#   <arm>/steps.txt      the driver script this arm actually ran
#   <arm>/console.log    the transcript; the LAST "[PERF] <arm> {...}" is the result
#   <arm>/*.png          screenshots; r?-30s/r?-50s.png are the trail-geometry proof
#   <arm>-driver.txt     drive-browser.mjs's stdout/stderr
#
# MEASUREMENT HYGIENE, checked here because it was violated once: no other
# drive-browser.mjs may be running (two Chromes on devtools port 9222 collide,
# and any browser automation on the box steals the CPU the throttle is
# metering), and the 1-minute load average must be low. A number taken on a
# loaded machine measures the load, not the game. Set AA_PERF_MAXLOAD to raise
# the ceiling knowingly; the default 6 is where a rate-6 throttle stops being
# the dominant slowdown on this 8-core desktop.
#
# SP_SIZE_FACTOR IS HARNESS SETUP, NOT A LEVER, and belongs in every arm. At
# the shipped -3 (gGame.cpp, exponent(i)=2^(i/2), so a 0.35x arena) a round is
# over in EIGHT SECONDS -- measured -- because the AIs run out of room almost
# at once, and eight seconds of wall accumulation cannot show a growth curve of
# any shape. 3 gives a 2.83x arena and 25 s rounds; 6 gives 8x and 47-60 s. It
# raises total wall per round, which is conservative for the question being
# asked: any growth seen is real growth.
#
# THE 4TH ARGUMENT'S \\n IS LOAD-BEARING. The config text lands inside a
# JavaScript string literal in a one-line eval: step, so each line break has to
# arrive there as the two characters \ and n. The seed script used sed, whose
# replacement text turns \\ into \, so callers wrote \\n -- and a single \n
# there became a real newline, split the eval across lines and made the driver
# report `unknown step: SP_SIZE_FACTOR 6` (measured, on the first sweep). This
# script keeps that interface: it performs sed's one unescape (\\ -> \) itself,
# then substitutes LITERALLY (awk index/substr over ENVIRON, never gsub over
# -v: gsub reads & in the replacement as "the match" and the sampler contains
# &&; -v runs escape processing and would eat the backslash). So both \\n and
# \n are accepted; a real newline is refused by the line-count tripwire, and a
# surviving \\ -- which would reach autoexec.cfg as the two characters \n on
# one line, silently -- is refused by the next one. The tripwires exist because
# the first sweep's steps files looked right and were not.
set -e
SET=$1; ARM=$2; RATE=$3
CFG=$(printf '%s' "$4" | sed 's/\\\\/\\/g')
D=$(dirname "$0"); TMPL=${5:-$D/arm.steps.tmpl}
[ -n "$CFG" ] || { echo "usage: $0 <set-dir> <arm> <cpu-rate> '<autoexec lines>' [template]" >&2; exit 2; }
[ -f "$TMPL" ] || { echo "no template at $TMPL" >&2; exit 2; }
case $RATE in ''|*[!0-9.]*) echo "cpu-rate must be a number >= 1, got '$RATE'" >&2; exit 2;; esac
PORT=${AA_PERF_PORT:-8006}
URL="http://localhost:$PORT/armagetronad.html?autostart=0&touch=1"
OUT="$SET/$ARM"; mkdir -p "$OUT"

# ---- substitute ---------------------------------------------------------
AA_S=$(tr -d '\n' < "$D/sampler.js") AA_R=$(tr -d '\n' < "$D/report.js") \
AA_C=$CFG AA_T=$ARM AA_P=$RATE \
awk '
  function repl(line, key, val,    i, out) {
    out = ""
    while ((i = index(line, key)) > 0) {
      out = out substr(line, 1, i - 1) val
      line = substr(line, i + length(key))
    }
    return out line
  }
  /^#/ { print; next }
  { l = $0
    l = repl(l, "SAMPLER", ENVIRON["AA_S"]); l = repl(l, "REPORT", ENVIRON["AA_R"])
    l = repl(l, "CONFIGLINES", ENVIRON["AA_C"]); l = repl(l, "TAGHERE", ENVIRON["AA_T"])
    l = repl(l, "CPURATE", ENVIRON["AA_P"])
    print l }
' "$TMPL" > "$OUT/steps.txt"

# ---- tripwires on the generated script -----------------------------------
fail() { echo "run-arm.sh: $1" >&2; exit 3; }
[ "$(wc -l < "$TMPL")" -eq "$(wc -l < "$OUT/steps.txt")" ] \
  || fail "substitution changed the line count: a value contained a real newline"
grep -q 'S\.cur\.draws++' "$OUT/steps.txt" || fail "sampler mangled: S.cur.draws++ missing from steps.txt"
grep -q '\[PERF\] '"$ARM"' ' "$OUT/steps.txt" || fail "report mangled: [PERF] $ARM missing from steps.txt"
if grep -v '^#' "$OUT/steps.txt" | grep -q 'SAMPLER\|REPORT\|CONFIGLINES\|TAGHERE\|CPURATE'; then
  fail "a placeholder survived substitution in $OUT/steps.txt"
fi
grep -q 'MAX_FPS 1000' "$OUT/steps.txt" || fail "MAX_FPS 1000 is not in the arm (template broken)"
grep -qF '\\' "$OUT/steps.txt" && fail "a double backslash survived into steps.txt; the config would reach autoexec.cfg as literal \\n text"
grep -v '^#' "$OUT/steps.txt" | grep '^eval:' | sed -e 's/^eval://' | while IFS= read -r expr; do
  printf '%s\n' "$expr" | node --check - 2>/dev/null || { echo "$expr" | cut -c1-80; exit 9; }
done || fail "an eval: step is not valid JavaScript (shown above)"
[ -n "$AA_PERF_DRY" ] && { echo "dry run: wrote $OUT/steps.txt"; exit 0; }

# ---- hygiene -------------------------------------------------------------
if pgrep -f drive-browser.mjs >/dev/null 2>&1; then
  fail "another drive-browser.mjs is running; a measurement beside it is invalid. Wait for it."
fi
LOAD1=$(uptime | sed -e 's/.*load averages*: *//' -e 's/[, ].*//')
MAXLOAD=${AA_PERF_MAXLOAD:-6}
if awk -v l="$LOAD1" -v m="$MAXLOAD" 'BEGIN { exit !(l + 0 > m + 0) }'; then
  fail "1-minute load average is $LOAD1 (> $MAXLOAD); wait, or set AA_PERF_MAXLOAD knowingly"
fi
curl -sf -o /dev/null "http://localhost:$PORT/armagetronad.html" \
  || fail "nothing serving web/dist-m1 on port $PORT (python3 -m http.server $PORT --directory web/dist-m1 &)"
echo "run-arm.sh: arm=$ARM cpu=$RATE port=$PORT load1=$LOAD1 cfg='$CFG' template=$TMPL"

# ---- drive ---------------------------------------------------------------
node web/tools/drive-browser.mjs --headed --mobile 915,412,3 --out "$OUT" --url "$URL" \
     --script-file "$OUT/steps.txt" > "$SET/$ARM-driver.txt" 2>&1 || true

# ---- report --------------------------------------------------------------
grep -h '\[PERF\] '"$ARM"' {' "$OUT/console.log" | tail -1 | sed -e 's/.*\(\[PERF\] [^{]*{\)/\1/' | cut -c1-200 \
  || echo "$ARM: NO PERF LINE"
node "$D/check-arm.mjs" "$OUT/console.log"
