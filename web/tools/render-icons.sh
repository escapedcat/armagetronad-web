#!/bin/sh
# Render the installed app's icons from web/tools/app-icon.svg into web/pwa/.
# The PNGs are committed, so the build and CI need neither tool; run this only
# after editing the SVG. Needs rsvg-convert (librsvg) and ImageMagick 7:
#   brew install librsvg imagemagick
#
#   icon-192.png, icon-512.png  "any": rounded corners, for desktop installs and
#                               launchers that show the icon as drawn
#   icon-maskable-512.png       full bleed, for Android, which cuts its own shape
#   apple-touch-icon.png        180 px, full bleed and opaque: iOS rounds the
#                               corners itself and fills transparency with black
set -eu
cd "$(dirname "$0")/../.."
SVG=web/tools/app-icon.svg
OUT=web/pwa
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

rsvg-convert -w 512 -h 512 "$SVG" -o "$tmp/full.png"
magick "$tmp/full.png" -alpha off "$OUT/icon-maskable-512.png"
magick "$tmp/full.png" -alpha off -resize 180x180 "$OUT/apple-touch-icon.png"
# A rounded square (corner radius 22 %) with transparent corners.
magick "$tmp/full.png" -alpha set \
  \( -size 512x512 xc:black -fill white -draw "roundrectangle 0,0 511,511 112,112" -alpha off \) \
  -compose CopyOpacity -composite "$tmp/any.png"
cp "$tmp/any.png" "$OUT/icon-512.png"
magick "$tmp/any.png" -resize 192x192 "$OUT/icon-192.png"
echo "rendered: $(cd "$OUT" && ls ./*.png | tr '\n' ' ')"
