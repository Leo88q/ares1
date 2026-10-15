#!/usr/bin/env bash
# Re-fetch KayKit Space Base Bits 1.0 (CC0 1.0) at the pinned commit and verify it.
# Usage (from repo root or any folder):  bash game/scripts/fetch-space-base-bits.sh
# Requires: curl, tar, node (the repo's Node 22). Does not commit or push anything.
set -euo pipefail

REPO="KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0"
COMMIT="6dfbcac9927d06283752c4defd4882cfe0d29666"
SRC_DIR="addons/kaykit_space_base_bits/Assets"

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

echo "Verifying against manifest.json (sha256, sizes, glTF references) ..."
cd "$GAME_DIR/apps/web"
node --test tests/space-base-bits-assets.test.mjs

echo "OK: files are in $DEST. Review with 'git status' before committing."
