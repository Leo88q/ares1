#!/usr/bin/env bash
# Gated Solana mainnet release flow.
#
# This script supports two safe operations:
#   1) first deploy: explicit deploy key, then immediate upgrade-authority handoff
#      to the configured Squads vault;
#   2) existing Squads-owned program: upload and verify a buffer, transfer the
#      buffer authority to Squads, and STOP for proposal/approval/execution in
#      Squads. It never tries to sign an upgrade as a multisig PDA.
#
# Existing program upgrades must use --prepare-squads-upgrade. Direct `anchor
# deploy` against a Squads-owned program is deliberately not supported.
#
# Required environment:
#   DEPLOY_KEYPAIR=... EXPECTED_SO_SHA256=<64-hex>
#   MAINNET_AUTHORITY=<Squads vault> MAINNET_TREASURY=<treasury owner>
#   MAINNET_PAYER=<backend payer> POTATO_MINT=<mainnet mint>
#   MAINNET_RELEASE_APPROVED=YES (set only after external release gates are met)
#   [RPC_URL=https://...]
#
# First deployment:
#   ./scripts/deploy-mainnet.sh --allow-first-deploy
# Existing program upgrade preparation:
#   ./scripts/deploy-mainnet.sh --prepare-squads-upgrade
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_FIRST_DEPLOY=0
PREPARE_SQUADS_UPGRADE=0
for arg in "$@"; do
  case "$arg" in
    --allow-first-deploy) ALLOW_FIRST_DEPLOY=1 ;;
    --prepare-squads-upgrade) PREPARE_SQUADS_UPGRADE=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done
if [[ "$ALLOW_FIRST_DEPLOY" == "1" && "$PREPARE_SQUADS_UPGRADE" == "1" ]]; then
  echo "FAIL: first-deploy and Squads-upgrade modes are mutually exclusive." >&2
  exit 2
fi

TOML=Anchor.toml
RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}"
CONFIGURED_PROGRAM_ID="$(awk -F'"' '/^\[programs.mainnet\]/{f=1;next} /^\[/{f=0} f&&/solana_potato/{print $2}' "$TOML")"
PROGRAM_ID="${PROGRAM_ID:-$CONFIGURED_PROGRAM_ID}"

fail() { echo "FAIL: $*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || fail "$1 is required."; }
redact_urls() { sed -E 's#https?://[^[:space:]"<>]+#<redacted-url>#g'; }

for cmd in anchor solana solana-keygen node yarn python3 sha256sum awk; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required on the controlled deploy host."
done

# Match the release toolchain enforced by CI. In particular, the supported
# authority-transfer flags and buffer CLI behavior are version-specific.
EXPECTED_NODE_VERSION="v$(cat ../.node-version)"
[[ "$(node --version)" == "$EXPECTED_NODE_VERSION" ]] || fail "use Node $EXPECTED_NODE_VERSION."
[[ "$(yarn --version)" == "1.22.22" ]] || fail "use Yarn 1.22.22."
[[ "$(anchor --version)" == "anchor-cli 0.31.2" ]] || fail "use Anchor 0.31.2 (anchor-cli 0.31.2)."
[[ "$(solana --version | awk '{print $2}')" == "4.2.2" ]] || fail "use Solana CLI 4.2.2."

for name in DEPLOY_KEYPAIR MAINNET_AUTHORITY MAINNET_TREASURY MAINNET_PAYER POTATO_MINT EXPECTED_SO_SHA256 MAINNET_RELEASE_APPROVED; do
  need "$name"
done
[[ "$MAINNET_RELEASE_APPROVED" == "YES" ]] || fail "MAINNET_RELEASE_APPROVED must be YES after the external release gates have been reviewed."
[[ "$EXPECTED_SO_SHA256" =~ ^[a-fA-F0-9]{64}$ ]] || fail "EXPECTED_SO_SHA256 must be exactly 64 hexadecimal characters."
[[ -n "$PROGRAM_ID" ]] || fail "PROGRAM_ID could not be read from Anchor.toml [programs.mainnet]."
[[ "$PROGRAM_ID" == "$CONFIGURED_PROGRAM_ID" ]] || fail "PROGRAM_ID override must equal Anchor.toml [programs.mainnet]; refusing to build one program and preflight another."

RESOLVED_KEYPAIR="${DEPLOY_KEYPAIR/#\~/$HOME}"
[[ -f "$RESOLVED_KEYPAIR" ]] || fail "DEPLOY_KEYPAIR does not exist."
RESOLVED_KEYPAIR="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$RESOLVED_KEYPAIR")"
DEFAULT_KEYPAIR="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$HOME/.config/solana/id.json")"
if [[ "$RESOLVED_KEYPAIR" == "$DEFAULT_KEYPAIR" ]]; then
  [[ "${ALLOW_DEFAULT_KEYPAIR:-0}" == "1" ]] || fail "refusing the default CLI keypair; use an explicitly controlled deploy signer."
  echo "WARNING: using the default CLI keypair because ALLOW_DEFAULT_KEYPAIR=1." >&2
