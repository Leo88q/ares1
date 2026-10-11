# Historical ARES-1 audit-gate record (2026-09-26) — NOT PASSED; NOT CURRENT

> This snapshot predates subsequent program, IDL, client, and operations changes. All dates, hashes, instruction/event counts, and tool results below are historical evidence—not assertions about the current checkout. No independent security audit, current deployment verification, or mainnet approval is represented here.

Scope of the original snapshot: `game/programs/solana_potato/src/` (there is no top-level `programs/`). It was a coverage report, **not** a clean audit. On 2026-10-11, `node game/scripts/audit-init-if-needed.mjs` regenerated the narrow SW016 literal inventory from one Rust source file: 27 `init_if_needed` occurrences, including comments. The script parses zero files and makes no vulnerability determination. It does not reproduce the hub's 43 findings. The negative fixture and generated evidence are checked by `node --test game/scripts/audit-init-if-needed.test.mjs` in CI.

- `command -v sentio; command -v solguard; command -v slam` returned no paths (exit status 1 for each command). No CLI scan was run. Do not interpret an empty findings list as zero critical/high.
- `node /tmp/watchtower-hub/scripts/check-ecosystem-target.mjs` failed: `MODULE_NOT_FOUND` (the cloned hub does not contain the script). `cat /tmp/watchtower-hub/prompts/arena/00_HUB_CONTRACT.md` and `cat /tmp/watchtower-hub/docs/ECOSYSTEM_MAXIMUM_TARGET.md` failed: `No such file or directory`.
- `cd watchtower && npm run verify:devnet` failed with `{"result":"runtime_smoke_failed","code":"INVALID_CONFIG","deploymentManifestVerified":false,"watchtowerConnected":false}`. No RPC credentials or exporter/database URL were configured. The manifest remains unverified; no network facts have been inferred.
- `node watchtower/scripts/sync-idl.mjs` passed: source IDL SHA-256 `107c6e2a2402d1d4e86a31d8c7f0d9c0157804655568af27d27ee402da752e14` (re-synced 2026-09-26 after the SKR-mint account docs; byte-identical to the CI-built `target/idl/solana_potato.json`), 30 events, 43 instructions. This checks repository artifacts, **not** deployed IDL.
- `cd watchtower && npm run typecheck && npm test && npm run test:os` passed: 99/100 exporter tests (one PostgreSQL integration skipped), 14/14 OS tests. No live `/watchtower/*` or hub admission was exercised.
- The machine-readable `watchtower/address-registry.json` intentionally has null for unverified split programs, mints, treasury, PDAs, multisig and timelock. The registry test checks consistency with Anchor, Rust, IDL and manifest, not custody or deployment.

## Blocking before production

Run a version-pinned static audit with negative tests for SW002/013/009/010/024/016/008/027; obtain independent review. Verify deployed program ownership, upgrade authority, timelock, IDL and transactions against devnet RPC, then update evidence and manifest. Establish custody and emergency pause procedures. Exercise real finalized ingestion, idempotency, 14 routes, SLO and restore. Farming/session keys/cNFT and cross-game integrations are **not** certified by this report.
