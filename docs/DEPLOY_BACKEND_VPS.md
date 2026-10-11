# Backend deployment: Cloudflare + VPS

**This is the selected target, not a completed deployment.** The repository has not been deployed to a VPS; no Cloudflare DNS, Tunnel, Pages variable, GHCR package, R2 bucket, or production secret has been created/changed from this checkout. Do not open a mainnet run from these instructions until the mainnet launch gates are approved.

## 1. Shape of the deployment

```text
Browser
  ├─ Cloudflare Pages: landing + game frontend
  └─ Cloudflare edge / Tunnel: API host
       └─ VPS loopback port (per game + cluster)
            └─ Docker Compose project (per game + cluster)
                 ├─ API + epoch crank (one backend process/service)
                 └─ private PostgreSQL 18 service and persistent volume
```

- Cloudflare account/billing can be shared. Keep **one Compose project, environment file, DB volume, DB, RPC, program config, API hostname, and payer** per game/network combination.
- Recommended ingress is a Cloudflare Tunnel to the backend's loopback-bound host port. This avoids publishing the API or PostgreSQL port to the Internet; TLS is provided at the public Cloudflare hostname and traffic reaches the tunnel over the authenticated connector. The tunnel is host-managed and is not bundled in this repository.
- The Compose API and crank are the same service; do not deploy a second crank process. PostgreSQL is internal to the Compose project; its optional host port is loopback-only for setup, dump and restore.
- The API process needs only a dedicated low-balance epoch payer. Keep authority, treasury, Squads, deploy, reward signer and program keys off the VPS and out of its secret store.
- The optional mainnet presale has an explicit write gate; it is off by default. The source code is not proof of mainnet deployment, audit, treasury ownership, price approval or delivery readiness.

## 2. Decisions/blockers before provisioning

1. **Database choice:** current Phase 1, migrations, advisory lock and Compose use PostgreSQL. An earlier requirement mentioned SQLite; that conflict is not resolved. This guide describes the existing self-hosted PostgreSQL path. If SQLite remains mandatory, stop here: a tested SQLite port is required first.
2. Confirm whether each game and each cluster gets its own VPS, or separate Unix users/Compose projects on one VPS. The examples use one isolated project and volume per combination.
3. Confirm the Cloudflare API hostname(s), Pages project(s), allowed browser origins, and whether each environment gets a separate Tunnel.
4. Provision human-owned treasury/program governance, production RPC and monitoring. Never send secret values in chat.

## 3. Image publication (no deployment)

`.github/workflows/backend-image.yml` publishes a commit-tagged backend image to GHCR only after the full `CI` workflow succeeds on `main`. It also updates the mutable `:main` tag for convenience. **It does not deploy a VPS.** For deployment, pin `BACKEND_IMAGE` to the immutable commit tag or digest, not `:main`.

The VPS must be authorized to pull the GHCR package. Store any package-read credential in the VPS secret manager or root-owned Docker credential store; do not put it in this repository or a command transcript.

## 4. One isolated Compose project

Use one Compose project name per instance; Compose automatically prefixes named volumes and creates a separate network. Host ports must also be unique. The Compose file supports per-instance `BACKEND_IMAGE`, `POSTGRES_IMAGE`, `BACKEND_ENV_FILE`, `BACKEND_KEY_DIR`, `GAME_OPS_BACKEND_PORT`, and `GAME_OPS_POSTGRES_PORT`. Pin both backend and PostgreSQL images by reviewed digest in each production Compose env file; update the Postgres digest only as a separately reviewed database maintenance change, not as an incidental app release.

Example non-secret Compose settings, stored outside Git in a root-readable instance file such as `/etc/ares1/instances/ares1-devnet/compose.env`:

