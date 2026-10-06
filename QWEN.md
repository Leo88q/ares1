# ares1 — Game Repo
gameId: ares1
Watchtower: Games-watchtower adapter knows ares1
Program ID: DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf (источник: `game/programs/solana_potato/src/lib.rs`, `declare_id!`)
Paths: game/programs/solana_potato/src/lib.rs (рабочая программа; Anchor-проект живёт в `game/`)
Audit: sentio scan ./game/programs --fail-on high
Fix: SW001 Signer, SW013 PDA has_one, SW016 init not init_if_needed, SW024 checked_div, SW025 map_err, SW022 close=owner
ENV: ANCHOR_PROVIDER_URL devnet, ANCHOR_WALLET ~/.config/solana/id.json
Гейты репозитория: `cd game && yarn test:deploy-budget`, `cd game && yarn test:guards`, `node game/scripts/check-invisible-unicode.mjs .`, `node scripts/secret-scan.mjs`
CI: `.github/workflows/ci.yml` (program build, IDL, localnet, migrations, contract), `.github/workflows/rent-audit.yml` (измерения залога)
Границы: mainnet не запущен; любые транзакции с тратой SOL — только человек по runbook (`reports/rent-audit/`)
