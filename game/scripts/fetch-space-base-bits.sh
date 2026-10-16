#!/usr/bin/env bash
# Re-fetch KayKit Space Base Bits 1.0 (CC0 1.0) at the pinned commit, convert the 16 OBJ-only
# parts with a pinned obj2gltf, and verify everything against manifest.json.
# Usage (from anywhere):  bash game/scripts/fetch-space-base-bits.sh
# Requires: curl, tar, node 22 + npx (repo Node). Does not commit or push anything.
set -euo pipefail

REPO="KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0"
COMMIT="6dfbcac9927d06283752c4defd4882cfe0d29666"
OBJ2GLTF="obj2gltf@3.2.0"
SRC_DIR="addons/kaykit_space_base_bits/Assets"
# Parts that exist in the repo only as OBJ (no glTF in gltf/).
OBJ_ONLY=(
  basemodule_garage_door drill_structure_drill_module
  spacetruck_large_wheel_front_left spacetruck_large_wheel_front_right
  spacetruck_large_wheel_rear_left spacetruck_large_wheel_rear_right
  spacetruck_trailer_wheel_front_left spacetruck_trailer_wheel_front_right
  spacetruck_trailer_wheel_rear_left spacetruck_trailer_wheel_rear_right
  spacetruck_wheel_front_left spacetruck_wheel_front_right
  spacetruck_wheel_rear_left spacetruck_wheel_rear_right
  windturbine_low_fan windturbine_tall_fan
)

HERE="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$(cd "$HERE/.." && pwd)"
DEST="$GAME_DIR/apps/web/public/models/space-base-bits"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $REPO@$COMMIT ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$COMMIT" -o "$TMP/src.tgz"
tar -xzf "$TMP/src.tgz" -C "$TMP"
ROOT="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

mkdir -p "$DEST/licenses"
cp "$ROOT/$SRC_DIR/gltf/"*.gltf "$ROOT/$SRC_DIR/gltf/"*.bin "$DEST/"
cp "$ROOT/$SRC_DIR/textures/spacebits_texture.png" "$DEST/"
# The archive omits the root LICENSE.txt; the identical file (same git blob 12e77f5) is under Assets/.
cp "$ROOT/$SRC_DIR/LICENSE.txt" "$DEST/licenses/kaykit-space-base-bits-LICENSE.txt"

echo "Converting ${#OBJ_ONLY[@]} OBJ-only parts with $OBJ2GLTF ..."
CONV="$TMP/conv"
mkdir -p "$CONV"
for part in "${OBJ_ONLY[@]}"; do
  cp "$ROOT/$SRC_DIR/obj/$part.obj" "$ROOT/$SRC_DIR/obj/$part.mtl" "$CONV/"
done
cp "$ROOT/$SRC_DIR/textures/spacebits_texture.png" "$CONV/"
(
  cd "$CONV"
  for part in "${OBJ_ONLY[@]}"; do
    npx --yes "$OBJ2GLTF" -s -i "$part.obj" -o "$part.gltf" >/dev/null
  done
)
cp "$CONV/"*.gltf "$CONV/"*.bin "$DEST/"

echo "Verifying against manifest.json (sha256, sizes, glTF references) ..."
cd "$GAME_DIR/apps/web"
node --test tests/space-base-bits-assets.test.mjs

echo "OK: files are in $DEST. Review with 'git status' before committing."
