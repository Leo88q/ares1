# ARES-1 launch readiness — 2026-10-11

**Status: closed devnet beta preparation. No mainnet deployment, live run, or real-payment acceptance has been performed.**
This is an implementation/status checklist, not approval to launch. The owner’s 2026-10-06 decision removed public legal pages from the repository; that is not legal clearance, and terms/refunds/delivery obligations/notices remain launch gates. The [ARES-1 product checklist](ARES1_PRODUCT_HYPE_REVENUE_CHECKLIST_2026-10-11.md) records the owner-approved season and seller-paid 9–12% quote-asset fee decisions. A V2 source/client/UI draft now exists, but the generated IDL is stale, the Anchor source is unbuilt/unverified, and the verified season ledger is not implemented. None of these decisions authorizes a public V2 release or mainnet.

## Scope and boundary

- Workspace contains **ARES-1 only**. The other two game repositories are not present, so no claim is made that all three games are implemented. Provide the two repositories before that work can be scoped.
- Devnet remains a free sandbox. Progress does not carry over; devnet SOL/SKR have no real value.
- Phase 1 is a separate off-chain SOL presale on Solana mainnet, with its own order ledger and database. Do not reuse the devnet DB, treasury, program configuration, RPC, or Compose project.
- This repository does not confirm a mainnet ARES-1 program deployment or a verified mainnet reward-delivery path. Do not promise a delivery date or accept real funds until those are approved and tested.
- Prior notes asked for SQLite, while the current Phase 1 implementation and Compose stack depend on PostgreSQL. This choice is **not resolved**. The VPS runbook describes current PostgreSQL support; choosing SQLite would require a real DB-layer port and new tests first.

## What the code now enforces

1. `SOLANA_CLUSTER` is explicit in production, and backend startup checks the RPC genesis hash before serving or starting the epoch crank.
2. A migrated `game_ops` database is pinned to one cluster (`0007_presale_cluster_binding.sql`). Startup and presale CLIs fail if a database bound to devnet is pointed at mainnet, or vice versa.
3. Mainnet Phase 1 only accepts native SOL. SKR run creation/reservation/verification is rejected on mainnet; the current SKR mint is devnet-only.
4. Real mainnet presale writes are fail-closed by default. `PRESALE_MAINNET_LIVE_APPROVED=false` is the documented default; only production plus an explicit approval flag enables the gated write routes. Devnet presale writes are separately disabled unless `PRESALE_DEVNET_TEST_ENABLED=true` is set for isolated tests.
5. A run stores `started_slot` (migration 0008). SOL treasury reconciliation paginates the **finalized** signature history from that slot, resolves loaded addresses for versioned transactions, and fails rather than reporting a partial green result when history is unavailable.
6. Buyer instructions display a human-readable amount with the currency, not raw lamports/atoms. The UI reflects server cluster and payment gates; Phase1Notice does not embed an approved sale price. It displays only a run configured in the backend.
7. Epoch crank remains in the backend API process. A dedicated low-privilege payer is permitted; authority, treasury, reward-signer, Squads and program keys must stay off the VPS.
8. The cold-key treasury CLI wraps the existing two-step withdrawal ABI for devnet only. It checks genesis hash, authority, limits, pending amount and timelock, requires typed TTY confirmation, and refuses direct-key mainnet writes; a Squads-compatible mainnet workflow is still missing.
9. The draft V2 UI has the public build-time rollout flag `VITE_MARKET_V2_ENABLED`, shipped as `false`; the normal app still uses legacy V1. Do not enable the flag until the matching binary is deployed to that cluster and the draft tier boundaries are approved.

These protections reduce accidental cross-network and UX failures; they do **not** replace review, audits, operational approval, or a mainnet deployment rehearsal.

## Phase 1 capability vs launch readiness

The repo contains order reservation, payment signature attachment, SOL/SKR verification code, admin review/delivery endpoints, reconciliation, a PostgreSQL registry, a Cloudflare Pages API proxy, and the landing UI. That confirms implementation pieces exist, **not** readiness to collect real funds.

Mainnet remains blocked until all of the following are confirmed:

- mainnet program ID, upgrade authority/governance and production `GameConfig` are verified on the actual mainnet RPC;
- reward delivery can be safely completed against the approved mainnet program; no devnet address or devnet mint may be used;
- treasury address, SOL denomination, price, cap, order expiry, terms/refund/delivery obligations and launch schedule have explicit human approval;
- mainnet RPC provider(s), rate limits, archive/history retention, CORS and Cloudflare/VPS routing have been tested;
- external program/security review and the repository's mainnet launch gates are complete;
- the separate mainnet PostgreSQL DB has migrations 0001–0008 applied and verified, is pinned to `mainnet-beta`, and a restore has been rehearsed;
- a low-balance crank payer has been provisioned separately from every authority/treasury signer;
- a final canary/test plan, monitoring/alerts, stop procedure and rollback have been rehearsed.

