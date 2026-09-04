#!/bin/sh
# sh web/tools/perf/run-posttut.sh [arm]
#
# The POST-TUTORIAL sweep: the arms of M6 option B, run SERIALLY, each through
# run-arm.sh with web/tools/perf/posttut.steps.tmpl and each judged by
# `check-arm.mjs --posttut`. Run it from the repository root. Read
# web/tools/perf/README.md, the template's header, and
# docs/evidence/m6-lag/task7-posttutorial/README.md first.
#
#   python3 -m http.server ${AA_PERF_PORT:-8006} --directory web/dist-m1 &
#   sh web/tools/perf/run-posttut.sh                 # every arm, in order
#   sh web/tools/perf/run-posttut.sh posttut-base-r1 # exactly one arm
#   sh web/tools/perf/run-posttut.sh --list          # the names, and nothing else
#
# ONE ARM AT A TIME IS THE POINT of the single-arm form: a browser run of this
# length outlives some agent harnesses, so the orchestrator that owns the sweep
# needs to be able to restart it at the arm it stopped on without re-running the
# ones already on disk. Nothing here is idempotent for free -- naming an arm that
# already has a directory OVERWRITES it.
#
# WHY THE ARMS ARE WHAT THEY ARE. All four run at MAX_FPS 1000 (the template) and
# cpu 6 (the default here), so they are comparable with each other and, for the
# ones that share its scene, with Tasks 2 and 4:
#
#   posttut-default  x2  No SP_ override at all: the shipped SP_ defaults, i.e.
#                        whatever config/ and web/webdefaults/autoexec.cfg make
#                        them (SP_SIZE_FACTOR -3 and SP_SPEED_FACTOR 0 from
#                        gGame.cpp:518-524; SP_WALLS_LENGTH -1 from gGame.cpp:219;
#                        SP_NUM_AIS 3, SP_AUTO_AIS 0 and SP_LIMIT_ROUNDS 3 from
#                        web/webdefaults/autoexec.cfg). It is the arm nobody has
#                        ever measured: the client exactly as it ships, on the boot
#                        path the phone uses. Its config line is a COMMENT, because
#                        run-arm.sh requires a non-empty 4th argument and the whole
#                        point of this arm is that it adds nothing.
#                        EXPECT IT TO FAIL THE 30 s SPAN and be reported INVALID:
#                        SP_SIZE_FACTOR -3 is a 0.35x arena (exponent 2^(i/2)) and
#                        SP_SPEED_FACTOR 0 is twice the tutorial's -2, so its rounds
#                        should be far under the 30 s an early-vs-late comparison
#                        needs. That is a RESULT about the shipped configuration,
#                        not a reason to quietly change it: record the round lengths
#                        in the README and leave the shipped values alone.
#   posttut-base     x3  SP_SIZE_FACTOR 6, SP_NUM_AIS 7, SP_WALLS_LENGTH -1 stated
#                        explicitly. The same scene Tasks 2 and 4 measured -- except
#                        that here SP_SIZE_FACTOR really is 6 (welcome() is not
#                        running to subtract 2) and SP_WALLS_LENGTH really is -1,
#                        unlimited trails, instead of being overwritten with 400.
#                        This is the baseline every other post-tutorial number is
#                        read against.
#   posttut-walls150 x3  the same plus SP_WALLS_LENGTH 150 -- option A's cap, as a
#                        direct setting rather than the CYCLE_DIST_WALL_SHRINK pair
#                        Task 4 had to use because welcome() overwrote the setting.
#   posttut-walls400 x2  the same plus SP_WALLS_LENGTH 400 -- the tutorial's own cap,
#                        which is what ties this path back to Tasks 1-4's numbers.
#
# The repeat counts are Task 2's shape, not a guess: three runs is the smallest
# number that shows within-arm spread at all, and the two arms that only bracket
# the question (default, walls400) get two.
#
# HYGIENE, checked before EVERY arm and not just once. run-arm.sh already refuses
# to start beside another drive-browser.mjs; this adds the two neighbours it cannot
# see -- a compiler (em++) and an ORPHANED Chrome from a killed run, which keeps
# devtools port 9222 and a GPU process and is found by its aa-chrome-* profile
# directory (web/tools/perf/README.md, "Measurement hygiene"). Anything found is
# fatal for the whole sweep rather than for one arm: a box that has a stray build
# on it will have one for the next arm too, and a half-measured sweep is worse than
# a stopped one. The bracket in em[+][+] is not decoration -- macOS pgrep rejects
# `em++` as a pattern.
set -u
D=$(dirname "$0")
SET=${AA_PERF_SET:-docs/evidence/m6-lag/task7-posttutorial}
TMPL=$D/posttut.steps.tmpl
CPU=${AA_PERF_CPU:-6}
LOG=$SET/run-log.txt
WANT=${1:-}

