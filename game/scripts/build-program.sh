#!/usr/bin/env bash
# Anchor forwards trailing arguments both to build-sbf and its IDL builder;
# --locked at that level is not a supported build-sbf option. Verify resolution
# first and reject ANY lockfile change after the standard Anchor build.
set -euo pipefail
cd "$(dirname "$0")/.."

read_pin() {
  sed -n "s/^$1 *= *\"\\([^\"]*\\)\".*/\\1/p" "$2" | head -1
}

ANCHOR_VERSION="$(read_pin anchor_version Anchor.toml)"
SOLANA_VERSION="$(read_pin solana_version Anchor.toml)"
RUST_VERSION="$(read_pin channel rust-toolchain.toml)"
[[ -n "$ANCHOR_VERSION" && -n "$SOLANA_VERSION" && -n "$RUST_VERSION" ]] || {
  echo 'error: missing Anchor/Solana/Rust version pin' >&2
  exit 1
}

for tool in anchor solana rustc cargo; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: required tool '$tool' is not on PATH" >&2
    exit 1
  }
done

ACTUAL_ANCHOR="$(anchor --version | awk '{print $2}')"
ACTUAL_SOLANA="$(solana --version | awk '{print $2}')"
ACTUAL_RUST="$(rustc --version | awk '{print $2}')"
[[ "$ACTUAL_ANCHOR" == "$ANCHOR_VERSION" ]] || {
  echo "error: Anchor CLI $ACTUAL_ANCHOR does not match Anchor.toml pin $ANCHOR_VERSION" >&2
  exit 1
}
[[ "$ACTUAL_SOLANA" == "$SOLANA_VERSION" ]] || {
  echo "error: Solana CLI $ACTUAL_SOLANA does not match Anchor.toml pin $SOLANA_VERSION" >&2
  exit 1
}
[[ "$ACTUAL_RUST" == "$RUST_VERSION" ]] || {
  echo "error: Rust $ACTUAL_RUST does not match rust-toolchain.toml pin $RUST_VERSION" >&2
  exit 1
}

if command -v sha256sum >/dev/null 2>&1; then
  hash_lock() { sha256sum Cargo.lock; }
elif command -v shasum >/dev/null 2>&1; then
  hash_lock() { shasum -a 256 Cargo.lock; }
else
  echo 'error: need sha256sum or shasum to verify Cargo.lock immutability' >&2
  exit 1
fi

cargo metadata --locked --format-version 1 > /dev/null
BEFORE="$(hash_lock)"
anchor build
[[ "$(hash_lock)" == "$BEFORE" ]] || {
  echo 'error: Anchor build changed Cargo.lock; review and commit dependency resolution explicitly' >&2
  exit 1
}