fi
DEPLOY_AUTHORITY="$(solana-keygen pubkey "$RESOLVED_KEYPAIR" 2>/dev/null)" || fail "could not read the deploy signer public key."
[[ -n "$DEPLOY_AUTHORITY" ]] || fail "deploy signer public key is empty."
[[ "$DEPLOY_AUTHORITY" != "$MAINNET_AUTHORITY" ]] || fail "deploy signer and Squads authority must be distinct."

# Anchor reads these provider overrides; changing Solana CLI config alone does
# not change Anchor.toml's configured provider wallet.
export ANCHOR_WALLET="$RESOLVED_KEYPAIR"
export ANCHOR_PROVIDER_URL="$RPC_URL"

# Build once, verify the ABI and the exact artifact hash before any mainnet write.
anchor build
yarn check:contract target/idl/solana_potato.json
SO_PATH=target/deploy/solana_potato.so
[[ -f "$SO_PATH" ]] || fail "built program artifact $SO_PATH is missing."
ACTUAL_SO_SHA256="$(sha256sum "$SO_PATH" | awk '{print $1}')"
[[ "$ACTUAL_SO_SHA256" == "$EXPECTED_SO_SHA256" ]] || fail "built .so hash does not match EXPECTED_SO_SHA256."

# A failed RPC lookup is NOT evidence that the program is absent. Only the
# explicit AccountNotFound response enables first-deploy mode.
PROGRAM_SHOW=""
if PROGRAM_SHOW="$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json 2>&1)"; then
  PROGRAM_EXISTS=1
  PROGRAM_AUTHORITY="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("authority", ""))' <<<"$PROGRAM_SHOW")" || fail "could not parse the on-chain program state."
else
  if [[ "$PROGRAM_SHOW" =~ [Aa]ccount[Nn]ot[Ff]ound|[Aa]ccount[[:space:]]+[Nn]ot[[:space:]]+[Ff]ound ]]; then
    PROGRAM_EXISTS=0
    PROGRAM_AUTHORITY=""
  else
    fail "could not verify program state; refusing to treat RPC/CLI failure as first deploy. Raw output suppressed to protect RPC credentials."
  fi
fi

PREFLIGHT_ARGS=(--expected-so-sha256 "$EXPECTED_SO_SHA256" --strict)
if [[ "$PROGRAM_EXISTS" == "0" ]]; then
  [[ "$ALLOW_FIRST_DEPLOY" == "1" ]] || fail "program is absent; first deployment requires --allow-first-deploy."
  [[ "$PREPARE_SQUADS_UPGRADE" == "0" ]] || fail "cannot prepare an upgrade buffer before the program exists."
  PREFLIGHT_ARGS+=(--allow-first-deploy)
else
  [[ "$ALLOW_FIRST_DEPLOY" == "0" ]] || fail "--allow-first-deploy is valid only when the program is confirmed absent."
  [[ "$PROGRAM_AUTHORITY" == "$MAINNET_AUTHORITY" ]] || fail "on-chain upgrade authority does not match MAINNET_AUTHORITY."
  if [[ "$PREPARE_SQUADS_UPGRADE" == "0" ]]; then
    fail "program is already Squads-owned. Refusing direct 'anchor deploy'; use --prepare-squads-upgrade, then approve/execute the proposal in Squads."
  fi
