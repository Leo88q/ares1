#!/usr/bin/env bash
# Deploy the program to devnet (anchor 0.31: 'anchor deploy' has no cluster
# flag — it reads [provider].cluster from Anchor.toml). We flip it locally
# for the duration of this script and restore it afterwards, so the committed
# file stays Localnet (the cluster `anchor test` deploys to).
set -euo pipefail
cd "$(dirname "$0")/.."   # game/

TOML=Anchor.toml
sed -i.bak 's/^cluster = .*/cluster = "Devnet"/' "$TOML"
trap 'mv "$TOML.bak" "$TOML"' EXIT

solana config set --url devnet
anchor build
anchor keys sync
anchor deploy

echo ""
echo "Program deployed to devnet."
echo "If schema changed (it did not for the SOL-withdraw fix), re-run:"
echo "  ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com npm run init-onchain"
