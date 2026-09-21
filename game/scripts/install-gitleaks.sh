#!/usr/bin/env bash
# Linux x86_64; verify the release checksum before executing the scanner.
set -euo pipefail
VERSION=8.30.1
DEST=${1:?Usage: install-gitleaks.sh DESTINATION_DIRECTORY}
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
BASE="https://github.com/gitleaks/gitleaks/releases/download/v$VERSION"
ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
curl --fail --silent --show-error --location "$BASE/$ARCHIVE" -o "$ARCHIVE"
curl --fail --silent --show-error --location "$BASE/gitleaks_${VERSION}_checksums.txt" -o checksums.txt
grep -E "^[0-9a-f]{64}  ${ARCHIVE}$" checksums.txt > selected-checksum.txt
test -s selected-checksum.txt
sha256sum --check selected-checksum.txt
tar -xzf "$ARCHIVE" -C "$DEST" gitleaks
"$DEST/gitleaks" version
