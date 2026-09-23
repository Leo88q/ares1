# ares1 — Game Repo
gameId: ares1
Watchtower: Games-watchtower adapter knows ares1
Program ID: solana-keygen new -o target/deploy/ares1-keypair.json && solana address -k target/deploy/ares1-keypair.json
Paths: programs/ares1/src/lib.rs or programs/ares1-quests/
Audit: sentio scan ./programs --fail-on high
Fix: SW001 Signer, SW013 PDA has_one, SW016 init not init_if_needed, SW024 checked_div, SW025 map_err, SW022 close=owner
ENV: ANCHOR_PROVIDER_URL devnet, ANCHOR_WALLET ~/.config/solana/id.json
