#!/bin/sh
# sh web/tools/fetch-resource-bundle.sh
#
# Rewrites web/resource-bundle/ from web/resource-bundle.txt. Run from the
# repository root. The fetched files are COMMITTED: the build stays offline
# and reproducible, like every other preloaded file.
#
# https: checked 2026-09-30 -- the repository answers 200 over both https and
# http for the same path, so the script uses https.
set -eu
REPO=https://resource.armagetronad.net/resource
LIST=web/resource-bundle.txt
OUT=web/resource-bundle
[ -f "$LIST" ] || { echo "run me from the repository root" >&2; exit 2; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
grep -v '^[[:space:]]*#' "$LIST" | grep -v '^[[:space:]]*$' | while read -r path; do
  case $path in
    /*|*..*|included/*) echo "REFUSING $path: absolute, '..' or under included/" >&2; exit 1;;
  esac
  # reject unversioned paths: <name>-<version>.<ext>.xml
  echo "$path" | grep -Eq -- '-[0-9][0-9A-Za-z._]*\.[a-z]+\.xml$' \
    || { echo "REFUSING $path: no version in the file name" >&2; exit 1; }
  mkdir -p "$TMP/$(dirname "$path")"
  curl -fsS --max-time 30 -o "$TMP/$path" "$REPO/$path"
  xmllint --noout "$TMP/$path"
  echo "ok  $(wc -c < "$TMP/$path") $path"
done
rm -rf "$OUT"
mv "$TMP" "$OUT"
trap - EXIT
