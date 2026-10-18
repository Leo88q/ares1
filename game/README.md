# ARES-1 — Solana Potato

On-chain farming game on Solana. This repository contains the ARES-1 program, web client, backend API/epoch crank, and operational tooling.

> **Status: devnet-beta preparation only.** Mainnet deployment, sale, and real-funds acceptance are not approved. The current V2 marketplace/season work is a draft; see [launch readiness](../docs/LAUNCH_NEXT_STEPS.md) and [the product checklist](../docs/ARES1_PRODUCT_HYPE_REVENUE_CHECKLIST_2026-10-11.md). The local report at [reports/ares1-audit.md](../reports/ares1-audit.md) is internal audit-gate evidence, **not an independent security audit**.

## Network and product status

- The committed program ID is the devnet program recorded in `programs/solana_potato/src/lib.rs`; it does not establish that a mainnet deployment exists.
- Devnet SOL and SKR are test assets with no monetary value. The configured Cloudflare Pages origins are in the root README; verify live ownership and deployment before sharing them.
- The current on-chain market is legacy V1 and settles POTATO/SOL. Its 9–12% fee is reserved in POTATO, uses per-order volume, and splits between legacy burn and treasury; order splitting can lower the effective tier. This is not the approved target model.
- **Approved V2 goal, not released:** seller-paid 9–12% fee is withheld only from a successful trade’s quote-asset proceeds and sent to the treasury in that same asset (SOL or SKR). POTATO/SKR is a separate market pair; seller tiers use cumulative daily POTATO volume across both pairs to prevent same-wallet order splitting. No second fixed 8% fee applies. The V2 Anchor program/IDL/release and verified season ledger are not complete; `VITE_MARKET_V2_ENABLED` remains off by default.
- Phase 1 is a separate off-chain mainnet presale rail. Current mainnet code accepts native SOL only and rejects SKR; writes remain fail-closed by default. No run is approved or open, and no price, delivery date, terms, or refund promise is finalized here.
- Backend API and epoch crank may run in one service. A dedicated low-privilege crank payer may be hosted on the VPS; authority, reward-signer, treasury, program, and Squads keys must stay off-host in cold/hardware-controlled storage.
- The current `game_ops` implementation uses PostgreSQL. Whether this is acceptable as the final database choice remains unresolved; SQLite would require a real port and parity tests. The VPS target is self-hosted PostgreSQL, not a managed external database.

## Repository map

```
programs/solana_potato/     Anchor program (Rust)
apps/web/                   React/Vite game client
apps/backend/               API and epoch crank
migrations/game_ops/        versioned PostgreSQL schema
scripts/                    build, test, audit and guarded operator tools
economy/                    local colony resource study + archived legacy V1 simulation
docs/                       API, operations, launch gates and historical drafts
```

The separate `watchtower/` exporter is read-only; it has no game-signing capability. The `transfer/` directory contains optional handoff tooling for a separate repository—do not run its apply/commit/push path during routine development.

## Warm industrial art pass

The field screen now uses an illustrated Mars backdrop, ready CC0 equipment prefabs, local painted image icons, bronze kit surfaces and a generated blank button texture. The simulation/financial engine is unchanged. Equipment is no longer drawn from bespoke visible box/cylinder primitives; the invisible shadow catcher is purely technical. The UI is not a flattened generated screenshot.

[Art implementation and pinned sources](../docs/WARM_MARS_ART_PASS.md). Offline integrity: `yarn check:field-assets`; visual/browser tests include responsive tabs and the original callbacks.

## Distinct section artwork

The real SupplyBay/StatsBay/CabinBay now use local illustrated headers instead of the same procedural dome. MarketScreen, StatsScreen, ProfileScreen and OperationScreen stay byte-for-byte unchanged. Image navigation now has seven route callbacks (АГРО · ЛАБ · КОЛОНИЯ · СНАБ · ЖУРНАЛ · КАЮТА · ОПЕРАЦИЯ) and reactive translations. The `/demo` art-preview page was retired together with the demo sandbox on 2026-10-17: section art is reviewed on the real routes and in the console fixture of `test:sections-browser`.

```sh
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:sections-browser
```

The actual V1 market/create-modal fixture only replaces providers with local callback spies: no RPC/signing/real trades. See [section art and verification](../docs/WARM_MARS_SECTIONS.md).

## Martian fields in 3D

The main farm renders the same `Field[]` from `GameContext`, selects by public key and reuses all five original field actions. The cards remain available, and V1 POTATO/SOL is unchanged. `/lab` mounts the same renderer inside the game shell: real wallet fields when connected, three explicitly local training benches when not.

```sh
yarn check:field-assets
# Optional production-CSP browser test (installed browser only):
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:fields-browser
```

The test includes the actual `MainScreen` with mocked providers to verify account identity/action forwarding, not signed on-chain transactions. See [implementation, model provenance and limits](../docs/MARTIAN_FIELDS_IMPLEMENTATION.md).

