#!/bin/sh
# Record what the PUBLIC deployment actually puts on the wire, as JSON, so the
# facts can be checked by a program instead of read out of a table by a person.
#
#   sh web/tools/wire-facts.sh [base-url] [dist-dir] > wire-facts.json
#   node docs/evidence/m5-launch/check-wire-facts.mjs wire-facts.json
#
# RELATION TO docs/evidence/m5-deploy/measure-wire.sh. That script answered M5
# task 4's open question -- does the Pages edge gzip a 4 MB file -- and prints a
# human table. This one exists because a table is not a gate: nothing about it
# can be re-run to a pass/fail verdict, and nothing about it can be shown to be
# capable of failing. Same measurement technique, machine-readable output, and
# a checker and a prover beside it.
#
# HOW THE NUMBERS ARE TAKEN, AND WHY NOT `curl -I`. A HEAD response's
# content-length is a claim about a body nobody sent. Every size here is
# %{size_download} from a REAL GET, and the headers come from `-D` on that same
# response, so the header block and the byte count describe one exchange rather
# than two. curl only auto-decodes when it set Accept-Encoding itself
# (--compressed), so with the header set by hand %{size_download} is the count
# of bytes that came off the wire.
#
# TWO FETCHES PER FILE, ON PURPOSE. One with no Accept-Encoding at all (the
# identity body) and one with `Accept-Encoding: gzip`. The gzip body is
# gunzipped and hashed, so the pair also witnesses that the edge's compression
# is lossless -- a wire number for a body that did not decode to the artefact
# would be worthless.
#
# THE NEGATIVE CONTROL HAS A TRAP AND IT IS RECORDED HERE, NOT INTERPRETED.
# A missing file on GitHub Pages is a 404 whose body is an HTML error page.
# So a control that asserted "the bogus name did not return 200" would pass on
# a server that had never heard of wasm, and a control that asserted "the body
# is HTML" would pass for the wrong reason. This script records the bogus
# name's status AND its content-type; check-wire-facts.mjs asserts on the
# content-type.
set -eu