```dotenv
BACKEND_IMAGE=ghcr.io/leo88q/ares1-backend@sha256:<reviewed-backend-image-digest>
POSTGRES_IMAGE=postgres:18@sha256:<reviewed-postgres-image-digest>
BACKEND_ENV_FILE=/etc/ares1/instances/ares1-devnet/backend.env
BACKEND_KEY_DIR=/etc/ares1/instances/ares1-devnet/keys
GAME_OPS_BACKEND_BIND=127.0.0.1
GAME_OPS_BACKEND_PORT=8080
GAME_OPS_POSTGRES_PORT=5432
GAME_OPS_POSTGRES_PASSWORD=<unique-random-secret>
MIGRATION_DATABASE_URL=<private-DDL-capable-PostgreSQL-DSN-configured-out-of-band>
R2_BACKUP_REMOTE=ares1-r2:encrypted-backups
BACKUP_AGE_RECIPIENT_FILE=/etc/ares1/instances/ares1-devnet/backup-age-recipient.txt
COMPOSE_PROJECT_NAME=ares1-devnet
```

The angle-bracket strings above are placeholders, not usable credentials. Use URL-encoded credentials in PostgreSQL URLs (or a URL-safe random password), and protect actual files with restrictive owner/group/mode; do not print their resolved contents. `MIGRATION_DATABASE_URL` is the DDL-capable setup/migration credential; the current self-hosted Compose bootstrap uses its local `postgres` superuser. Keep it in the protected Compose env file and never pass it to the backend runtime. `BACKEND_ENV_FILE` should contain the app's `GAME_OPS_DATABASE_URL` for the non-superuser `ares1_backend` login, `GAME_OPS_DB_ROLE=game_ops_writer`, `ADMIN_API_TOKEN`, RPC URL(s), `SOLANA_CLUSTER`, `PROGRAM_ID`, CORS, crank schedule and alerts. Compose mounts the dedicated payer directory read-only at `/app/keys`; it must contain `epoch-payer.json`. The runtime image runs as `node`, so verify that image's numeric UID/GID and grant only that container identity read access to the payer file (for example, root-owned `0440` file and `0750` directory with a dedicated group); do not make it world-readable. Each cluster has its own payer key.

For every distinct game/network, use a new project name, settings file, backend environment file, key directory, host ports, Pages variables, API hostname and Postgres volume. Example mapping:

| Instance | Compose project | Cluster | Backend host port | PostgreSQL host port |
| --- | --- | --- | ---: | ---: |
| ARES-1 devnet | `ares1-devnet` | `devnet` | 8080 | 5432 |
| ARES-1 mainnet | `ares1-mainnet` | `mainnet-beta` | 8081 | 5433 |
| Game 2 devnet | `game2-devnet` | `devnet` | 8090 | 5442 |

These are example port allocations only. The Postgres listener remains bound to loopback and is never a public service. Do not point two projects at one `GAME_OPS_DATABASE_URL`; migration 0007 also write-once binds a DB to one Solana cluster.

### First initialization

Use the exact image digest under review and keep all secrets in the out-of-repository instance files. The commands below assume the Compose file is checked out at `/opt/ares1/game/docker-compose.yml` and the instance settings file is on the host:

```bash
cd /opt/ares1/game
PROJECT=ares1-devnet
ENV=/etc/ares1/instances/$PROJECT/compose.env

docker compose -p "$PROJECT" --env-file "$ENV" pull postgres migrate backend
docker compose -p "$PROJECT" --env-file "$ENV" up -d --no-build postgres migrate
# Wait for postgres healthy and migration service to exit 0.
```

Then create the runtime login/role from the migration owner. Run the tools from a controlled checkout matching the image source revision (install its locked dependencies with `yarn install --frozen-lockfile`), either on the VPS or from an operator workstation through an SSH local port-forward to the loopback-only Postgres port. Supply `MIGRATOR_URL` and role passwords from the approved secret store; keep them out of command arguments/output:

```bash
cd /opt/ares1/game
GAME_OPS_DATABASE_URL="$MIGRATOR_URL" \
GAME_OPS_WRITER_PASSWORD="$WRITER_PASSWORD" \
GAME_OPS_READER_PASSWORD="$READER_PASSWORD" \
yarn db:roles --writer-login=ares1_backend --reader-login=ares1_dash

GAME_OPS_DATABASE_URL="$MIGRATOR_URL" yarn db:verify
```

`MIGRATOR_URL` should be supplied as a shell environment variable from the secret store before the command block; it is consumed through `GAME_OPS_DATABASE_URL`, not a command-line argument. The app URL must use the `ares1_backend` login and `game_ops_writer` role, not the Postgres superuser. Apply migrations before traffic; startup refuses the wrong database cluster. Then start the API and crank:

