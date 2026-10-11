# Database decision status — ARES-1

**Status: unresolved owner decision.** Earlier notes requested SQLite / said PostgreSQL was not needed. The current `game_ops` code, migrations, tests and VPS Compose implementation use PostgreSQL. Later instructions did not explicitly settle that conflict, so this document does not choose a final database on the owner's behalf.

## What is implemented

- `game/apps/backend/src/gameops/`, `game/migrations/game_ops/` and `game/tests/db/` implement the `game_ops` persistence layer on PostgreSQL.
- The current VPS plan uses a self-hosted PostgreSQL service, isolated by game and Solana cluster. No external managed PostgreSQL service is selected.
- `DB_RUNBOOK.md` documents the current PostgreSQL dev/test implementation and its operational checks. It is not approval to deploy the database to production.

## What is not decided or verified

- Whether the final deployment may use self-hosted PostgreSQL or must use SQLite.
- Whether a PostgreSQL VPS environment has been provisioned, migrated, backed up, or restored. None of those production actions is confirmed in this checkout.
- Whether the current PostgreSQL schema and operational controls have completed production acceptance.

Do not treat this as a resolved PostgreSQL decision. Do not silently replace the current code with SQLite or claim SQLite is supported: the PostgreSQL driver, migrations, role/privilege model, transaction behavior and integration tests would need a real SQLite port and new parity/security tests. Conversely, do not deploy PostgreSQL to production until the owner confirms that it is acceptable.

## Required next step

1. Owner confirms the final choice: self-hosted PostgreSQL, or SQLite.
2. If PostgreSQL is confirmed, follow the current [VPS runbook](../../docs/DEPLOY_BACKEND_VPS.md), keep each game/network isolated, never expose the database publicly, and rehearse encrypted backup restoration.
3. If SQLite is confirmed, implement and test the entire data layer before deployment; existing `game_ops` PostgreSQL instructions are not applicable to that implementation.

Current launch blockers and deployment status: [root launch checklist](../../docs/LAUNCH_NEXT_STEPS.md). Do not put database credentials in Git or chat.
