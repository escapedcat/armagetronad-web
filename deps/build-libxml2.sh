#!/usr/bin/env bash
# Builds a static wasm libxml2 for the port.
# Pinned to the 2.12 line: last with nanoHTTP, which tResourceManager.cpp
# requires at compile time (see PLAN.md strategy table). Do not bump to >=2.13.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${LIBXML2_VERSION:-2.12.10}"
SERIES="${VERSION%.*}"
[ "$SERIES" = "2.12" ] || {
  echo "refusing libxml2 $VERSION: only the 2.12 line has nanoHTTP, which" >&2
  echo "tResourceManager.cpp needs at compile time. Use a 2.12.x version." >&2
  exit 1
}
BUILD="$PWD/build"
SRC="$BUILD/libxml2-$VERSION"
PREFIX="$BUILD/libxml2-install"

command -v emconfigure >/dev/null || { echo "emsdk env not sourced" >&2; exit 1; }

mkdir -p "$BUILD"
if [ ! -d "$SRC" ]; then
  curl -fL "https://download.gnome.org/sources/libxml2/$SERIES/libxml2-$VERSION.tar.xz" \
    -o "$BUILD/libxml2-$VERSION.tar.xz"
  tar -xf "$BUILD/libxml2-$VERSION.tar.xz" -C "$BUILD"
fi

cd "$SRC"
emconfigure ./configure \
  --disable-shared --enable-static \
  --without-python --without-threads --without-zlib --without-lzma \
  --without-modules --with-http \
  --host=wasm32-unknown-emscripten \
  --prefix="$PREFIX"
emmake make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
emmake make install

echo "OK: $PREFIX/lib/libxml2.a"