```bash
docker compose -p "$PROJECT" --env-file "$ENV" up -d --no-build backend
```

Before using this flow operationally, verify the Compose version supports `service_completed_successfully`, the image digest is present in GHCR, the migration one-shot is successful, and `/ready` returns the complete schema version. Docker is unavailable in this coding sandbox, so Compose parsing and a real startup were not tested here.

## 5. Environment/network rules

Backend `.env` is separate for each instance. Relevant required values include:

| Variable | Devnet instance | Mainnet instance |
| --- | --- | --- |
| `NODE_ENV` | `production` on VPS | `production` |
| `SOLANA_CLUSTER` | `devnet` | `mainnet-beta` |
| `RPC_URL` | dedicated devnet RPC | dedicated mainnet RPC |
| `RPC_URL_SECONDARY` | independent provider for production signing | independent provider from a different vendor; required by production policy |
| `REQUIRE_SECONDARY_RPC` | keep production default/`1` | keep production default/`1`; `0` is an explicit security downgrade, not a troubleshooting toggle |
| `PROGRAM_ID` | verified devnet program ID | only after verified mainnet delivery path exists |
| `GAME_OPS_DATABASE_URL` | per-project DB, `ares1_backend` | a different per-project DB, `ares1_backend` |
| `PRESALE_DEVNET_TEST_ENABLED` | `false` for free beta | ignored |
| `PRESALE_MAINNET_LIVE_APPROVED` | `false` | **`false` until all launch gates have human approval** |
| `CORS_ORIGIN` | exact frontend origins | exact production frontend origins |
| `TRUST_PROXY` | configure for the selected Tunnel/proxy and test spoofing | same, fail closed |

Startup compares `RPC_URL` genesis hash to `SOLANA_CLUSTER`. `GET /health` includes the selected cluster. Do not use a public RPC that is rate-limited as the production RPC; configure an archival-capable provider for payment history and test its `getTransaction` retention.

Mainnet run creation additionally rejects SKR and records a `started_slot` for finalized reconciliation. `scripts/presale-open-run.ts` checks RPC genesis, DB cluster binding, `NODE_ENV=production`, the explicit approval flag and native SOL. Before a live run, execute `presale:reconcile` against the exact mainnet run/treasury and confirm zero drift with finalized history. Do not use a devnet run/DB or change the launch flag to “test the form.” A production mainnet environment must not accept money until the program, treasury, price/cap, legal terms and security gates are signed off.

## 6. Cloudflare Pages and API ingress

- Pages project(s) host the frontend(s). Set `PRESALE_API_ORIGIN=https://<instance-api-host>` in each Pages environment, without an `/api` suffix; the Pages Function forwards `/api/*` to it.
- Set `VITE_BACKEND_URL` for the game frontend only where gameops/presale status needs it. `VITE_*` values are public in the browser bundle. Set `CORS_ORIGIN` to exact frontend origins.
- Create separate hostnames/routes per game and network. A Cloudflare Tunnel route targets the instance's loopback host port, for example `http://127.0.0.1:8080`; use 8081 for a separate mainnet project. Keep the tunnel token in the host's protected credential store, not in Git or app environment files.
- Restrict public Cloudflare routes to the required API surface and configure WAF/rate rules. Test `/live`, `/ready`, `/health`, browser CORS, rate-limit behavior, forwarding headers and spoofed `X-Forwarded-For` before launch. `TRUST_PROXY` must reflect the verified hop chain; do not blindly set a proxy hop count.
- Postgres and the API's direct host port stay loopback-only. Firewall the VPS so only SSH/admin access and the Tunnel egress are needed. If using a public HTTPS reverse proxy instead of Tunnel, terminate TLS there, allow only 80/443 at the firewall, and configure origin trust/rate limiting before traffic.

No Cloudflare setting, hostname, Pages variable, Tunnel, WAF rule or certificate has been changed by this work.

## 7. Health, deployment, rollback

### Manual release sequence

Maintain a protected release env file containing the reviewed immutable `BACKEND_IMAGE` digest and the same instance-specific settings. Before touching the current environment, record the running image digest, container health, DB/schema verification result, latest backup age and current source SHA.

