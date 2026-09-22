#!/usr/bin/env bash
# Same validation sequence as CI. --skip-chain does NOT certify on-chain code.
set -euo pipefail
cd "$(dirname "$0")/.."
SKIP_CHAIN=0
SKIP_VALIDATOR=0
for arg in "$@"; do
  case "$arg" in
    --skip-chain) SKIP_CHAIN=1 ;;
    --skip-validator) SKIP_VALIDATOR=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done
NODE_VERSION=$(cat ../.node-version)
[[ "$(node --version)" == "v$NODE_VERSION" ]] || { echo "Use Node $NODE_VERSION" >&2; exit 1; }
[[ "$(yarn --version)" == "1.22.22" ]] || { echo 'Use Yarn 1.22.22' >&2; exit 1; }
yarn install --frozen-lockfile --non-interactive
yarn typecheck
yarn typecheck:tools
yarn test:offchain
VITE_SOLANA_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com \
VITE_PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf VITE_BACKEND_URL='' yarn build
# Prints required vs found version to BOTH streams. stderr alone disappears when
# the pipeline is piped through tee/CI log capture, and a bare "Use Anchor X"
# right after a successful build reads like a build failure (it is not: the web
# and backend builds above already passed).
require_tool() { # $1 label, $2 required version, $3 found version, $4 install hint
  if [[ "$3" != "$2" ]]; then
    {
      echo "TOOLCHAIN MISMATCH — $1: required $2, found ${3:-<not installed>}"
      echo "  Off-chain checks (typecheck, unit tests, web + backend build) already passed."
      echo "  $4"
    } | tee /dev/stderr
    exit 1
  fi
}

if [[ "$SKIP_CHAIN" == 0 ]]; then
  require_tool 'Anchor CLI' 'anchor-cli 0.31.2' \
    "$(command -v anchor >/dev/null 2>&1 && anchor --version 2>/dev/null)" \
    'Install: cargo install anchor-cli --version =0.31.2 --locked  (or: avm install 0.31.2 && avm use 0.31.2)'
  require_tool 'Solana CLI' '4.2.2' \
    "$(command -v solana >/dev/null 2>&1 && solana --version 2>/dev/null | awk '{print $2}')" \
    'Install: sh -c "$(curl -sSfL https://release.anza.xyz/v4.2.2/install)"'
  cargo test --locked -p solana_potato --lib
  ./scripts/build-program.sh
  if [[ "$SKIP_VALIDATOR" == 0 ]]; then
    # Do not create or overwrite the operator wallet silently.
    [[ -f "$HOME/.config/solana/id.json" ]] || { echo 'Create a disposable LOCALNET wallet first (see docs/OPERATIONS.md)' >&2; exit 1; }
    anchor test --skip-build
    yarn test:migrations
  fi
  yarn check:contract target/idl/solana_potato.json
else
  echo 'OFF-CHAIN ONLY: Anchor build, integration tests and IDL check were NOT run.'
fi
