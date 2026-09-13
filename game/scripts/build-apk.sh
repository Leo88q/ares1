#!/usr/bin/env bash
set -euo pipefail

PWA_URL="${PWA_URL:-}"
OUT_DIR="${OUT_DIR:-./android-twa}"

if [ -z "$PWA_URL" ]; then
  echo "Usage: PWA_URL=https://your-deployed-app.com bash scripts/build-apk.sh"
  echo "PWA_URL must be the live HTTPS URL where apps/web/dist is hosted (must serve /manifest.json)."
  exit 1
fi

if ! command -v bubblewrap >/dev/null 2>&1; then
  echo "Installing @bubblewrap/cli globally..."
  npm i -g @bubblewrap/cli
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

if [ ! -f twa-manifest.json ]; then
  bubblewrap init --manifest "${PWA_URL%/}/manifest.json"
else
  echo "twa-manifest.json already exists, running update instead of init."
  bubblewrap update
fi

bubblewrap build

echo ""
echo "Signed APK is in $OUT_DIR/app-release-signed.apk"
echo ""
echo "Next steps:"
echo "1. keytool -list -v -keystore <your-keystore>   # get SHA256 fingerprint"
echo "2. bubblewrap fingerprint add <SHA256_fingerprint>"
echo "3. bubblewrap fingerprint generateAssetLinks"
echo "4. Copy the generated assetlinks.json over apps/web/public/.well-known/assetlinks.json"
echo "5. Redeploy apps/web so /.well-known/assetlinks.json is live at $PWA_URL"
echo "6. apksigner verify --print-certs app-release-signed.apk"
echo "7. Submit at https://publish.solanamobile.com (see docs/dapp-store-release.md)"