```bash
cd /opt/ares1/game
PROJECT=ares1-devnet
ENV=/etc/ares1/instances/$PROJECT/compose.env

docker compose -p "$PROJECT" --env-file "$ENV" pull migrate backend
docker compose -p "$PROJECT" --env-file "$ENV" up -d --no-build migrate
# Confirm migrate exited 0 and inspect its logs before changing backend traffic.
docker compose -p "$PROJECT" --env-file "$ENV" ps -a migrate
docker compose -p "$PROJECT" --env-file "$ENV" logs --no-color migrate
docker compose -p "$PROJECT" --env-file "$ENV" up -d --no-build backend
```

Probe `/live`, `/ready`, `/health` through the intended origin and verify the selected cluster, config, payer and database readiness. If migration fails, **do not** start the new backend or open presale writes; capture logs, keep the previous backend in service if safe, and investigate.

### Rollback

Migrations have no down migration. Restore the previous image digest in the protected Compose env, pull it, and only restart the backend if that old binary is confirmed compatible with every migration already applied. Do **not** reset the DB or automatically restore an old backup just to roll back application code. If compatibility is uncertain, leave writes closed, keep the API stopped or on the last known compatible build, and roll forward with a reviewed fix. Save the prior and new image digests and schema version in the incident record.

- `/live` is process liveness; Compose healthcheck uses it.
- `/ready` checks chain and `game_ops` schema/reconciliation; use it as readiness, not liveness. On a fresh DB, no reconciliation is reported as a warning (not a 503); do not interpret that as a clean presale reconciliation. Mainnet preflight must run `presale:reconcile` and inspect its result.
- `/health` includes chain slot/config, payer balance, `gameOps` and cluster. Use an external synthetic monitor (not only a check from the same VPS) for public HTTPS `/live` and `/ready`; alert on readiness loss, crank failures, low payer, DB failure, stale reconciliation, Tunnel disconnect, backup age and VPS disk pressure. `/health` is not an epoch-crank success guarantee.
- `ALERT_WEBHOOK_URL` can deliver the backend's epoch-failure/startup alerts; store it only in the protected backend environment and test it on devnet. Also alert on Docker unhealthy state: `restart: unless-stopped` handles process exit but Docker Compose does not automatically restart a still-running unhealthy process.
- Backend logs go to Docker; configure bounded log rotation and a remote log/alert destination. Monitor host memory/CPU and persistent-volume capacity. Do not expose admin tokens or full DSNs in logs. The service has no Prometheus metrics endpoint; do not assume one exists.
- Deploy a pinned GHCR digest only after CI succeeds and a reviewer approves it. Save the prior digest and source SHA. Run migrations through the one-shot `migrate` service before switching backend traffic. Migrations are additive/checksum-protected; there is no down migration. Rollback means restoring the prior API image only after confirming it remains compatible with the newer schema.
- To stop new presale writes, keep/return `PRESALE_MAINNET_LIVE_APPROVED=false` and close any open run. Admin close-run and the refund-status recording endpoint remain available with the live gate disabled. **The refund endpoint only records order state in PostgreSQL; it does not send SOL.** Any actual on-chain refund requires a separate, approved treasury-signing procedure and subsequent reconciliation. Never restart with the flag enabled just to debug.

The current repo has no automated VPS rollout or code-level blue/green switch. This section is the manual release procedure to rehearse on devnet first.

## 8. Encrypted backups and restore rehearsal

`game/ops/backup-postgres-to-r2.sh` dumps the selected Compose project's database, encrypts the stream with `age` using a public recipient file, writes a SHA-256 manifest and uploads both with `rclone`. The age private identity stays in cold/off-VPS storage. R2 credentials/config stay in root-owned files on the VPS.

Required host setup per project:

