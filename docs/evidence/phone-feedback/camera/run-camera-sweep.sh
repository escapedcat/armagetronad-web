#!/bin/sh
# The camera sweep behind web/shell.html's CAMERA_TOUCH_FACTOR.
#
#   python3 -m http.server 8000 --directory web/dist-m1 &
#   sh docs/evidence/phone-feedback/camera/run-camera-sweep.sh
#   kill %1
#
# Run from the repository root. Every arm drives the SAME shipped
# armagetronad.html -- there is no control page and no rebuild anywhere in this
# sweep, which is the whole reason it is cheap enough to re-run.
#
# HOW AN ARM IS SET UP, AND WHY IT IS ALLOWED TO BE THIS CRUDE. ?autostart=0
# holds main() (web/shell.html's harness hook), and in that window the preloaded
# /data/webdefaults/autoexec.cfg is an ordinary MEMFS file the page can append
# to. autoexec.cfg is the LAST file st_LoadConfig reads, so a line written there
# beats both user.cfg and config/settings_visual.cfg -- which is exactly what a
# probe wants and exactly what a shipped default must not be. Nothing here is a
# proposal for how to ship a setting; see the comment on CAMERA_TOUCH_FACTOR in
# web/shell.html for that argument.
#
# EVERY ARM PASSES ?cam=1. Without it the touch branch of the shipped page would
# apply its own x0.5 on top of the arm's own settings and the stock row would
# not be stock. That is also the demonstration that ?cam=1 really is stock: the
# `stock` arm below is the shipped page with the tuning switched off, and its
# numbers are the pre-tuning numbers.
#
# THE GEOMETRY IS 915x350 AT DPR 3, i.e. a Pixel-class Android phone held in
# landscape WITH THE URL BAR SHOWING -- 350 rather than 412 CSS px of height.
# That is the shape a phone visitor actually gets and it is wider (2.61) than
# the 2.22 the device's screen alone would suggest. EMULATION IS NOT A DEVICE:
# this fixes the viewport, the pixel ratio and the input type and says nothing
# about a phone's GPU. Read drive-browser.mjs's header before quoting anything.
#
# THE NUMBER EACH ARM PRINTS is the player's own cycle's bounding box in
# backing-store pixels, measured during the round-start countdown while every
# cycle is stationary, by the threshold-on-channel-spread method
# docs/evidence/m5-texture/make-texprobe-page.mjs uses (the grid is grey and has
# no spread; the cycle is the only saturated thing in the crop). Two rounds are
# sampled so a one-off is visible as a disagreement rather than as a result.
set -e
OUT=docs/evidence/phone-feedback/camera
URL=http://localhost:8000/armagetronad.html
TMP=$(mktemp -d)

run() {                       # run <name> <extra-autoexec-lines>
  name=$1; cfg=$2
  sed -e "s|CONFIGLINES|$cfg|" -e "s|TAGHERE|$name|" \
      "$OUT/sweep-arm.steps.tmpl" > "$TMP/$name.steps"
  node web/tools/drive-browser.mjs --headed --mobile 915,350,3 \
       --out "$OUT/$name" \
       --url "$URL?autostart=0&touch=1&cam=1" \
       --script-file "$TMP/$name.steps" > "$OUT/$name-driver.txt" 2>&1
  grep -h 'FOVPROBE' "$OUT/$name/console.log" || true
}

run stock  ''
run fov78  'START_FOV_1 78'
run fov69  'START_FOV_1 69'
run fov60  'START_FOV_1 60'
run cam050 'CAMERA_CUSTOM_BACK 3\\nCAMERA_CUSTOM_RISE 2\\nCAMERA_CUSTOM_BACK_FROMSPEED .25\\nCAMERA_CUSTOM_RISE_FROMSPEED .2'
run cam035 'CAMERA_CUSTOM_BACK 2.1\\nCAMERA_CUSTOM_RISE 1.4\\nCAMERA_CUSTOM_BACK_FROMSPEED .175\\nCAMERA_CUSTOM_RISE_FROMSPEED .14'

rm -rf "$TMP"
