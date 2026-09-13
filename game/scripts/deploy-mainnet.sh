#!/usr/bin/env bash
set -euo pipefail

echo "This will deploy to Solana mainnet-beta using real SOL for rent/fees."
echo "Make sure the program has been audited and tested on devnet first."
read -p "Type 'DEPLOY' to continue: " CONFIRM
if [ "$CONFIRM" != "DEPLOY" ]; then
  echo "Aborted."
  exit 1
fi

solana config set --url mainnet-beta

anchor build
anchor keys sync
anchor deploy --provider.cluster mainnet

echo "Program deployed to mainnet-beta."
echo "Run: ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=<your-mainnet-rpc> PROGRAM_ID=<id> npm run init-onchain"
