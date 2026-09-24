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
# F-16: tsconfig.tools.json typechecks tests/offchain/*.test.ts, and
# layoutParity.test.ts imports landing sources — landing deps must exist
# BEFORE yarn typecheck/tools run (this was the CI-only failure: TS2307
# @solana/web3.js / @solana/spl-token with no landing/node_modules).
(cd ../landing && npm ci --no-audit --no-fund)
yarn typecheck
yarn typecheck:tools
yarn test:offchain
yarn test:economy
# F-15: backend unit tests (security/alert helpers; no network).
yarn workspace backend test
# F-15: landing i18n parity tests + typecheck (via vite build).
# deps already installed above; parity tests + typecheck(via build)
(cd ../landing && npm test && npm run build)
VITE_SOLANA_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com \
VITE_PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf VITE_BACKEND_URL='' yarn build
if [[ "$SKIP_CHAIN" == 0 ]]; then
  [[ "$(anchor --version)" == 'anchor-cli 0.31.2' ]] || { echo 'Use Anchor 0.31.2' >&2; exit 1; }
  [[ "$(solana --version | awk '{print $2}')" == '4.2.2' ]] || { echo 'Use Solana 4.2.2' >&2; exit 1; }
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
