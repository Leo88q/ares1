#!/usr/bin/env bash
set -euo pipefail

CLI_VERSION="0.6.0"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PWA_URL="${PWA_URL:-}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/android-webshell}"
ANDROID_APPLICATION_ID="${ANDROID_APPLICATION_ID:-}"
KEYSTORE_ALIAS="${KEYSTORE_ALIAS:-ares1}"
KEYSTORE_PATH="${KEYSTORE_PATH:-$OUT_DIR/keystores/ares1-dapp-store.keystore}"

if [[ -z "$PWA_URL" || "$PWA_URL" != https://* ]]; then
  echo "Usage: PWA_URL=https://your-verified-origin.example ANDROID_APPLICATION_ID=com.example.ares1 bash scripts/build-apk.sh" >&2
  echo "The PWA must already be deployed over HTTPS; this script does not publish the website." >&2
  exit 2
fi
if [[ -z "$ANDROID_APPLICATION_ID" && ! -f "$OUT_DIR/twa-manifest.json" ]]; then
  echo "error: ANDROID_APPLICATION_ID is required for the first WebShell project creation" >&2
  exit 2
fi
if ! command -v java >/dev/null 2>&1; then
  echo "error: JDK 17+ is required (see Solana Mobile WebShell prerequisites)" >&2
  exit 2
fi
JAVA_VERSION_LINE="$(java -version 2>&1 | sed -n '1p')"
JAVA_MAJOR="$(grep -oE '"?[0-9]+' <<< "$JAVA_VERSION_LINE" | head -n 1 | tr -d '"')"
if [[ ! "$JAVA_MAJOR" =~ ^[0-9]+$ ]] || (( JAVA_MAJOR < 17 )); then
  echo "error: JDK 17+ is required; detected: $JAVA_VERSION_LINE" >&2
  exit 2
fi
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_SDK" || ! -d "$ANDROID_SDK" ]]; then
  echo "error: set ANDROID_HOME or ANDROID_SDK_ROOT to the installed Android SDK directory" >&2
  exit 2
fi

# Resolve relative paths from the repository root; key material is ignored by Git.
[[ "$OUT_DIR" = /* ]] || OUT_DIR="$REPO_ROOT/$OUT_DIR"
[[ "$KEYSTORE_PATH" = /* ]] || KEYSTORE_PATH="$REPO_ROOT/$KEYSTORE_PATH"
mkdir -p "$OUT_DIR" "$(dirname -- "$KEYSTORE_PATH")"

CLI=(npx --yes "solana-mobile@$CLI_VERSION")
if [[ ! -f "$OUT_DIR/twa-manifest.json" ]]; then
  INIT_ARGS=(webshell init "$OUT_DIR" --manifest "${PWA_URL%/}/manifest.json" --keystore-path "$KEYSTORE_PATH" --keystore-alias "$KEYSTORE_ALIAS")
  if [[ -n "$ANDROID_APPLICATION_ID" ]]; then
    INIT_ARGS+=(--application-id "$ANDROID_APPLICATION_ID")
  fi
  "${CLI[@]}" "${INIT_ARGS[@]}"
else
  echo "Using existing WebShell project and signing identity at $OUT_DIR"
fi

"${CLI[@]}" webshell build "$OUT_DIR" --keystore-path "$KEYSTORE_PATH" --keystore-alias "$KEYSTORE_ALIAS"
APK="$OUT_DIR/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  echo "error: expected signed APK was not produced at $APK" >&2
  exit 1
fi
if ! command -v apksigner >/dev/null 2>&1; then
  echo "error: apksigner is missing from Android SDK build-tools; cannot verify the release APK" >&2
  exit 2
fi
apksigner verify --print-certs "$APK"
printf '\nSigned WebShell APK verified: %s\n' "$APK"
printf 'Before Store upload: test MWA connect/sign on Android, inspect the manifest/assets and verify the beta/network disclosures.\n'
