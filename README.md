# ARES-1 - Potato Colony on Solana

First potato colony on Mars. Grow, trade, upgrade - 100% of $POTATO is born in players' hands.

## Demo

- Landing: https://ares1.is-a.dev
- Game: https://play.ares1.is-a.dev
- Network: Solana Devnet

## Structure

    ares1/
    |-- landing/          <- React + Vite landing
    |   |-- App.tsx       <- sections, hero, packs
    |   |-- content.ts    <- all content + chainConfig
    |   +-- hooks/        <- useLandingWallet (Phantom)
    +-- game/             <- Solana program + React client
        |-- apps/web/     <- React game frontend (Vite)
        +-- programs/     <- Anchor program (Rust)

## Stack

- Contract: Solana + Anchor + Rust
- Landing: React 18 + Vite 6 + Framer Motion
- Game: React 18 + Vite + @solana/web3.js
- Network: Solana Devnet

## Run locally

Landing:

    cd landing
    npm install
    npm run dev   # http://localhost:5173

Game:

    cd game
    npm install
    cd apps/web && npm run dev   # http://localhost:5175

Deploy contract:

    cd game
    anchor deploy --provider.cluster devnet
    anchor run initialize

## Mechanics (Phase 1)

- Harvest: $POTATO accrues per field with lunar cycle (0.85x - 1.15x)
- Mutations: 5% chance on upgrade - Golden (+25% yield) or Silicon (decay x0.5)
- Tax: 2-10% on harvest, penalty if unpaid
- License: 500 SKR / 30 days -> -3% market fee (buy in CABIN)
- Market: escrow orders, fee 9-12% (60% burn + 40% treasury)
- Referrals: -1% fee for both, +0.5% to referrer
- Presale: 1053 SKR per module, tier rolls randomly (COMMON 70% / RARE 25% / EPIC 5%)

## License

MIT - Zlata, 2026

## Stabilization / beta readiness

Current validation and remaining release blockers: [21 Sep 2026 status](game/docs/STABILIZATION-2026-09-21.md).
Security: [checklist audit 1–30](docs/SECURITY_CHECKLIST_AUDIT_2026-09-25.md), [extended audit 31–70](docs/SECURITY_CHECKLIST_AUDIT_2026-09-26.md), [mainnet launch gate](game/docs/MAINNET_LAUNCH_GATE.md).
Build, key handling, Docker and incident procedures: [Operations](game/docs/OPERATIONS.md).
No real-funds/mainnet readiness is claimed.

## Read-only Watchtower integration

The isolated exporter, event decoder, PostgreSQL read-model and verification runbook
are in [watchtower/](watchtower/README.md). No signing capability or game-rule changes.
Devnet verification and central Games Watchtower connection are **not yet confirmed**.