fi

PROGRAM_ID="$PROGRAM_ID" \
RPC_URL="$RPC_URL" \
MAINNET_AUTHORITY="$MAINNET_AUTHORITY" \
MAINNET_TREASURY="$MAINNET_TREASURY" \
MAINNET_PAYER="$MAINNET_PAYER" \
POTATO_MINT="$POTATO_MINT" \
  ./scripts/preflight-mainnet.sh "${PREFLIGHT_ARGS[@]}"

if [[ "$PREPARE_SQUADS_UPGRADE" == "1" ]]; then
  echo "This will upload the reviewed artifact to a buffer and transfer buffer authority to Squads."
  echo "It will NOT execute the program upgrade; approval/execution stays in the Squads multisig."
  echo "  program: $PROGRAM_ID"
  echo "  expected authority: $MAINNET_AUTHORITY"
  echo "  .so sha256: $ACTUAL_SO_SHA256"
  read -r -p "Type 'PREPARE' to continue: " CONFIRM
  [[ "$CONFIRM" == "PREPARE" ]] || fail "aborted."

  if ! BUFFER_OUTPUT="$(solana program write-buffer "$SO_PATH" --url "$RPC_URL" --keypair "$RESOLVED_KEYPAIR" 2>&1)"; then
    fail "write-buffer failed. Raw RPC/CLI output suppressed to protect credentials."
  fi
  BUFFER_ADDRESS="$(printf '%s\n' "$BUFFER_OUTPUT" | sed -nE 's/^[[:space:]]*Buffer:[[:space:]]*([1-9A-HJ-NP-Za-km-z]{32,44}).*/\1/p' | head -n 1)"
  if [[ -z "$BUFFER_ADDRESS" ]]; then
    printf '%s\n' "Buffer output (URLs redacted):" >&2
    printf '%s\n' "$BUFFER_OUTPUT" | sed -E 's#https?://[^[:space:]]+#<redacted-url>#g' >&2
    fail "buffer was written but its address could not be parsed; recover/verify the buffer before proceeding."
  fi

  BUFFER_DUMP="$(mktemp)"
  trap 'rm -f "$BUFFER_DUMP"' EXIT
  solana program dump "$BUFFER_ADDRESS" "$BUFFER_DUMP" --url "$RPC_URL" >/dev/null 2>&1 \
    || fail "could not read back the uploaded buffer; do not create a Squads proposal."
  BUFFER_SHA256="$(sha256sum "$BUFFER_DUMP" | awk '{print $1}')"
  rm -f "$BUFFER_DUMP"
  trap - EXIT
  [[ "$BUFFER_SHA256" == "$EXPECTED_SO_SHA256" ]] || fail "uploaded buffer hash does not match the reviewed artifact."

  if ! BUFFER_AUTHORITY_OUTPUT="$(solana program set-buffer-authority "$BUFFER_ADDRESS" \
    --new-buffer-authority "$MAINNET_AUTHORITY" \
    --url "$RPC_URL" --keypair "$RESOLVED_KEYPAIR" 2>&1)"; then
    printf '%s\n' "$BUFFER_AUTHORITY_OUTPUT" | redact_urls >&2
    fail "could not transfer buffer authority to Squads."
  fi
  BUFFER_SHOW="$(solana program show "$BUFFER_ADDRESS" --url "$RPC_URL" --output json 2>/dev/null)" \
    || fail "could not verify the buffer authority after transfer; do not create a Squads proposal."
  BUFFER_FINAL_AUTHORITY="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("authority", ""))' <<<"$BUFFER_SHOW")" \
    || fail "could not parse the buffer authority after transfer."
  [[ "$BUFFER_FINAL_AUTHORITY" == "$MAINNET_AUTHORITY" ]] \
    || fail "buffer authority after transfer is not the expected Squads vault; do not create a proposal."
  echo "Buffer uploaded, read-back hash verified, and authority verified as Squads. Buffer: $BUFFER_ADDRESS"
  echo "Next: create, approve and execute the upgrade proposal through Squads; then rerun preflight and post-upgrade invariants."
  exit 0
