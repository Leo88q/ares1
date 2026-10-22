# Mainnet: read-only cost audit and minimum launch plan

> This is a planning/runbook document, not authorization to deploy, initialize accounts, publish to the Store, buy RPC service, or send a mainnet transaction. All such actions remain behind the existing launch gates and require a separate explicit GO.

## What is known now

- No live mainnet RPC quote or built release `.so` size has been recorded in this checkout. `scripts/rent-audit.config.json` points to devnet; do not use it as a mainnet quote.
- The deployment calculator reads rent from RPC and accepts a measured `.so`, but its account bootstrap default is the **full** profile. Its `--offline-rate` mode is test-only.
- There is no measured Colony account layout yet: `COLONY_ACCOUNT_BYTES=512` is a planning placeholder, not a production size.
- The app currently has no safe, bounded mainnet POTATO starter grant. A first Field requires 100 POTATO; deploying the program alone would not make the mainnet game playable. This is a product blocker, not a rent problem.
- The previous ~0.2 SOL Solana Mobile Store figure is an unverified planning note, not a current quote. No current hosting/RPC vendor prices have been checked.

## Read-only quote commands

Build the release artifact locally first (this does not contact mainnet):

```sh
cd game
./scripts/build-program.sh
stat -c '%s bytes' target/deploy/solana_potato.so
```

Then use a trusted mainnet-beta HTTPS RPC. Keep any provider API key in a local environment variable; do not commit it or paste it into project files:

```sh
export MAINNET_RPC_URL='https://<trusted-mainnet-beta-rpc>'
node scripts/deploy-budget.mjs \
  --rpc "$MAINNET_RPC_URL" \
  --cluster mainnet-beta \
  --so target/deploy/solana_potato.so \
  --mode new \
  --setup-profile core \
  --json

SOLANA_CLUSTER=mainnet-beta SOLANA_RPC_URL="$MAINNET_RPC_URL" yarn rent:estimate
```

These commands are read-only: they query genesis, rent, account state and deployer balance; they do not sign or submit transactions. `--cluster mainnet-beta` checks the RPC genesis hash and refuses a devnet endpoint. For an already-deployed program, use `--mode auto` (or explicitly `upgrade`) so the calculator reads ProgramData capacity and its current deposit. The upgrade estimate is not comparable to a fresh-deploy estimate.

The player-account rent command reports Field and draft Colony deposits separately. The Colony size stays visibly marked as provisional until its real ABI is implemented and measured. Set `NEW_BUILDING_PDA_COUNT` only if the selected account design actually creates separate Building PDAs.

## Costs to keep separate

| Bucket | What it is | Is it a consumed expense? | Minimal treatment |
|---|---|---:|---|
| ProgramData + Program rent | Deposit needed for the program ELF and loader account | No; locked while deployed, potentially recoverable only if the program is closed under its authority | Build/measure the smallest reviewed release artifact; avoid arbitrary `--max-len` / growth headroom |
| `initialize` rent | POTATO mint + GameConfig + Epoch | No; rent-exempt balances are locked in live accounts | Core bootstrap only |
| Optional bootstrap rent | Presale state, treasury vaults, quest vault/ATA, SKR ATAs | No; also locked in accounts | Defer unless the matching feature is approved and needed on day one |
| Transaction fees / priority fees | Program writes, bootstrap transactions, player actions | Yes; consumed | Quote from the actual RPC and transaction plan; calculator fees are a conservative model, not a fee guarantee |
| Reserve | Current calculator defaults to 0.30 SOL and enforces a 0.25 SOL floor (or 2× setup rent) | No; it remains in the payer wallet | Show it separately from the spend total; do not label it as rent or fees |
| Player Field / token accounts | User or sponsor creates Field and SPL token accounts | No; rent deposit is associated with the account | Quote per-user on mainnet; choose explicitly who pays before enabling sponsorship |
| Store publishing | Publisher portal, signing, hosted APK/assets and submission requirements | Mixed; depends on the selected storage and current Store terms | Keep separate from chain deployment; request a current quote before submission |
| Backend / RPC / database | Availability, rate limits, persistent colony state, backups and monitoring | Usually recurring | Keep dev/staging on free tiers; price production only after traffic/SLO requirements are known |

