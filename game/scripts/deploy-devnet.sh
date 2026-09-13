#!/usr/bin/env bash
set -euo pipefail

solana config set --url devnet

anchor build
anchor keys sync
anchor deploy --provider.cluster devnet

echo "Program deployed to devnet."
echo "Run: ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com PROGRAM_ID=<id> npm run init-onchain"
