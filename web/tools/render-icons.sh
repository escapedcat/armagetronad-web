#!/bin/sh
# Render the installed app's icons from web/tools/app-icon.png into web/pwa/.
# app-icon.png is a 1024 px render of the game's own lightcycle (models/*.mod
# with textures/cycle_*.png, tinted the way gTextureCycle does), on the grid
# with its wall. Keep the bike inside the centre circle of radius 40 %: that
# is all Android's adaptive-icon masks are sure to show.
# The PNGs are committed, so the build and CI don't need this; run it only
# after replacing app-icon.png. Needs ImageMagick 7 (brew install imagemagick).
#
#   icon-192.png, icon-512.png  "any": rounded corners, for desktop installs and
#                               launchers that show the icon as drawn
#   icon-maskable-512.png       full bleed, for Android, which cuts its own shape
#   apple-touch-icon.png        180 px, full bleed and opaque: iOS rounds the
#                               corners itself and fills transparency with black
set -eu
cd "$(dirname "$0")/../.."
SRC=web/tools/app-icon.png
OUT=web/pwa
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

magick "$SRC" -alpha off -resize 512x512 "$tmp/full.png"
magick "$tmp/full.png" -alpha off "$OUT/icon-maskable-512.png"
magick "$tmp/full.png" -alpha off -resize 180x180 "$OUT/apple-touch-icon.png"
# A rounded square (corner radius 22 %) with transparent corners.
magick "$tmp/full.png" -alpha set \
  \( -size 512x512 xc:black -fill white -draw "roundrectangle 0,0 511,511 112,112" -alpha off \) \
  -compose CopyOpacity -composite "$tmp/any.png"
cp "$tmp/any.png" "$OUT/icon-512.png"
magick "$tmp/any.png" -resize 192x192 "$OUT/icon-192.png"
echo "rendered into $OUT:" icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png