fi

echo "This is the FIRST deployment to Solana mainnet-beta; after deploy the script transfers upgrade authority to the Squads vault."
echo "  program: $PROGRAM_ID"
echo "  expected authority: $MAINNET_AUTHORITY"
echo "  reviewed .so sha256: $ACTUAL_SO_SHA256"
read -r -p "Type 'DEPLOY' to continue: " CONFIRM
[[ "$CONFIRM" == "DEPLOY" ]] || fail "aborted."

FIRST_DEPLOY_STARTED=0
AUTHORITY_HANDOFF_COMPLETE=0
first_deploy_cleanup() {
  local rc=$?
  trap - EXIT
  if [[ "$FIRST_DEPLOY_STARTED" == "1" && "$AUTHORITY_HANDOFF_COMPLETE" != "1" ]]; then
    echo "CRITICAL: first deploy may have landed without Squads authority. Immediately inspect the program and transfer authority from the deploy signer if needed." >&2
  fi
  exit "$rc"
}
trap first_deploy_cleanup EXIT

FIRST_DEPLOY_STARTED=1
if ! ANCHOR_DEPLOY_OUTPUT="$(ANCHOR_WALLET="$RESOLVED_KEYPAIR" ANCHOR_PROVIDER_URL="$RPC_URL" anchor deploy 2>&1)"; then
  printf '%s\n' "$ANCHOR_DEPLOY_OUTPUT" | redact_urls >&2
  fail "anchor deploy failed; inspect the program state before retrying."
fi
printf '%s\n' "$ANCHOR_DEPLOY_OUTPUT" | redact_urls
AFTER_DEPLOY_SHOW="$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json 2>/dev/null)" \
  || fail "could not verify the first deployment before authority handoff."
AFTER_DEPLOY_AUTHORITY="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("authority", ""))' <<<"$AFTER_DEPLOY_SHOW")" \
  || fail "could not parse authority after first deployment."
[[ "$AFTER_DEPLOY_AUTHORITY" == "$DEPLOY_AUTHORITY" ]] \
  || fail "first deployment authority is not the explicitly selected deploy signer; refusing an unverified handoff."

# The Squads vault is a PDA and cannot sign this direct handoff as the new
# authority. The CLI flag only skips that *new-authority signer* check; the old
# deploy authority still signs the transfer.
if ! AUTHORITY_TRANSFER_OUTPUT="$(solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$MAINNET_AUTHORITY" \
  --skip-new-upgrade-authority-signer-check \
  --url "$RPC_URL" --keypair "$RESOLVED_KEYPAIR" 2>&1)"; then
  printf '%s\n' "$AUTHORITY_TRANSFER_OUTPUT" | redact_urls >&2
  fail "upgrade authority handoff failed; inspect on-chain authority immediately."
fi
FINAL_SHOW="$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json 2>/dev/null)" \
  || fail "authority handoff was submitted but final program state could not be verified."
FINAL_AUTHORITY="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("authority", ""))' <<<"$FINAL_SHOW")" \
  || fail "could not parse the final program authority."
[[ "$FINAL_AUTHORITY" == "$MAINNET_AUTHORITY" ]] || fail "on-chain authority after first deploy is not the expected Squads vault."
AUTHORITY_HANDOFF_COMPLETE=1

PROGRAM_ID="$PROGRAM_ID" \
RPC_URL="$RPC_URL" \
MAINNET_AUTHORITY="$MAINNET_AUTHORITY" \
MAINNET_TREASURY="$MAINNET_TREASURY" \
MAINNET_PAYER="$MAINNET_PAYER" \
POTATO_MINT="$POTATO_MINT" \
  ./scripts/preflight-mainnet.sh --expected-so-sha256 "$EXPECTED_SO_SHA256" --strict
echo "First deployment completed; on-chain upgrade authority verified as $MAINNET_AUTHORITY."
echo "Keep the game closed until mainnet invariants, smoke tests and monitoring are confirmed."
