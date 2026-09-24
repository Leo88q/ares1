# ARES-1 audit gate — NOT PASSED

Scope: `game/programs/solana_potato/src/` (there is no top-level `programs/`). This is a coverage report, **not** a clean audit. `node game/scripts/audit-init-if-needed.mjs` read one Rust source file and recorded 21 literal `init_if_needed` occurrences under `SW016-source-inventory`, including comments. It parses zero files, makes no vulnerability determination, and does not reproduce the hub's 43 findings. The negative fixture and committed evidence are checked by `node --test game/scripts/audit-init-if-needed.test.mjs` in CI.

- `command -v sentio; command -v solguard; command -v slam` returned no paths (exit status 1 for each command). No CLI scan was run. Do not interpret an empty findings list as zero critical/high.
- `node /tmp/watchtower-hub/scripts/check-ecosystem-target.mjs` failed: `MODULE_NOT_FOUND` (the cloned hub does not contain the script). `cat /tmp/watchtower-hub/prompts/arena/00_HUB_CONTRACT.md` and `cat /tmp/watchtower-hub/docs/ECOSYSTEM_MAXIMUM_TARGET.md` failed: `No such file or directory`.
- `cd watchtower && npm run verify:devnet` failed with `{"result":"runtime_smoke_failed","code":"INVALID_CONFIG","deploymentManifestVerified":false,"watchtowerConnected":false}`. No RPC credentials or exporter/database URL were configured. The manifest remains unverified; no network facts have been inferred.
- `node watchtower/scripts/sync-idl.mjs` passed: source IDL SHA-256 `bee20b8f2b1d06bba41e435ca5eb7f6f76b5b70690573464d43c3e09efb499ac`, 30 events, 43 instructions. This checks repository artifacts, **not** deployed IDL.
- `cd watchtower && npm run typecheck && npm test && npm run test:os` passed: 99/100 exporter tests (one PostgreSQL integration skipped), 14/14 OS tests. No live `/watchtower/*` or hub admission was exercised.
- The machine-readable `watchtower/address-registry.json` intentionally has null for unverified split programs, mints, treasury, PDAs, multisig and timelock. The registry test checks consistency with Anchor, Rust, IDL and manifest, not custody or deployment.

## Blocking before production

Run a version-pinned static audit with negative tests for SW002/013/009/010/024/016/008/027; obtain independent review. Verify deployed program ownership, upgrade authority, timelock, IDL and transactions against devnet RPC, then update evidence and manifest. Establish custody and emergency pause procedures. Exercise real finalized ingestion, idempotency, 14 routes, SLO and restore. Farming/session keys/cNFT and cross-game integrations are **not** certified by this report.
