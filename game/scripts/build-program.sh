#!/usr/bin/env bash
# Anchor forwards trailing arguments both to build-sbf and its IDL builder;
# --locked at that level is not a supported build-sbf option. Verify resolution
# first and reject ANY lockfile change after the standard Anchor build.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo metadata --locked --format-version 1 > /dev/null
BEFORE=$(sha256sum Cargo.lock)
anchor build
[[ "$(sha256sum Cargo.lock)" == "$BEFORE" ]] || {
  echo 'error: Anchor build changed Cargo.lock; review and commit dependency resolution explicitly' >&2
  exit 1
}
