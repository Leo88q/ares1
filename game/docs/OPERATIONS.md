# Operations — closed devnet beta

Status: **not approved for real funds or mainnet**. See [../../reports/ares1-audit.md](../../reports/ares1-audit.md).
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
VITE_PRESALE_RUN=wave1          # id тиража Фазы 1; совпадает с PRESALE_RUN_ID
VITE_LANDING_URL=https://ares1-7e1.pages.dev   # куда ведёт блок Фазы 1
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

Dependency-free scanners from the repository root — these cover the patterns the
production-deploy checklist names explicitly and work where the gitleaks release
asset cannot be downloaded (§1.1, §1.2.1 of
[docs/PRODUCTION_DEPLOY_CHECKLIST.md](../../docs/PRODUCTION_DEPLOY_CHECKLIST.md)):

```sh
node scripts/secret-scan.mjs                  # working tree
node scripts/secret-scan.mjs --root dist      # a build output directory
git ls-files -z | node scripts/secret-scan.mjs --stdin   # what the pre-commit hook does
node scripts/secret-scan-history.mjs          # all fetched history (needs git fetch --unshallow)
```

Allowlisted findings live in `.secret-scan-allowlist.json`; every entry must carry a
written reason and must not contain credential-shaped literals (the file is scanned
too). The known historical Helius key leak is deliberately **not** allowlisted: the
history scan is expected to stay red until the key is rotated.

Build-output gate — run after every build, before publishing:

```sh
node scripts/check-release-artifacts.mjs landing/dist game/apps/web/dist
```

It fails on source maps, `sourceMappingURL`, `.env*`/key/dump files inside `dist/`,
a `.git` directory, third-party font or script CDN references, and hard-coded
loopback URLs.

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

The Compose build context is the repository root so Docker can include the
locally vendored `@solana/buffer-layout-utils` backport without reaching outside
the context. For a direct build from the repository root, use
`docker build -f game/apps/backend/Dockerfile .`; the root `.dockerignore`
allowlists only the package manifests, backend source, migrations, and vendored
package needed by the image.

Container builds use the shared Yarn lockfile and Node 22.22.3, run as non-root,
mount keys read-only, and do not copy env/key files into the image. Runtime currently
installs the full production workspace graph (including web dependencies); reducing
image size is deferred. Compose restart handles process exits, not all outages;
Docker does not automatically restart merely unhealthy containers.

### How the frontends reach the backend