Do not set `PRESALE_MAINNET_LIVE_APPROVED=true`, run `presale:open-run` on mainnet, or announce a sale before these gates and human approvals are complete. Never put private keys, tokens, RPC secrets or database credentials in chat or Git.

## Deployment target

Selected target is **Cloudflare + VPS**, not Flux:

- Cloudflare Pages hosts the frontends. `functions/api/[[path]].js` forwards `/api/*` using `PRESALE_API_ORIGIN`.
- VPS Compose runs API + epoch crank and a self-hosted PostgreSQL service. Compose project names, environment files, key mounts, ports and volumes must be distinct for each game and each Solana cluster.
- The production origin should be reached through a Cloudflare-protected HTTPS reverse-proxy path (Cloudflare Tunnel is the intended low-exposure option); only `/live`, `/ready` and the required API routes are public. Do not expose Postgres.
- GHCR publication is configured to happen only after the full `CI` workflow succeeds on `main`. It does not deploy to a VPS.
- `docs/DEPLOY_BACKEND_VPS.md` is the current operations checklist. No VPS, DNS, Cloudflare Pages variable, tunnel, GHCR image, backup job or live environment has been provisioned/changed from this workspace.
- `game/ops/backup-postgres-to-r2.sh` is a prepared encrypted backup script. It has not been run against a VPS or R2; configure cold age-recipient and R2 credentials on the host, a scheduler and retention lifecycle, then rehearse restoration before production.

## Verification performed in this checkout

- Latest V2 UI/formatter pass: `yarn workspace web exec tsc --noEmit`, `yarn typecheck:tools`, and `yarn test:offchain` — **125/125** passed; `yarn workspace web test` — **6/6** passed, including locale parity, default-off/V1-legacy access, exact integer formatting, and the SKR-mint escrow-recovery guard. `VITE_MARKET_V2_ENABLED=true yarn build:web` passed (7,700 modules). This verifies source, tests and a bundle only — not a deployed program or transaction path.
- Earlier full-repo checks recorded in this checkout: `yarn typecheck` (game web + backend), `npm run build` (landing), backend tests — **88/88**, `yarn test:guards` — **53/53**, `yarn test:db:unit` — **17/17**, landing tests — **12/12**, and backend production build passed. These do not substitute for currently unavailable Rust/validator checks.
- `python3 economy/simulate.py --check` — passed (7 scales, tax formula, 9 pinned constants, 3 scenarios). The economics simulator is explicitly labeled as legacy V1 for market fees and is not a V2 revenue forecast.
- The V2-enabled game build emitted dependency notices for browser-externalized `crypto`/`stream` and stripped Rollup pure annotations. Landing production bundle built successfully.
- Landing and game production-preview servers run on ports 4173 and 4174. Chromium mobile QA passed for the English landing at 320/390×844 (no horizontal overflow; header fits; primary CTA clears the compact consent card; Reject closes it) and game at 390×844 (Plant → Water ×2 → Harvest → Reset; Operation OFFLINE; Share Card PNG download fallback). Stats rendered the lunar panel and mutation-archive shell using mock RPC and an empty field list. This is a partial UI smoke, not live-chain or wallet-signing QA: connected-wallet/active-mutation rendering, native Web Share, real devnet transactions, other locales and physical phones remain untested. The new V2 screen has been typechecked and built with the feature flag on, but no browser button/wallet transaction rehearsal has been performed; the flag remains off by default. A V2-enabled preview on port 5175 used the documented public devnet fallback and returned HTTP 200 at `/`; no browser binary was available for visual or button QA.
- Compose and GitHub Actions YAML had previously been parsed with `js-yaml`; `bash -n game/ops/backup-postgres-to-r2.sh` passed. This is not a substitute for `docker compose config` or a live container test.
- `npm audit --omit=dev` for the landing — 0 findings in the earlier audit. Full landing development/build dependency tree reported 15 advisories (6 high); no major dependency upgrade was attempted.
- `git diff --check` — clean.
- Rust/Anchor toolchain and local validator are unavailable in this sandbox. The V2 Rust source draft exists, but its compile/unit tests, on-chain SOL/SKR fee/treasury flows, generated IDL and devnet wallet/treasury rehearsal were **not** run. Mainnet Squads withdrawal flow, live Postgres migration/container run, `docker compose config`, image publication, VPS deployment and R2 backup/restore were also **not** run.

## Next human-owned actions

1. Confirm whether current self-hosted PostgreSQL is acceptable or SQLite is still mandatory.
2. Confirm/complete Helius credential rotation and independently verify RPC access; do not paste credentials into chat.
3. Provide the missing game repositories for the other two titles.
4. Complete governance, audit, treasury, price/cap/terms and mainnet program/delivery approvals.
5. Provision isolated VPS/Cloudflare environments and credentials; apply migrations 0001–0008 to the proper per-cluster DB; verify network pinning.
6. Test the devnet beta as free, including the epoch crank, API, browser flow and rollback/recovery.
7. Only after all mainnet gates: prepare a reviewed mainnet image/config, run read-only preflight, rehearse restore and kill-switch, then obtain explicit approval before opening a mainnet run.