DEFAULT_CFG='# posttut-default: no SP_ override -- the shipped SP_ defaults stand'
BASE_CFG='SP_SIZE_FACTOR 6\nSP_NUM_AIS 7\nSP_WALLS_LENGTH -1'
W150_CFG='SP_SIZE_FACTOR 6\nSP_NUM_AIS 7\nSP_WALLS_LENGTH 150'
W400_CFG='SP_SIZE_FACTOR 6\nSP_NUM_AIS 7\nSP_WALLS_LENGTH 400'

ARMS='posttut-default-r1 posttut-default-r2 posttut-base-r1 posttut-base-r2 posttut-base-r3 posttut-walls150-r1 posttut-walls150-r2 posttut-walls150-r3 posttut-walls400-r1 posttut-walls400-r2'
# smoke-posttut-base is the template's own proving run. It is NOT part of the
# sweep -- naming it explicitly is the only way to get it.
EXTRA='smoke-posttut-base'

if [ "$WANT" = "--list" ]; then
  for a in $ARMS; do printf '%s\n' "$a"; done
  for a in $EXTRA; do printf '%s (on request only)\n' "$a"; done
  exit 0
fi
[ -f "$TMPL" ] || { echo "no template at $TMPL (run me from the repository root)" >&2; exit 2; }
if [ -n "$WANT" ]; then
  case " $ARMS $EXTRA " in *" $WANT "*) ;; *)
    echo "unknown arm '$WANT'. Known arms:" >&2
    for a in $ARMS $EXTRA; do printf '  %s\n' "$a" >&2; done
    exit 2;; esac
fi

cfg_for() {
  case $1 in
    posttut-default-*)  printf '%s' "$DEFAULT_CFG" ;;
    posttut-base-*)     printf '%s' "$BASE_CFG" ;;
    smoke-posttut-base) printf '%s' "$BASE_CFG" ;;
    posttut-walls150-*) printf '%s' "$W150_CFG" ;;
    posttut-walls400-*) printf '%s' "$W400_CFG" ;;
    *) echo "cfg_for: no config for '$1'" >&2; exit 2 ;;
  esac
}

mkdir -p "$SET"
rc=0
ran=0

for name in $ARMS $EXTRA; do
  if [ -n "$WANT" ]; then [ "$WANT" = "$name" ] || continue
  else case " $EXTRA " in *" $name "*) continue ;; esac
  fi
  ran=$((ran + 1))

  busy=$(pgrep -fl 'drive-browser[.]mjs|em[+][+] |aa-chrome-' 2>/dev/null || true)
  if [ -n "$busy" ]; then
    echo "run-posttut.sh: REFUSING to start $name -- something of ours is already running:" >&2
    printf '%s\n' "$busy" >&2
    echo "  (a measurement taken beside a build or another driver measures the neighbour.)" >&2
    exit 4
  fi

  cfg=$(cfg_for "$name")
  {
    echo "=================================================================="
    printf '%s  arm=%s cpu=%s port=%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$name" "$CPU" "${AA_PERF_PORT:-8006}"
    printf 'cfg=%s\n' "'$cfg'"
    echo "before: $(uptime)"
  } >> "$LOG"
  printf '\n=== %s (cpu %s) ===\n' "$name" "$CPU"

  # run-arm.sh's own exit status is the DEFAULT gate's, which cannot judge this
  # path (it does not know the tutorial was skipped). It is recorded and then
  # superseded by --posttut below; a non-zero here is not by itself a failure.
  sh "$D/run-arm.sh" "$SET" "$name" "$CPU" "$cfg" "$TMPL"; armrc=$?
  echo "after:  $(uptime)" >> "$LOG"
  echo "run-arm.sh exit (default gate): $armrc" >> "$LOG"

  if [ -f "$SET/$name/console.log" ]; then
    verdict=$(node "$D/check-arm.mjs" --posttut "$SET/$name/console.log" 2>&1); gaterc=$?
  else
    verdict="INVALID [posttut]: no console.log at $SET/$name/console.log (the driver never started?)"; gaterc=1
  fi
  printf '%s\n' "$verdict"
  printf '%s\n' "$verdict" >> "$LOG"
  [ "$gaterc" -eq 0 ] || rc=1
done

[ "$ran" -gt 0 ] || { echo "run-posttut.sh: nothing to run" >&2; exit 2; }
echo
echo "run-posttut.sh: $ran arm(s); overall $([ $rc -eq 0 ] && echo 'all VALID' || echo 'at least one INVALID -- read the verdicts above'); log $LOG"
exit $rc
