#!/bin/sh
# What a visitor actually downloads from GitHub Pages, measured against the
# deployed site rather than inferred from local gzip.
#
# THE QUESTION THIS EXISTS TO ANSWER. M5's recon could not establish whether
# the Pages edge compresses a file as large as our wasm: the largest
# compressible asset it could find on any *.github.io host was 2.2 MB. Ours is
# 4,331,548 B. If the edge gives up above some threshold, the Demo costs a
# visitor ~5.1 MiB instead of ~1.6 MiB. It does not give up -- see the .asrun
# transcript beside this script.
#
# WHY IT DOES NOT TRUST `curl -I`. A HEAD response's content-length is a claim
# about a body that was never sent. Every row below is measured from a real GET
# with curl's %{size_download}, which for a hand-set `Accept-Encoding: gzip` is
# the number of bytes that came off the wire, because curl only auto-decodes
# when it set the header itself (--compressed). The gzip body is then gunzipped
# and compared byte-for-byte against the local build, so the row also proves the
# edge's compression is lossless and that the deployed file IS the built file.
#
# Usage:  sh docs/evidence/m5-deploy/measure-wire.sh [base-url] [dist-dir]
set -eu
URL=${1:-https://escapedcat.github.io/armagetronad-web}
DIST=${2:-web/dist-m1}
TMP=$(mktemp -d)

echo "url  = $URL"
echo "dist = $DIST"
echo "date = $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

printf '%-20s %10s %10s %8s  %-38s %-6s %s\n' \
       file identity wire ratio content-type enc "matches local build"
tot_id=0; tot_wire=0
for f in index.html armagetronad.html armagetronad.js armagetronad.wasm armagetronad.data; do
  id=$(curl -s -o "$TMP/id" -w '%{size_download}' "$URL/$f")
  ct=$(curl -sI "$URL/$f" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
  wire=$(curl -s -H 'Accept-Encoding: gzip' -o "$TMP/gz" -w '%{size_download}' "$URL/$f")
  enc=$(curl -sI -H 'Accept-Encoding: gzip' "$URL/$f" | tr -d '\r' \
        | awk -F': ' 'tolower($1)=="content-encoding"{print $2}')
  gunzip -c "$TMP/gz" > "$TMP/ungz" 2>/dev/null || cp "$TMP/gz" "$TMP/ungz"
  if cmp -s "$TMP/ungz" "$DIST/$f" && cmp -s "$TMP/id" "$DIST/$f"; then ok=yes; else ok=NO; fi
  ratio=$(awk -v a="$wire" -v b="$id" 'BEGIN{printf "%.1f%%", 100*a/b}')
  printf '%-20s %10s %10s %8s  %-38s %-6s %s\n' "$f" "$id" "$wire" "$ratio" "$ct" "${enc:-none}" "$ok"
  tot_id=$((tot_id+id)); tot_wire=$((tot_wire+wire))
  if [ "$f" = index.html ]; then idx_id=$id; idx_wire=$wire; fi
done
echo
# The GAME set is the four files the client itself fetches. index.html is the
# site-root redirect: a visitor who pastes the bare Pages URL pays for it too,
# a visitor handed the deep link does not. Both totals are reported because
# neither is "the" download size on its own.
game_id=$((tot_id - idx_id)); game_wire=$((tot_wire - idx_wire))
echo "game set (4 files, no index.html): identity $game_id  wire $game_wire  ($(awk -v a=$game_wire 'BEGIN{printf "%.3f MiB", a/1048576}'))"
echo "all five, i.e. arriving via the bare Pages URL: identity $tot_id  wire $tot_wire  ($(awk -v a=$tot_wire 'BEGIN{printf "%.3f MiB", a/1048576}'))"
echo
echo "--- controls ---"
printf 'brotli only:            '
curl -sI -H 'Accept-Encoding: br' "$URL/armagetronad.wasm" | tr -d '\r' \
  | awk -F': ' 'tolower($1)=="content-encoding"{print "content-encoding: " $2; f=1} END{if(!f) print "no content-encoding (identity)"}'
printf 'what a browser sends:   '
curl -sI -H 'Accept-Encoding: gzip, deflate, br, zstd' "$URL/armagetronad.wasm" | tr -d '\r' \
  | awk -F': ' 'tolower($1)=="content-encoding"{print "content-encoding: " $2}'
printf 'site root:              '
curl -sI "$URL/" | tr -d '\r' | awk 'NR==1||tolower($0)~/^content-type/{printf "%s ", $0} END{print ""}'
# Negative control, and it has to assert on Content-Type, not on status: a
# missing file on Pages is a 404 whose body is HTML, so a check that only
# looked for "an html page" would pass on a name that does not exist.
printf 'missing file (control):  '
curl -sI "$URL/armagetronad.wasmx" | tr -d '\r' | awk 'NR==1||tolower($0)~/^content-type/{printf "%s ", $0} END{print ""}'
rm -rf "$TMP"
