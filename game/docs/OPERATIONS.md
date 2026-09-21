# Operations — closed devnet beta

Status: **not approved for real funds or mainnet**. See [STABILIZATION-2026-09-21.md](STABILIZATION-2026-09-21.md).
No key, mnemonic, secret JSON, private RPC URL or admin token belongs in this document.

## Reproducible checks

From the repository root, select Node using `.nvmrc` / `.node-version` (22.22.3).
Use Yarn Classic **1.22.22** for `game/` (not npm install); `landing/` has its own npm lockfile.
From `game/`:

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn test:offchain
yarn build                            # provide VITE_* settings below
./scripts/ci-local.sh --skip-chain     # explicit public devnet build settings
```

On-chain tools: Rust **1.97.1** (`rust-toolchain.toml`), Solana CLI **4.2.2**,
Anchor CLI/crates **0.31.2** (`Anchor.toml`, Cargo.toml). These retain the repository's
existing versions; installation and host Rust tests have now passed in GitHub Actions.
SBF/localnet validation is tracked separately in the stabilization report.
The JS test client is pinned separately to **@coral-xyz/anchor 0.30.1** (previously
used by the integration suite). This is not the CLI version; compatibility with the
new generated IDL must be validated by `anchor test`, not assumed.

```sh
cargo test --locked -p solana_potato --lib
./scripts/build-program.sh  # standard anchor build + locked metadata + unchanged Cargo.lock check
# A disposable LOCALNET provider wallet must exist at the Anchor.toml wallet path.
# Never use the deploy/admin wallet for tests. On a clean test machine only:
# solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
anchor test --skip-build
# Also supported: anchor test (build + fresh validator + deploy + integration tests).
yarn check:contract target/idl/solana_potato.json
```

`anchor test` is the clean-localnet deployment smoke test: initialize, fields,
harvest, market, presale, rewards, treasury and admin operations. It also runs the
new batch/close/reward signer negative tests. Off-chain tests live separately and
are **not** included in Anchor's test glob.

Do not use `--skip-local-validator` to claim a clean-localnet result. Review a newly
generated IDL before copying it into `apps/web/src/idl.json`. Never disable the IDL
check to make CI green. CI does not deploy to devnet/mainnet and receives no real keys.

## Frontend configuration

Copy `apps/web/.env.example` to a gitignored local environment file, or configure
these values in the deployment platform:

```text
VITE_SOLANA_CLUSTER=devnet
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf
VITE_BACKEND_URL=
```

All `VITE_*` values are **public in the browser bundle**, even when injected by a CI
secret. For a paid RPC, use a provider-restricted browser key or a hardened proxy
with method/origin/rate restrictions. A hidden CI variable does not hide a browser key.
No mainnet deployment has been verified for the program ID above.

## Credential incident: RPC key

1. In the RPC provider dashboard, revoke the exposed key; inspect usage/billing.
2. Issue distinct browser-restricted and server keys. Never send them through chat.
3. Update platform secret stores, redeploy browser assets and restart the backend.
4. Verify that the old key is denied and the new service works. Record owner/date,
   not key values. Purge stale deployment artifacts/caches where supported.
5. Review Git history, all branches/tags, CI logs/artifacts and published bundles.
6. History rewriting is a separate coordinated operation after revocation. It
   cannot invalidate copies already downloaded. Do not force-push another branch
   from this session; coordinate repository-wide cleanup with its owner.

The tracked `.env.production` was removed; **revocation is not confirmed**.

## Secret scanning

Pinned scanner: Gitleaks 8.30.1 with default rules plus RPC URL and numeric Solana
keypair rules in `.gitleaks.toml`. Numeric-array detection is heuristic, not proof
that a file is a valid/invalid keypair. Treat findings as sensitive even when redacted.

```sh
./game/scripts/install-gitleaks.sh "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
./game/scripts/scan-secrets.sh tree
# Fetch full permitted history/refs before the historical audit:
./game/scripts/scan-secrets.sh history
# Separately scan PRIVATE local env/key directories or downloaded CI artifacts:
gitleaks dir /path/to/private-review-copy --config .gitleaks.toml --redact=100 --no-banner
```

Tree mode scans tracked/new non-ignored files, not ignored private files. History
mode scans fetched refs, not deleted remote artifacts or unknown forks. The
`Secret scanning` workflow checks source + newly introduced commits; manually run
it with `full_history=true` (or request an audit with `[audit-history]` in a push commit message) for the historical audit. The known historical leak is
**not allowlisted**; a full audit may correctly remain red until remediation.
Do not upload raw scanner reports, keys or downloaded CI artifacts to Git.

## Key inventory — must be completed by the operator

| Role | Required policy | Verified live owner |
|---|---|---|
| Program upgrade authority | Multisig + reviewed upgrade delay before real funds | Not verified |
| GameConfig.authority | Separate admin governance; treasury/config/pause permissions | Not verified |
| pending_authority | Monitor pending two-step transfers | Not verified |
| reward_signer | Dedicated signer only if rewards require automation; shared epoch budget risk | Not verified |
| Epoch payer | Dedicated small-balance wallet, no admin/reward role | Not verified |
| Deploy wallet | Controlled signing device and independent recovery | Not verified |
| RPC credentials | Provider restrictions, separate browser/server keys | Revocation pending |

Record public addresses, responsible persons, storage location references and last
recovery-test dates in a private inventory. Never record secret material here.
Backend rejects payer = authority/pending_authority/reward_signer at startup and
before each roll. This does not verify upgrade authority: compare it separately.
`roll_epoch` is permissionless, so loss of the payer can be handled by replacing
and funding a **new** dedicated wallet; the old payer need not be recovered.
For multisig, recovery must preserve threshold safety and independent signers.

## Backend deployment

Prepare `apps/backend/.env` from its example and mount the dedicated payer at
`apps/backend/keys/epoch-payer.json`. Keep the file mode restrictive while allowing
container UID 1000 (`node`) to read it, e.g. owner-readable `0400` with correct owner.
Do not use world-readable permissions as a workaround. A mounted secret is not a
backup; store any recovery material encrypted and separately with restricted access.

```sh
cd game
docker compose config --quiet         # do not print resolved secret values
docker compose build backend
docker compose up -d backend
```

Container builds use the shared Yarn lockfile and Node 22.22.3, run as non-root,
mount keys read-only, and do not copy env/key files into the image. Runtime currently
installs the full production workspace graph (including web dependencies); reducing
image size is deferred. Compose restart handles process exits, not all outages;
Docker does not automatically restart merely unhealthy containers.

Probes:
- `/live`: process HTTP liveness, no RPC calls. Suitable for container healthcheck.
- `/ready`: on-chain config is readable/decodable; 503 otherwise.
- `/health`: RPC slot/config/payer balance; 503 on dependency failure. Not a complete
  epoch-worker health guarantee. Health/readiness/API calls share a per-IP rate limit.

Use external alerts for unavailable readiness, stale epochs, low payer SOL and
repeated roll failures. Current worker logs alone are **not delivered alerts**.
Do not restart-loop a healthy process just because the RPC is briefly down.
The backend currently has no persistent history/database; no unused data volume is
needed. Back up deployment configuration (encrypted if secrets), future indexer
checkpoints/DB, and test restoration. The blockchain is not a backup of private keys.

## Incident / emergency pause

1. Confirm cluster and program ID. Check RPC from an independent provider before
   attributing an outage to the program.
2. If mint/spend behavior is unsafe, authorized governance invokes `set_paused(true)`;
   verify the transaction and read back `config.paused`. No delay for emergency pause
   should be introduced without a separate governance decision.
3. Pause is **not** a treasury freeze: `withdraw_*` is not blocked by it, but since
   the 2026-09-21 remediation every withdrawal is rate-limited per rolling 24 h
   window via the `AdminState` PDA (250 000 🥔 / 25 SOL / 100 000 SKR). To stop
   presale inflows immediately use the kill switch `update_presale_price(0)`
   (applies at once; raising the price back requires the 24 h timelock via
   `apply_pending_presale_price`). `cancel_order`, `close_expired_order`,
   `close_field` remain exit paths; test them on the target build.
4. Preserve transaction signatures, slots and redacted diagnostics. Stop a compromised
   signer, rotate its permissions and investigate upgrade authority independently.
5. Unpause only after a reviewed fix and localnet/devnet validation.

## Rollback / recovery

Keep the previously verified image digest, source revision, program binary hash,
IDL and toolchain record. Restore a backend/frontend version only if it can decode
current accounts. Program rollback is a governed upgrade, not a database rewind;
on-chain transfers cannot be undone. Account migrations may make old binaries
incompatible. Rehearse migration and recovery on localnet first; do **not** run
`migrate_config` against legacy funded state on the strength of the existing reports.

## Legacy migrations and generated IDL recovery

Use [MIGRATIONS.md](MIGRATIONS.md) for exact layouts, read-only planning and the
isolated fixture tests. No migration script was executed against devnet/mainnet.

The CI build publishes the public IDL as an artifact plus a checksummed compressed
set of chunked check annotations for API-only environments that cannot download artifact archives.
`node scripts/fetch-ci-idl.mjs` retrieves only the IDL for the exact current Git SHA
into ignored `target/idl/`; it does not overwrite the committed client ABI. Review
that file, copy it to `apps/web/src/idl.json`, run `check:contract`, then rerun CI.
No private key, raw job log or signing material is included in that annotation.