## Core vs full bootstrap

`deploy-budget` and `scripts/init-onchain.ts` now support the same explicit profiles:

- `core`: POTATO mint + GameConfig + Epoch only. It defers presale, SOL treasury, quest vault/ATA/reward pool and SKR ATAs. This is the smallest bootstrap the current program supports, **not a complete product launch**: deferred functionality must remain disabled in UI/backend until initialized. The on-chain config still needs the actual, verified SKR mint for a usable SKR rail; mainnet bootstrap refuses the hard-coded devnet default.
- `full`: current legacy warm-start path, including presale and optional treasury/reward accounts. This is still the default for compatibility. Do not select it merely because the script supports it.

If and only if a separate deployment GO is given, the corresponding initialization command must explicitly select `BOOTSTRAP_PROFILE=core`, set `MAINNET_BOOTSTRAP_GO=YES`, and provide a verified `SKR_MINT` on mainnet. The environment flag is an additional fail-closed guard, not a substitute for authorization. Mainnet full bootstrap is blocked because it creates presale/reward accounts. The bootstrap checks RPC genesis before any transaction. This audit work itself never runs `init-onchain`.

## Why the headline can look large

A large share of a first deployment estimate is usually the program ELF's rent-exempt ProgramData deposit, not account rent or an irreversible fee. As a **test-vector illustration only**, at 6,960 lamports/byte and a hypothetical 450,000-byte ELF, the existing arithmetic model gives about 3.1343 SOL locked in ProgramData + Program accounts, before fees, setup accounts and reserve. Neither the 450,000-byte ELF nor that rent rate has been measured for this release against mainnet; do not use this illustration as a quote.

Under the same illustrative rate, core account setup is 5,394,000 lamports (0.005394 SOL); the full offline test profile with SKR ATA worst case is 14,581,200 lamports (0.0145812 SOL). These demonstrate that deferring optional accounts saves some rent, but optimizing/measuring the program artifact and separating the reserve are more consequential than shaving a few ATA deposits. Live RPC output is authoritative for the quote.

## Recommended minimal sequence

1. **Now, $0 mainnet spend:** finish and verify the persistent-colony backend/on-chain boundary on localnet/devnet; implement a safe, bounded first-player POTATO grant and its abuse controls; keep the purchase UI closed.
2. **Read-only measurement:** build the exact release artifact, run both commands above against mainnet RPC, save the output with timestamp, genesis hash, slot, RPC provider and artifact SHA-256. Do not fund the deployer or submit transactions as part of measurement.
3. **Launch readiness:** prove the actual first-player path end-to-end, including whether the player or product pays Field/ATA rent; verify all Store/legal/privacy gates and database backups; decide which optional rewards actually ship.
4. **Only after a separate GO:** deploy the measured artifact, initialize core, then add optional accounts/features only when enabled. Keep the launch wallet reserve visible and distinct from expected expenditure. Do not open any sale without its own approval.

## Illustrative net-new check

For a measured artifact of 450,000 bytes, the repository's test-vector model at 6,960 lamports/byte reports:

- Program + ProgramData deposit: 3.134345520 SOL (locked)
- Estimated deploy fees: 0.003740000 SOL (model estimate, not a live quote)
- Core setup rent: 0.005394000 SOL (locked)
- Minimum remaining account balance: 0.000890880 SOL
- Default reserve: 0.300000000 SOL (wallet reserve, not spend)

The arithmetic total before reserve is 3.144370400 SOL; with reserve, 3.444370400 SOL. This is **not the current launch cost**; it is a reproducible example based on test inputs. Replace it only with output from the read-only live audit above and an actual `.so` artifact.
