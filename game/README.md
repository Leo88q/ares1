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
economy/                    legacy V1 simulation and archived reports
docs/                       API, operations, launch gates and historical drafts
```

The separate `watchtower/` exporter is read-only; it has no game-signing capability. The `transfer/` directory contains optional handoff tooling for a separate repository—do not run its apply/commit/push path during routine development.

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