URL=${1:-https://escapedcat.github.io/armagetronad-web}
DIST=${2:-web/dist-m1}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Values that reach the JSON. Pages sends no quotes or backslashes in any of
# these headers, but a header is remote input, so strip both rather than trust.
j() { printf '%s' "$1" | tr -d '"\\' | tr -d '\n'; }

hdr() { # hdr <file> <name>  -- last occurrence wins, value lowercased name match
  tr -d '\r' < "$1" | awk -F': ' -v n="$2" 'tolower($1)==n{v=$2} END{print v}'
}

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

FILES='armagetronad.html armagetronad.js armagetronad.wasm armagetronad.data'
EXTRA='index.html'

printf '{\n'
printf '  "url": "%s",\n' "$(j "$URL")"
printf '  "dist": "%s",\n' "$(j "$DIST")"
printf '  "measured_utc": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '  "curl": "%s",\n' "$(j "$(curl --version | head -1)")"
printf '  "files": {\n'

first=1
for f in $FILES $EXTRA; do
  [ $first -eq 1 ] || printf ',\n'
  first=0

  id_bytes=$(curl -s -D "$TMP/hid" -o "$TMP/id" -w '%{size_download}' "$URL/$f")
  id_code=$(tr -d '\r' < "$TMP/hid" | awk 'NR==1{print $2}')
  id_ct=$(hdr "$TMP/hid" content-type)

  gz_bytes=$(curl -s -H 'Accept-Encoding: gzip' -D "$TMP/hgz" -o "$TMP/gz" \
                  -w '%{size_download}' "$URL/$f")
  gz_code=$(tr -d '\r' < "$TMP/hgz" | awk 'NR==1{print $2}')
  gz_ct=$(hdr "$TMP/hgz" content-type)
  gz_enc=$(hdr "$TMP/hgz" content-encoding)
  gz_vary=$(hdr "$TMP/hgz" vary)

  if gunzip -c "$TMP/gz" > "$TMP/ungz" 2>/dev/null; then decoded=true
  else cp "$TMP/gz" "$TMP/ungz"; decoded=false; fi

  # WHERE THE LOCAL COPY LIVES, and why this is not just "$DIST/$f".
  # Four of these five files are build outputs and land in $DIST. index.html is
  # NOT built: web/Makefile never emits it, and the only thing that puts it in
  # $DIST is the `cp` at the front of `npm run deploy`. So after a clean
  # rebuild -- the exact state the M5 plan's exit step asks for -- $DIST holds
  # no index.html and W7 fails on a deployment that is perfectly healthy. It
  # was reading a side effect of the last deploy, not a property of the build.
  # Fall back to the source of truth that `cp` copies FROM, and record which
  # path was used so the JSON says what was compared rather than implying it.
  local_path=$DIST/$f
  [ -f "$local_path" ] || [ "$f" != index.html ] || local_path=web/$f

  if [ -f "$local_path" ]; then
    local_bytes=$(wc -c < "$local_path" | tr -d ' ')
    local_sha=\"$(sha "$local_path")\"
    local_path_j=\"$(j "$local_path")\"
  else
    local_bytes=null
    local_sha=null
    local_path_j=null
  fi

  printf '    "%s": {\n' "$(j "$f")"
  printf '      "identity_status": %s,\n'        "$id_code"
  printf '      "identity_bytes": %s,\n'         "$id_bytes"
  printf '      "identity_content_type": "%s",\n' "$(j "$id_ct")"
  printf '      "identity_sha256": "%s",\n'      "$(sha "$TMP/id")"
  printf '      "gzip_status": %s,\n'            "$gz_code"
  printf '      "wire_bytes": %s,\n'             "$gz_bytes"
  printf '      "content_type": "%s",\n'         "$(j "$gz_ct")"
  printf '      "content_encoding": "%s",\n'     "$(j "${gz_enc:-}")"
  printf '      "vary": "%s",\n'                 "$(j "${gz_vary:-}")"
  printf '      "gunzip_ok": %s,\n'              "$decoded"
  printf '      "decoded_bytes": %s,\n'          "$(wc -c < "$TMP/ungz" | tr -d ' ')"
  printf '      "decoded_sha256": "%s",\n'       "$(sha "$TMP/ungz")"
  printf '      "local_bytes": %s,\n'            "$local_bytes"
  printf '      "local_path": %s,\n'             "$local_path_j"
  printf '      "local_sha256": %s\n'            "$local_sha"
  printf '    }'
done
printf '\n  },\n'

# ---- controls, all three from real GETs like everything above ----
printf '  "controls": {\n'

# 1. the bogus name. Status AND content-type, because the status is 404 either
#    way and the body is HTML either way; only the content-type separates
#    "the edge served our wasm" from "the edge served its error page".
bogus_bytes=$(curl -s -D "$TMP/h404" -o /dev/null -w '%{size_download}' "$URL/armagetronad.wasmx")
printf '    "missing_file": { "name": "armagetronad.wasmx", "status": %s, "content_type": "%s", "bytes": %s },\n' \
  "$(tr -d '\r' < "$TMP/h404" | awk 'NR==1{print $2}')" \
  "$(j "$(hdr "$TMP/h404" content-type)")" "$bogus_bytes"

# 2. brotli alone. Recon said Pages serves gzip only; this re-measures it at
#    4.3 MB rather than carrying the finding forward on trust.
curl -s -H 'Accept-Encoding: br' -D "$TMP/hbr" -o /dev/null "$URL/armagetronad.wasm"
printf '    "brotli_only_encoding": "%s",\n' "$(j "$(hdr "$TMP/hbr" content-encoding)")"

# 3. what a browser really sends.
curl -s -H 'Accept-Encoding: gzip, deflate, br, zstd' -D "$TMP/hbrowser" -o /dev/null "$URL/armagetronad.wasm"
printf '    "browser_accept_encoding_result": "%s",\n' "$(j "$(hdr "$TMP/hbrowser" content-encoding)")"

# 4. the site root a visitor is handed.
curl -s -D "$TMP/hroot" -o /dev/null "$URL/"
printf '    "site_root": { "status": %s, "content_type": "%s" }\n' \
  "$(tr -d '\r' < "$TMP/hroot" | awk 'NR==1{print $2}')" \
  "$(j "$(hdr "$TMP/hroot" content-type)")"

printf '  }\n'
printf '}\n'