## Field lab: product section (`/lab`)

`/lab` is the product version of the former field demo: the seventh console key (ЛАБ, K2) opens it inside the shell with the real `GameContext`/`SolanaContext` data, the live POTATO/SOL order book and **one shared colony store** (`ColonyProvider`) with `/base`. The bench draws water/nutrients/spares from the colony stock and ships SIM food batches back into base storage; both ledgers move in the same click and transfers pause while the colony clock runs. The SIM layer stays local bookkeeping: no minting, no signing, no persistence.

```sh
yarn workspace web test:lab-browser        # real fields, shared stock, shipped food (installed browser only)
yarn test:offchain                         # bridge conservation: tests/offchain/labColonyBridge.test.ts
```

See [the field lab product note](../docs/FIELD_LAB_PRODUCT.md).

## Field engineering (local SIM)

The field lab (`/lab`) starts on the field-state layer and switches to the engineering SIM with one key: battery, pump/reservoir, lights, crop stages and food lots. On the farm it is an opt-in layer for the **same account public key**; all original POTATO actions remain in the on-chain tab. No financial callbacks, rewards, persistent storage or new accounts are added.

```sh
yarn simulate:engineering
yarn simulate:engineering --report economy/engineering-climate-report-2026-10-15.md
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:engineering-browser
```

The current LAB/2 solver adds thermal inertia, a bounded thermostat, heat accounting and operator-selectable power priorities. It conserves dispatched energy, water, nutrients, harvested food mass and recorded heat. Parameters are labelled game assumptions, not NASA/Mars validation. See [current climate profile and checks](../docs/FIELD_CLIMATE.md), with [LAB/1 notes](../docs/FIELD_ENGINEERING.md) retained as history.

## Earlier local 3D colony sandbox

Open **`/colony`** after `yarn dev:web`. This standalone lunar design study needs no wallet or RPC and leaves the existing on-chain game unchanged. It bundles 14 CC0 models and a deterministic power/water/crop/maintenance simulation. CR are fictional budget credits, not POTATO or money; reload resets progress.

```sh
yarn simulate:colony                                      # six 180-day resource scenarios
yarn simulate:colony --report economy/colony-report-2026-10-14.md
yarn check:colony-assets                                  # offline hashes and notices
```

See [research, assumptions and integration plan](../docs/LUNAR_FARM_PLAN.md). The optional production-browser smoke test uses an installed Chromium, not a downloaded browser: build with `yarn build:web`, start `yarn workspace web preview` in another terminal, then run `CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:colony-browser`. It checks the shipped CSP, desktop/mobile, WebGL fallback, actions, language and absence of external requests.

## Developer setup

Pinned toolchains: Node `22.22.3`, Yarn Classic `1.22.22`, Rust `1.97.1`, Solana CLI `4.2.2`, Anchor `0.31.2`. The JS Anchor client is pinned separately; see [Operations](docs/OPERATIONS.md).

```bash
cd game
yarn install --frozen-lockfile
yarn typecheck
yarn test:offchain
yarn workspace backend test
yarn test:guards

yarn build:web
yarn build:backend
```

Program checks use the pinned Rust/Anchor toolchain and a local validator:

```bash
cargo test --locked -p solana_potato --lib
./scripts/build-program.sh
anchor test
```

`anchor test` deploys to a disposable **local validator**, not devnet or mainnet. `scripts/deploy-devnet.sh` is a separate, transaction-signing devnet action; only run it deliberately with a disposable devnet signer after reviewing its inputs. No mainnet deploy or real payment is part of normal setup.

For a local free/devnet walkthrough on Mac, see [LOCAL_MAC_RUNBOOK.md](../LOCAL_MAC_RUNBOOK.md) and [LOCAL_PRESALE_PLAY.md](../LOCAL_PRESALE_PLAY.md). These do not authorize a live sale. Local PostgreSQL commands exercise only the current implementation; they do not settle the database-choice question.

## Security and release gates

- Authority, treasury, reward-signer, Squads, and program keys are not VPS secrets. Do not paste secrets into chat or Git; do not rewrite Git history.
- Current mainnet route: [MAINNET_LAUNCH_GATE.md](docs/MAINNET_LAUNCH_GATE.md). Current operational/key guidance: [OPERATIONS.md](docs/OPERATIONS.md).
- Mainnet presale status and unresolved approvals: [root launch checklist](../docs/LAUNCH_NEXT_STEPS.md).
- The historical marketing analysis and dApp Store guide are explicitly drafts; neither is an approval to publish or submit an app. See [MARKETING.md](docs/MARKETING.md) and [dapp-store-release.md](docs/dapp-store-release.md).
- The project-wide license is unresolved; no old README wording should be treated as authoritative. See [third-party attribution](../THIRD_PARTY_LICENSES.md).
