# ARES-1 — Solana potato-colony game

**Status: devnet-beta preparation only.** No mainnet ARES-1 deployment, live presale run, or acceptance of real funds has been confirmed or approved. The V2 marketplace and season ledger are drafts, not a released program. See [launch readiness](docs/LAUNCH_NEXT_STEPS.md) before treating any build or URL as a live service.

## Configured web origins

- Landing: `https://ares1-7e1.pages.dev`
- Game: `https://ares1-play.pages.dev`

These are the configured Cloudflare Pages origins recorded in the repository; **their current ownership, deployment, and availability were not re-verified in this checkout**. Do not promote them until an operator verifies them. The custom `ares1.is-a.dev` / `play.ares1.is-a.dev` aliases were reported unregistered on 2026-10-06; that report is not a live check for today. Do not link to those aliases, publish them as official, or send users or security reports to an email at those names. GitHub Security Advisory reporting is configured in the shipped `security.txt`; verify private vulnerability reporting is enabled before relying on it.

Devnet SOL and SKR have no monetary value. The free devnet beta is separate from the mainnet Phase 1 rail. Mainnet writes remain fail-closed; this README is not launch approval.

## Repository layout

- `landing/` — React/Vite marketing site and Cloudflare Pages function source.
- `game/` — Anchor/Solana program, React client, backend API/epoch crank, migrations, and tests.
- `watchtower/` — isolated read-only exporter and verification tooling.
- `transfer/` — handoff tooling for a separate repository; its optional apply/commit/push scripts are not part of routine CI.

This checkout contains ARES-1 only. It does not contain the other two game repositories.

## Current decisions and boundaries

- The deployment target is Cloudflare Pages plus isolated VPS Compose projects; no VPS or production environment has been provisioned from this workspace.
- The backend process may host the API and epoch crank together. Only a dedicated low-privilege crank payer may be placed on the VPS. Authority, reward-signer, treasury, program, and Squads keys must remain off-host in cold/hardware-controlled storage.
- The current Phase 1 implementation accepts native SOL only on mainnet and rejects SKR there. Mainnet presale writes are disabled by default; no run is approved or open.
- The current on-chain devnet market is legacy V1 (POTATO/SOL). The approved V2 goal is seller-paid 9–12% of quote proceeds, paid to the treasury in the same settlement asset (SOL or SKR), with a separate POTATO/SKR pair and anti-fragmentation tiers. V2 is not released; its feature flag remains off by default. Do not apply both the old POTATO fee and the new quote-asset fee.
- The repository implements PostgreSQL for `game_ops`. Whether PostgreSQL is acceptable as the final choice remains unresolved; choosing SQLite requires an actual data-layer port and tests. No external managed PostgreSQL is selected.
- The owner’s 2026-10-06 decision removed public legal pages from the repository. That is not legal clearance; terms, refunds, delivery obligations, and required notices remain launch gates.

## Current documentation

- [Launch status and blockers](docs/LAUNCH_NEXT_STEPS.md)
- [Owner-approved product and revenue checklist](docs/ARES1_PRODUCT_HYPE_REVENUE_CHECKLIST_2026-10-11.md)
- [Cloudflare + VPS operations plan](docs/DEPLOY_BACKEND_VPS.md)
- [Game implementation and developer setup](game/README.md)
- [Mainnet launch gates](game/docs/MAINNET_LAUNCH_GATE.md)
- [Operations and key custody](game/docs/OPERATIONS.md)
- [Database implementation status](game/docs/DATABASE_DESIGN.md) and [PostgreSQL runbook](game/docs/DB_RUNBOOK.md)
- [Incident response](game/docs/INCIDENT_RESPONSE.md)
- [Player guide (devnet draft)](game/docs/USER_GUIDE.md)
- [Internal audit-gate evidence](reports/ares1-audit.md) — not an independent security audit.
- [Historical rent-audit measurements](reports/rent-audit/FINAL.md)
- [Third-party attribution](THIRD_PARTY_LICENSES.md)

The old Phase 1 RFC/runbook, six-month roadmap, and unused raster-asset wish list were removed because they no longer match the current implementation or decisions. The 2026-10-06 production checklist is retained under [`docs/archive/`](docs/archive/) as historical evidence, not an active runbook.

## Local checks

Use the pinned toolchains documented in `game/README.md` and `game/docs/OPERATIONS.md`. From the repository root:

```sh
./scripts/install-git-hooks.sh
node scripts/secret-scan.mjs
```

For a safe devnet/local development flow, follow [the local Mac runbook](LOCAL_MAC_RUNBOOK.md) and [the local presale/game walkthrough](LOCAL_PRESALE_PLAY.md); both are developer-only and use valueless devnet assets. `anchor test` uses a local validator. Do not point destructive tests or database tools at production.

The CI workflows test source, builds, and selected read-only monitoring paths; none deploys to mainnet. Mainnet launch requires all code, custody, legal, RPC, database, external review, delivery, monitoring, and recovery gates to be completed and a separate explicit owner GO/NO-GO. Never put keys, RPC credentials, tokens, or database secrets in chat or Git. Do not rewrite Git history.

## License status

No repository-wide license has been confirmed here. Do not assume the code is MIT-licensed from an old README statement; resolve the owner/legal decision and add the authoritative license file before public reuse or commercial release.