1. Install Docker Compose plugin, `age`, `rclone`, Node/Yarn for the one-time role/verification tools, and the Cloudflare/R2 remote configuration.
2. Create an age recipient file containing only the public recipient; store its matching private identity offline.
3. Configure an `rclone` remote to the correct R2 bucket with a least-privilege token. Set R2 lifecycle/retention and versioning according to the approved retention policy; the script itself does not delete old backups.
4. Set `COMPOSE_PROJECT_NAME`, `COMPOSE_ENV_FILE`, `R2_BACKUP_REMOTE`, `BACKUP_AGE_RECIPIENT_FILE` and `RCLONE_CONFIG` in `/etc/ares1/instances/<project>/backup.env` (mode 0600; the R2 credential remains in the protected rclone config). `COMPOSE_ENV_FILE` must point to that project's Compose interpolation file so `docker compose` can resolve the required database settings. Sample templated units are in `game/ops/systemd/ares1-postgres-backup@.service` and `.timer`; install them under `/etc/systemd/system/`, run `systemctl daemon-reload`, then `systemctl enable --now ares1-postgres-backup@ares1-devnet.timer`. Monitor `systemctl status`, `systemctl list-timers` and `journalctl -u ares1-postgres-backup@ares1-devnet.service`; connect failures to an external alert.
5. Rehearse restore into a **separate temporary Compose project/database**. Download the ciphertext and sidecar, verify the checksum before decryption, and use the offline age identity only on a trusted workstation; stream the plaintext archive into the temporary Postgres service with `pg_restore --no-owner --no-acl` (database globals/logins are not in a `pg_dump` database archive). Set up the runtime roles/logins with `yarn db:roles` against that isolated DB, run `yarn db:verify`, verify cluster binding and read-only order/account counts, then destroy only the temporary project/volume after recording the result. Restore with the matching application/migration revision. Never overwrite production as a restore test.

### Restore rehearsal (keep the age identity cold)

A safe recovery path is to decrypt on the operator's trusted Mac/workstation and stream plaintext over verified SSH directly into the **temporary** VPS Postgres container. Do not copy the age identity to the VPS or commit it. First start only `postgres` for a unique restore project, with its own port and volume. Then, from the trusted workstation:

```bash
# Download the encrypted object and sidecar using the operator's R2 access.
rclone copyto "$REMOTE/$PROJECT/$BACKUP_NAME" "$SECURE_TMP/$BACKUP_NAME"
rclone copyto "$REMOTE/$PROJECT/$BACKUP_NAME.sha256" "$SECURE_TMP/$BACKUP_NAME.sha256"
(cd "$SECURE_TMP" && shasum -a 256 -c "$BACKUP_NAME.sha256")

# AGE_IDENTITY_FILE stays on the trusted workstation. BACKUP_NAME was checksum-verified.
set -o pipefail
age --decrypt --identity "$AGE_IDENTITY_FILE" "$SECURE_TMP/$BACKUP_NAME" \
  | ssh <vps-admin-host> \
      'cd /opt/ares1/game && docker compose -p ares1-restore --env-file /etc/ares1/instances/ares1-restore/compose.env exec -T postgres pg_restore --username=postgres --dbname=ares1 --no-owner --no-acl'
```

Use a restrictive temporary directory on encrypted workstation storage; remove ciphertext after the rehearsal according to the retention policy. After the stream completes, run `db:roles` (with unique temporary login passwords) and `db:verify` against the restore DB using the matching source revision, inspect counts and cluster binding, and record the restore duration. No production volume is mounted by the `ares1-restore` project. In a real incident, obtain the human recovery approval and follow the same controlled path; do not keep the private age identity on the host.

The backup script has only been syntax-checked in this workspace. No Docker, `rclone`, age identity, R2 bucket, scheduler, backup or restore rehearsal has been run here.

## 9. Operational command for the prepared backup

```bash
cd /opt/ares1/game
COMPOSE_PROJECT_NAME=ares1-devnet \
COMPOSE_ENV_FILE=/etc/ares1/instances/ares1-devnet/compose.env \
R2_BACKUP_REMOTE=ares1-r2:encrypted-backups \
BACKUP_AGE_RECIPIENT_FILE=/etc/ares1/instances/ares1-devnet/backup-age-recipient.txt \
RCLONE_CONFIG=/etc/ares1/rclone.conf \
./ops/backup-postgres-to-r2.sh
```

Keep the actual R2 credential config, database passwords, API tokens, payer JSON, RPC credentials and tunnel credentials out of repository files, artifacts and chat.