The landing is a static site, so its `/api/*` calls need an explicit path to the
backend — otherwise the form answers nothing (before 2026-10-06 it 404'd):

```text
Cloudflare Pages (project ares1) → Settings → Environment variables
PRESALE_API_ORIGIN=https://<backend host>      # корень, без суффикса /api
```

`functions/api/[[path]].js` (repository root — Cloudflare Pages reads Functions only from the project root) forwards `/api/*` to that origin and answers
`503 presale_api_not_configured` until the variable is set. Locally the same path
is proxied by Vite (`PRESALE_API_ORIGIN`, default `http://127.0.0.1:8080`).

The game client talks to the same backend only for gameops and the Phase 1 counter:
set `VITE_BACKEND_URL`, add the backend origin to the game's `connect-src`
(`game/apps/web/public/_headers`) and to the backend `CORS_ORIGIN`. Without it the
Phase 1 block still renders its terms, just without the live remaining counter.

The compose service binds the API to **127.0.0.1** by default
(`GAME_OPS_BACKEND_BIND`), because the process holds a signing key and the admin
`game_ops` surface: terminate TLS and check the origin in a reverse proxy or platform
ingress in front of it. If the API really is exposed directly, set
`GAME_OPS_BACKEND_BIND=0.0.0.0` deliberately **and** `TRUST_PROXY=false` — otherwise a
client can spoof `X-Forwarded-For`, bypass the per-IP rate limit and forge the `ip:`
actor recorded in the `game_ops` audit log.

Probes:
- `/live`: process HTTP liveness, no RPC calls. Suitable for container healthcheck.
- `/ready`: on-chain config is readable/decodable; 503 otherwise.
- `/health`: RPC slot/config/payer balance; 503 on dependency failure. Not a complete
  epoch-worker health guarantee. Probes are **exempt** from the per-IP rate limit (a
  429 on a k8s probe is read as a dead process); the limit covers `/api/*` only.

Use external alerts for unavailable readiness, stale epochs, low payer SOL and
repeated roll failures. Current worker logs alone are **not delivered alerts**.
Do not restart-loop a healthy process just because the RPC is briefly down.
The backend has no persistent game-state history: `localStorage` + the chain cover
gameplay. The optional rewards layer (`game_ops`, enabled only with
`GAME_OPS_DATABASE_URL`) does use PostgreSQL — its deploy, verification, incident
playbooks and measured load are in `docs/DB_RUNBOOK.md`. Back up deployment
configuration (encrypted if secrets), indexer checkpoints, the `game_ops` database,
and test restoration. The blockchain is not a backup of private keys; a database
dump is not a proof of immutability either — that proof is the hash-chain plus the
on-chain Merkle anchor.

## Incident / emergency pause

1. Confirm cluster and program ID. Check RPC from an independent provider before
   attributing an outage to the program.
2. If mint/spend behavior is unsafe, authorized governance invokes `set_paused(true)`;
   verify the transaction and read back `config.paused`. The **guardian** key
   (`config.guardian`, set via authority-only `update_guardian`) can also call
   `set_paused(true)` — and only that: unpausing always requires the authority.
   Pre-assign a guardian before an incident; `Pubkey::default()` means unset.
   No delay for emergency pause should be introduced without a separate governance
   decision.
3. Pause is **not** a treasury freeze: `withdraw_*` is not gated by it. Treasury
   withdrawals are two-step: `propose_withdrawal(kind, amount)` (kind 0=🥔, 1=SOL,
   2=SKR) consumes the rolling 24 h window budget (250 000 🥔 / 25 SOL / 100 000 SKR
   via the `AdminState` PDA) and starts a short on-chain timelock; only then can
   `withdraw_*` execute, and only to the authority's own ATA/`authority` system
   account. `cancel_withdrawal` aborts all pending proposals during the timelock
   (the window budget is not refunded). The on-chain delay is intentionally short
   for testability — production safety comes from a multisig authority (Squads),
   the guardian key and external alerts, not from this constant. To stop
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

## Люди, устройства и доступ (пп. 106, 107, 123, 125 — аудит 2026-09-28)

Прецеденты: WaterPlum/Contagious Interview (≥30 тыс. устройств через фейковых
рекрутёров, тестовые задания и «почини видеозвонок»; вредонос прячется в
блокчейн-репозиториях, VS Code-задачи запускаются при открытии папки);
Drift — месяцы выстраивания отношений перед атакой на мультисиг; Meteora —
фальшивый OTC-эскроу ($1.5M); CertiK: 52 wrench-атаки за H1 2026 (Европа — 39,
Франция — 33), рост связан с утечками персональных данных.

Правила (обязательные для всех с доступом к ключам/деплою):

1. **Чужой код — только в одноразовой VM/контейнере без ключей и без сетевого
   доступа к прод-инфраструктуре.** Тестовое задание «рекрутёра», демо-репо
   «партнёра», чужой PR — никогда не открываются на машине, где есть keypair.
   VS Code: Workspace Trust = ON, автоматический запуск задач выключен
   (user setting `task.allowAutomaticTasks: off`), папки из недоверенных
   источников не «доверяются» никогда.
2. **Расширения IDE — по allowlist.** Не устанавливать расширения «на пробу»
   в рабочей среде; новые расширения — сначала в одноразовом профиле/VM.
   Рекомендованный список проекта — `.vscode/extensions.json`.
3. **Lifecycle-скрипты npm/yarn запрещены** (гейт `yarn test:guards`, тест
   «П.107»): ни один package.json проекта не содержит `preinstall/postinstall/
   prepare`. Новая версия зависимости принимается с задержкой ≥ 72 ч после
   публикации и только при неизменном diff lockfile.
4. **Ключи ИИ-сервисов** (если появляются): в менеджере секретов, с лимитом
   расходов и минимальными правами, отдельные на человека/сервис; не в `.env`,
   не в чатах, не в Issue. При подозрении — отзыв и ротация.
5. **Все authority-ключи — на аппаратных кошельках.** На рабочих ноутбуках
   keypair проектов не живут вообще (см. [KEY_PROVENANCE.md](KEY_PROVENANCE.md)).
6. **Проверка собеседника/контрагента по независимому каналу**: видео и голос
   подделываются (ИИ-подмена на «интервью»); любое «срочное» действие из чата
   — подтверждается вторым каналом, о котором договорились заранее.
7. **OTC/эскроу/выкупы/«инвесторы»/«аудиторы»** (урок Meteora): только через
   проверенных посредников; тестовая сумма перед основной; лимит на сделку;
   двойное одобрение (два человека) для любых операций вне протокола; проверка
   адреса получателя по независимому каналу.
8. **Минимум публичных персональных данных**: не публиковать состав команды,
   домашние адреса, графики (реестры компаний, WHOIS, соцсети). Физическая
   защита (wrench-атаки): крупные суммы — только multisig с подписантами в
   разных местах (один принуждённый человек не даёт порог); duress-протокол —
   см. [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §9; личные и проектные
   активы разделять.

## Домены и DNS (п. 119 — урок BONKfun)

Домены проекта: `ares1.is-a.dev` (лендинг), `play.ares1.is-a.dev` (клиент).
is-a.dev — субдоменная программа на GitHub: «регистратор» = аккаунт GitHub,
через который вносилась заявка.

1. **Аккаунт GitHub (владелец заявки)**: аппаратный 2FA, отдельная парольная
   фраза для поддержки, минимум людей с доступом, включённый transfer-lock-
   эквивалент: подписанная CLI-сессия без сохранённых токенов с широкими правами.
2. **Мониторинг**: `node scripts/check-dns.mjs` — с 2026-10-02 запускается по
   расписанию workflow `Monitoring` (`.github/workflows/monitoring.yml`, каждые
   15 минут; падение открывает issue с меткой `monitoring-alert`). Baseline
   `scripts/dns-baseline.json` коммитится в репозиторий; любой не-нулевой exit —
   алерт. Подробности — в шапке скрипта.
3. **Резервный канал коммуникации** заранее: второй домен вне is-a.dev (TBD),
   статус-страница вне общего DNS; шаблон сообщения при угоне —
   [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §6.
4. Контакты команд кошельков и блок-листов для пометки фишингового домена —
   в INCIDENT_RESPONSE.md §1.

## Периметр GitHub (аудит 2026-10-02)

Репозиторий публичный — это осознанное решение, но настройки доступа обязаны ему
соответствовать: без branch protection один скомпрометированный аккаунт может
подменить код или скрипты деплоя без ревью, а с выключенными алертами уязвимые
зависимости не видны. Проверка и включение — одной идемпотентной командой (нужны
права admin; из песочницы/CI API отвечает 403):

```sh
./scripts/apply-github-hardening.sh              # REPO=owner/name для форка
```

Что включает: Secret scanning + push protection + Dependabot alerts; branch
protection на `main` (PR + 1 review + CODEOWNERS, обязательные checks, запрет
force-push и удаления ветки, включая администраторов). Если API отказывает — это
**human-гейт**: те же переключатели в Settings → Code security / Branches, с
записью даты и исполнителя.

## Инвентарь ончейн-программ (п. 98, 129 — уроки Raydium Legacy / Aztec / Thetanuts)

Реестр: `game/program-inventory.json`. Проверка:

```sh
RPC_URL=https://api.devnet.solana.com node scripts/inventory-programs.mjs
node scripts/inventory-programs.mjs --schema-only   # без сети (CI/агенты)
node scripts/inventory-programs.mjs --json          # машинный вывод для алертов
# Адрес ожидаемого мультисига можно не коммитить (до mainnet), а передать снаружи:
node scripts/inventory-programs.mjs --expect-authority <squads-address>
```

Полный прогон по расписанию выполняет workflow `Monitoring`
(`.github/workflows/monitoring.yml`, ежедневно; адрес из repo variable
`MAINNET_AUTHORITY`, если задан).

Правила:
- Новая программа (включая beta/тестовые деплои) — запись в реестре в день
  деплоя, иначе это «спящая программа», которую забудут (за полгода 2026 года
  из таких программ вынесли ≥ $36.7M).
- Deprecated-программа: осушить → `solana program set-upgrade-authority <id>
  --final` (upgrade authority = None) → статус `deprecated` в реестре.
- Прогон inventory + «зачистка класса» — после каждого инцидента в экосистеме
  ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §7).
- Крон: раз в сутки полный прогон; нарушение (mutable deprecated, ненулевой
  баланс) — алерт.

## Policy-слой подписанта (пп. 102/103/108/114/127)

`apps/backend/src/policy.ts` — независимые проверки единственного
автоматического подписанта (крон `roll_epoch`):
- allowlist программ и discriminator'ов инструкций — проверяется в точке
  подписи (`sendVersionedTx`), независимо от собравшего транзакцию кода;
- решение о подписи — только по снапшоту `finalized`, сверенному со вторым
  независимым RPC (`RPC_URL_SECONDARY`; в production отсутствие второго
  источника запрещает подпись — `REQUIRE_SECONDARY_RPC=0` отменяет это только
  осознанно);
- расхождение источников — инцидент (`data_source_mismatch`), не ретрай.
Поставить второй RPC от ДРУГОГО провайдера до mainnet — гейт G-7 в
[MAINNET_LAUNCH_GATE.md](MAINNET_LAUNCH_GATE.md).
