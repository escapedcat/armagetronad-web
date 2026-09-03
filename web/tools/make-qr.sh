#!/bin/sh
# Regenerate docs/demo-qr.png for the README, and PROVE it scans.
#
# The trap this exists to avoid: a QR regenerated after the URL changes, not
# re-verified, and silently pointing at the old address. A wrong QR is worse
# than no QR -- a reader has no way to tell by looking, which is the whole
# point of the format.
#
# npx rather than a dependency: this is a one-off generator, not something the
# port needs at build or run time. Same reasoning as web/package.json's use of
# npx for gh-pages.
set -e
URL="${1:-https://escapedcat.github.io/armagetronad-web/}"
OUT="${2:-docs/demo-qr.png}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

npx --yes qrcode@1 -o "$OUT" -t png -w 512 --margin 2 "$URL"

# Decode what we just wrote and compare against the URL we asked for.
( cd "$TMP" && npm init -y >/dev/null 2>&1 && npm i --silent jsqr pngjs >/dev/null 2>&1 )
node -e "
const {PNG}=require('$TMP/node_modules/pngjs').PNG;
const jsQR=require('$TMP/node_modules/jsqr').default||require('$TMP/node_modules/jsqr');
const png=PNG.sync.read(require('fs').readFileSync('$OUT'));
const got=(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)||{}).data;
if (got !== '$URL') { console.error('QR decodes to ' + JSON.stringify(got) + ', not ' + JSON.stringify('$URL')); process.exit(1); }
console.log('$OUT decodes to ' + got);
"
