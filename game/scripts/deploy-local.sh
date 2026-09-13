#!/usr/bin/env bash
set -euo pipefail

solana-test-validator --reset --quiet &
VALIDATOR_PID=$!
trap 'kill $VALIDATOR_PID 2>/dev/null || true' EXIT

sleep 5
solana config set --url localhost

anchor build
anchor deploy --provider.cluster localnet

echo "Program deployed to localnet."
echo "Run: ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=http://127.0.0.1:8899 npm run init-onchain"

wait $VALIDATOR_PID
