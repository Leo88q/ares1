#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Mainnet deploy — gated.
#
# 2026-10-02 (audit): this script used to be a bare `anchor deploy` on the
# default CLI keypair with a `read -p` confirmation. That contradicted
# docs/KEY_PROVENANCE.md and skipped game/scripts/preflight-mainnet.sh entirely.
# Now the deploy cannot start unless:
#   • DEPLOY_KEYPAIR is given explicitly (default ~/.config/solana/id.json is
#     refused unless ALLOW_DEFAULT_KEYPAIR=1 is set on purpose);
#   • EXPECTED_SO_SHA256 is given — the artifact you ship is the artifact that
#     was reviewed (gate G-3);
#   • MAINNET_AUTHORITY is given — the expected Squads multisig. It is verified
#     against the chain BEFORE the deploy (upgrade) and again AFTER (both).
#   • preflight-mainnet.sh passes. Use --allow-first-deploy on the very first
#     deploy of a program that does not exist on mainnet yet; the post-deploy
#     verification still enforces the multisig authority.
#
# Usage:
#   DEPLOY_KEYPAIR=~/coldcard/solana-mainnet.json \
#   EXPECTED_SO_SHA256=<reviewed-build-hash> \
#   MAINNET_AUTHORITY=<squads-vault-address> \
#   [MAINNET_TREASURY=<treasury-owner>] [MAINNET_PAYER=<backend-hot-wallet>] \
#   [RPC_URL=https://...] [POTATO_MINT=<mint>] \
#   ./scripts/deploy-mainnet.sh [--allow-first-deploy]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_FIRST_DEPLOY=0
for arg in "$@"; do
  case "$arg" in
    --allow-first-deploy) ALLOW_FIRST_DEPLOY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

TOML=Anchor.toml
RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}"
PROGRAM_ID="${PROGRAM_ID:-$(awk -F'"' '/^\[programs.mainnet\]/{f=1;next} /^\[/{f=0} f&&/solana_potato/{print $2}' "$TOML")}"

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -n "${DEPLOY_KEYPAIR:-}" ]] || fail "DEPLOY_KEYPAIR is not set. Point it at the offline/hardware key used for mainnet (docs/KEY_PROVENANCE.md); there is no default."
# Ведущая ~ в кавычках не раскрывается, поэтому раскрываем её сами один раз:
# одна и та же нормализация для проверки файла и для сравнения с дефолтным
# CLI-ключом (иначе '~/.config/solana/id.json' прошёл бы мимо запрета).
RESOLVED_KEYPAIR="${DEPLOY_KEYPAIR/#\~/$HOME}"
[[ -f "$RESOLVED_KEYPAIR" ]] || fail "DEPLOY_KEYPAIR=${DEPLOY_KEYPAIR} does not exist."
if [[ "$RESOLVED_KEYPAIR" == "$HOME/.config/solana/id.json" ]]; then
  [[ "${ALLOW_DEFAULT_KEYPAIR:-0}" == "1" ]] || fail "refusing the default CLI keypair for a mainnet deploy. Set ALLOW_DEFAULT_KEYPAIR=1 only if you understand the risk (KEY_PROVENANCE.md: deploy wallet on a controlled signing device)."
  echo "WARNING: deploying with the default CLI keypair because ALLOW_DEFAULT_KEYPAIR=1." >&2
fi
[[ -n "${MAINNET_AUTHORITY:-}" ]] || fail "MAINNET_AUTHORITY is not set. The upgrade authority must be the expected Squads multisig (gate G-2); preflight verifies it on-chain."
[[ -n "${EXPECTED_SO_SHA256:-}" ]] || fail "EXPECTED_SO_SHA256 is not set. Build reproducibility is a gate (G-3): build twice (or run solana-verify) and pass the reviewed hash."
[[ -n "$PROGRAM_ID" ]] || fail "PROGRAM_ID could not be read from Anchor.toml [programs.mainnet] and is not set."

echo "This will deploy to Solana mainnet-beta using real SOL for rent/fees."
echo "  program:          $PROGRAM_ID"
echo "  rpc:              $RPC_URL"
echo "  deploy keypair:   $DEPLOY_KEYPAIR"
echo "  expected authority (Squads): $MAINNET_AUTHORITY"
echo "  expected .so sha256:         $EXPECTED_SO_SHA256"
read -r -p "Type 'DEPLOY' to continue: " CONFIRM
if [ "$CONFIRM" != "DEPLOY" ]; then
  echo "Aborted."
  exit 1
fi

# ── Temporary CLI config: cluster + keypair are restored on any exit ─────────
PREV_URL="$(solana config get | awk -F': ' '/RPC URL/{print $2}')"
PREV_KEYPAIR="$(solana config get | awk -F': ' '/Keypair Path/{print $2}')"
restore_config() {
  sed -i.bak 's/^cluster = .*/cluster = "Localnet"/' "$TOML" 2>/dev/null || true
  rm -f "$TOML.bak" 2>/dev/null || true
  [[ -n "$PREV_URL" ]] && solana config set --url "$PREV_URL" >/dev/null 2>&1 || true
  [[ -n "$PREV_KEYPAIR" ]] && solana config set --keypair "$PREV_KEYPAIR" >/dev/null 2>&1 || true
}
trap restore_config EXIT

sed -i.bak 's/^cluster = .*/cluster = "Mainnet"/' "$TOML"
rm -f "$TOML.bak"
solana config set --url "$RPC_URL" >/dev/null
solana config set --keypair "$RESOLVED_KEYPAIR" >/dev/null

# ── Build the artifact the gate will hash ───────────────────────────────────
anchor build
anchor keys sync

# ── Pre-deploy gate ─────────────────────────────────────────────────────────
PREFLIGHT_ARGS=(--expected-so-sha256 "$EXPECTED_SO_SHA256")
if [[ "$ALLOW_FIRST_DEPLOY" == "1" ]]; then
  PREFLIGHT_ARGS+=(--allow-first-deploy)
fi
PROGRAM_ID="$PROGRAM_ID" \
RPC_URL="$RPC_URL" \
MAINNET_AUTHORITY="$MAINNET_AUTHORITY" \
MAINNET_TREASURY="${MAINNET_TREASURY:-}" \
MAINNET_PAYER="${MAINNET_PAYER:-}" \
POTATO_MINT="${POTATO_MINT:-}" \
  ./scripts/preflight-mainnet.sh "${PREFLIGHT_ARGS[@]}"

# ── Deploy ──────────────────────────────────────────────────────────────────
anchor deploy

# ── Post-deploy verification: the authority on-chain is the multisig we expect ─
PROGRAM_ID="$PROGRAM_ID" \
RPC_URL="$RPC_URL" \
MAINNET_AUTHORITY="$MAINNET_AUTHORITY" \
MAINNET_TREASURY="${MAINNET_TREASURY:-}" \
MAINNET_PAYER="${MAINNET_PAYER:-}" \
POTATO_MINT="${POTATO_MINT:-}" \
  ./scripts/preflight-mainnet.sh --expected-so-sha256 "$EXPECTED_SO_SHA256"

echo ""
echo "Program deployed to mainnet-beta and verified against $MAINNET_AUTHORITY."
echo "Next: run the post-deploy steps in docs/MAINNET_LAUNCH_GATE.md (invariants,"
echo "smoke harvest/order, watchtower events) before announcing anything."
