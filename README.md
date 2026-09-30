# ARES-1 - Potato Colony on Solana

First potato colony on Mars. Grow, trade, upgrade - 100% of $POTATO is born in players' hands.

## Demo

- Landing: https://ares1-7e1.pages.dev (домен `ares1.is-a.dev` **не зарегистрирован** в is-a.dev — см. docs/DOMAIN_DEPLOY_FINDINGS_2026-09-30.md)
- Game: https://ares1-play.pages.dev (алиас `play.ares1.is-a.dev` отдаёт ошибку TLS: не привязан к проекту Cloudflare Pages)
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
- Hosting: Cloudflare Pages (`ares1` for the landing, `ares1-play` for the game client)

Production HTTP headers and redirects live in `landing/public/_headers` and
`landing/public/_redirects` — both are understood by Cloudflare Pages and by Netlify.
`landing/netlify.toml` holds build configuration only: Cloudflare Pages ignores it, so
platform rules must not be added there.

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

## Production deploy readiness

Website and app preparation for a production deploy: [checklist audit and remediation](docs/PRODUCTION_DEPLOY_CHECKLIST.md)
(secrets and history, source exposure, OWASP, cookies/GDPR, legal pages, operability).

Run locally before pushing:

```sh
./scripts/install-git-hooks.sh        # once per clone: pre-commit secret gate
node scripts/secret-scan.mjs          # working tree (§1.1)
node scripts/secret-scan-history.mjs  # all fetched history (§1.2.1)
node scripts/build-legal-pages.mjs --check

# after building both apps:
node scripts/check-release-artifacts.mjs landing/dist game/apps/web/dist

# against a live deployment (needs network access to the host):
./scripts/check-headers.sh https://ares1.is-a.dev
./scripts/check-public-exposure.sh https://ares1.is-a.dev
```

## Stabilization / beta readiness

Current validation and remaining release blockers: [21 Sep 2026 status](reports/ares1-audit.md).
Security: [checklist audit 1–30](docs/SECURITY_CHECKLIST_AUDIT_2026-09-25.md), [extended audit 31–70](docs/SECURITY_CHECKLIST_AUDIT_2026-09-26.md), [AI-agents / audit poisoning / durable nonce 71–82](docs/SECURITY_CHECKLIST_AUDIT_2026-09-27.md), [incident catalog 94–130 (governance, keys, signers, frontend, people, infrastructure)](docs/SECURITY_CHECKLIST_AUDIT_2026-09-28.md), [mainnet launch gate](game/docs/MAINNET_LAUNCH_GATE.md).
Data: [database design recommendation](game/docs/DATABASE_DESIGN.md), [test runs and capacity](docs/DATA_TESTS_AND_CAPACITY_2026-09-27.md), [reference storage example reviewed](docs/STORAGE_REFERENCE_EXAMPLE_2026-09-27.md).
Build, key handling, Docker and incident procedures: [Operations](game/docs/OPERATIONS.md),
[incident response kit](game/docs/INCIDENT_RESPONSE.md), [key provenance](game/docs/KEY_PROVENANCE.md),
[third-party dependency registry](game/docs/THIRD_PARTY_DEPENDENCIES.md).
On-chain program inventory: `game/program-inventory.json` + `node game/scripts/inventory-programs.mjs`;
domain monitoring: `node scripts/check-dns.mjs` (baseline committed at `scripts/dns-baseline.json`).
No real-funds/mainnet readiness is claimed.

## Read-only Watchtower integration

The isolated exporter, event decoder, PostgreSQL read-model and verification runbook
are in [watchtower/](watchtower/README.md). No signing capability or game-rule changes.
Devnet verification and central Games Watchtower connection are **not yet confirmed**.
