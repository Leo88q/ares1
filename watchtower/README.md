# ARES-1 → Games Watchtower: изолированный read-only exporter

**Статус: реализация и локальные synthetic/runtime тесты; НЕ подключён к Games
Watchtower. Devnet runtime verification и deployment manifest ещё не подтверждены.**
Контракт, экономика, игровые цены, backend и UI не изменяются этим компонентом.

## Границы безопасности

- Отдельный Node **22.22.3** / TypeScript проект, процесс, `package-lock.json` и БД.
  Нет runtime imports из `game/`, Anchor/Solana signing SDK, transaction builders,
  `epochRoller`, keypair, admin token или blockchain write endpoints.
- Нативный JSON-RPC transport имеет runtime allowlist только read-методов. Каждый
  endpoint, включая fallback, сначала проверяется по genesis hash **devnet**.
- `WATCHTOWER_ENABLE_WRITES` допускает только отсутствие или ровно `false`.
  `true`, `1`, `TRUE`, пустое явно заданное значение и прочие варианты завершают
  процесс **до** HTTP, подключения БД и ingestion. Есть отдельный capability test.
- Exporter использует отдельный bearer token длиной >=32 символов. Все endpoints,
  включая health, требуют `Authorization: Bearer …`. Admin credentials не применять.
  Не монтировать каталог game/backend secrets; не наследовать его environment.
- Блокчейн read-only; собственная PostgreSQL получает записи. Разделяйте DB-роли
  migration/DDL и runtime. Runtime достаточно SELECT/INSERT/UPDATE таблиц схемы
  `watchtower`, USAGE схемы и sequence; права на игровые таблицы не нужны.
- `/config` — allowlisted описание, не дамп env/manifest. Логи не печатают URL,
  credentials или сообщения ошибок RPC/pg. HTTP не имеет CORS wildcard; выдавайте
  токен только доверенному server-to-server потребителю, поверх TLS/reverse proxy.
- Это проверка отсутствия signing code/credentials в проекте, а не OS sandbox для
  произвольного JavaScript. В production дополнительно изолируйте UID, mounts и
  egress, ограничьте сеть разрешёнными RPC/БД и подайте секреты через secret manager.

## Запуск (не публичный deployment)

```sh
cd watchtower
npm ci --ignore-scripts
npm run typecheck
npm run build
cp config.example.env .env
# Заполнить .env локально/через secret manager. Не отправлять секреты в чат/Git.
node --env-file=.env --import tsx scripts/migrate.ts
node --env-file=.env dist/watchtower-exporter.js
```

HTTP слушает `0.0.0.0:$WATCHTOWER_EXPORTER_PORT` (8790 по умолчанию).
По умолчанию provider=`mock`: ingestion выключен, readiness=503, данные не
генерируются. Для native RPC нужен provider=`rpc` и URL devnet endpoint. Реальная
БД нужна в обоих режимах. Скрипты не загружают `.env` автоматически — используется
явный `node --env-file`, либо переменные процесса.

Не запускать несколько ingestion-процессов на один stream: SQL row lock + cursor
version защищают от потери/дублей, но конкурирующие процессы вызовут лишние retries.

### PostgreSQL

`migrations/watchtower-read-model.sql` выполняется явно, в транзакции, повторный
запуск безопасен для v1. Runtime не делает DDL. Таблицы: `transactions`,
`raw_events`, `normalized_events`, `cursors`, `reconciliation_state`, `data_quality`,
`audit_records`. `daily_projections` — SQL view, не инкрементальный счётчик; replay
не удваивает показатели. Перед изменением схемы нужны новая миграция и backup.

Обязательный raw constraint:

```sql
UNIQUE (cluster, slot, signature, instruction_index, inner_index)
```

**Одна raw-запись — один invocation инструкции**, а не один `emit!`. Все payload
внутри него сохраняются массивом; normalized children имеют уникальный
`(raw_id, log_index)`. `instruction_index` — индекс outer instruction в message;
`inner_index` — реальный индекс CPI в `meta.innerInstructions`, либо `-1` для
outer invocation. Поэтому два emit! одной инструкции не теряются и не нарушают
обязательный UNIQUE. Invocation stack проверяется против RPC instruction metadata.

Raw transaction, raw invocations, normalized events, reconciliation record, audit
и cursor страницы сохраняются **одной PostgreSQL-транзакцией**. Cursor имеет CAS
version и row lock. Сбой/обрыв соединения откатывает всю страницу. Dead connections
удаляются из пула; восстановление начинается с прежнего cursor.

## Decoder и реальные ограничения событий

- `events/ares1-idl.json` — event-only snapshot подлинного IDL игры: события,
  их Borsh layouts и instruction discriminators **для чтения**, без builders.
  CI сравнивает snapshot и SHA-256 с `game/apps/web/src/idl.json`.
- `events/ares1-event-map.json` покрывает **34 существующих события**. Gameplay,
  покупки, рынок, rewards, treasury и authority/config changes сохраняются по
  фактически испущенным событиям. u64/i64 экспортируются десятичными **строками**.
- `PresalePurchase.sol_amount` исторически неоднозначен: `buy_field_skr` → SKR,
  `buy_field_sol` → SOL. Неизвестная инструкция → resource=null, не догадка о валюте.
- Неизвестные discriminator/layout/base64 не отбрасываются: `Unknown`,
  `ares1-raw-v1`, `dataQuality=partial`, исходный payload в raw и `data.rawBase64`.
- Логи чужой программы не принимаются за события ARES-1. События failed/caught CPI
  и откатившейся транзакции сохраняются с `applied=false`; они НЕ входят в daily
  projections. Потребитель обязан учитывать `applied`, а не только eventType.
- Experimental Core/compression/hook events помечены `experimental`. Наличие
  emit! в старой заглушке не доказывает реальный asset CPI.
- Не синтезируются TokenMinted/TokenBurned/PaymentSettled только по названию события;
  registry описывает действительно поддерживаемые события и недоступную телеметрию.
  Observed counts — не supply, balance, полный бухгалтерский ledger или DAU.

## Backfill, tail, replay и finalized reconciliation

Первая версия **finalized-only**. `commitment=confirmed/processed` отклоняется 400,
а не молча выдаётся за finalized. Нет optimistic событий и необходимости выдавать
предварительный результат как окончательный.

1. Backfill читает `getSignaturesForAddress` newest→oldest ограниченными страницами.
2. Каждая транзакция повторно читается через `getTransaction(finalized)`, проверяется
   slot и лог/инструкция. `null`, truncation или отсутствующая metadata блокируют
   cursor и создают gap; данные не пропускаются ради зелёного health.
3. Сохранённые `before`, head, phase и watermark позволяют resume после restart.
4. Tail сканирует до прежнего head **включительно**, повторно сверяя его finalized
   fingerprint. Новые/повторные события проходят атомарный dedup.
5. Изменившийся finalized fingerprint, откат RPC watermark, невозможность найти
   старый head, неподходящая страница — gap и readiness=503. Retry не затирает
   прежнюю версию события. Gap healed фиксируется только после успешного commit.
6. Timeout/429/5xx/network errors: до четырёх попыток с exponential backoff+jitter,
   затем ограниченный polling retry; shutdown прерывает HTTP и ожидание.
7. SIGTERM/SIGINT прекращают ingestion, закрывают HTTP и пул. Есть конечный timeout.

`finalizedLag` — разница текущего наблюдённого finalized slot и watermark полностью
завершённого scan; **не** разница с последним игровым событием. До catch-up/при
устаревшем heartbeat значение null. Это измеренная оценка по выбранному RPC.

**Не обещаем полную историю:** пустая страница RPC не доказывает genesis coverage.
Pruned provider или пропущенные внутри страницы записи нельзя полностью выявить
без независимого архивного источника/block scanner. Поэтому coverage всегда
`provider_available_only`, confidence/dataQuality — `partial`. Молча присваивать
`complete` нельзя. Финализированная сверка охватывает полученные страницы и старый
head; для глубокой повторной сверки запустите full replay с архивным RPC.

Replay (остановить exporter, сохранить backup read-model; только собственная БД):

```sh
WATCHTOWER_REPLAY_CONFIRM=ares1 node --env-file=.env --import tsx scripts/replay.ts
node --env-file=.env dist/watchtower-exporter.js
```

Raw/normalized records не удаляются. RPC history сканируется заново, неизменные
записи dedup-ятся. **Это не parser migration**: изменение IDL/parser требует
контролируемой миграции/reparse в отдельном read-model с проверкой, не перезаписи
существующих fingerprints. Failed reconciliation разбирать по локальной raw БД;
не сбрасывать защиту автоматически.

## HTTP contract

Каждый ответ, включая ошибки, обёрнут в `events/schema.json`:
`source`, `commitment`, `finalizedLag`, `dataQuality`, `confidence`, `parserVersion`,
`nextCursor`, `data`. Envelope parserVersion=`ares1-v1`; отдельный Unknown имеет
собственный parserVersion=`ares1-raw-v1`. Запросы кроме GET запрещены.

| GET `/watchtower/…` | Назначение |
|---|---|
| `health` | Liveness и диагностика БД/scan; не доказательство готовности |
| `readyz` | 200 только RPC mode, executable account, catch-up, свежий heartbeat, без gap; иначе 503 |
| `config` | Только безопасные поля game/network/configuration status/writes=false |
| `events` | Сохранённые normalized events, в том числе Unknown и applied=false |
| `events/:signature` | Те же события, отфильтрованные по signature |
| `metrics/daily` | Observed event counts по UTC day + Prometheus registry в JSON; не полная экономика |
| `players/cohorts` | null: historical_coverage_not_verified |
| `players/retention` | D1/D3/D7/D14/D30=null: requires_client_telemetry |
| `players/cross-game` | null: requires_identity_service; никаких wallet addresses |
| `economy` | Observed economy counts; supply/complete ledger недоступны |
| `treasury` | Observed treasury event counts; balances недоступны без verified accounts |
| `security` | Observed security events, отсутствие write capability; live authorities недоступны |
| `alerts` | Unresolved indexer gaps/errors; fraud signals недоступны, действий нет |
| `funnels` | null: requires_client_telemetry |

Events query: `cursor`, `limit` (1–200, default 100), `before`, `after`, `commitment`
(только finalized), `programId`, `eventType`, `slotFrom`, `slotTo`.
`before`/`after` — ISO-8601 **block time**, исключающие границы, не RPC signatures.
Null blockTime не входит в date-filter. Slot bounds включающие. Порядок — устойчивый
локальный ingestion ID (decimal string), **не хронологический slot order**.

Cursor непрозрачный, HMAC-защищён exporter token и привязан к фильтрам/stream/route;
limit можно менять. `nextCursor` возвращается и в конце текущих данных: сохраните
его для следующего poll; `hasMore=false` означает конец только на момент запроса.
Ротация exporter token инвалидирует API cursors, но не ingestion cursors/dedup.
Перечитать с начала безопасно; dedup на стороне потребителя по source identity.

`metrics/daily` принимает `after`/`before`, максимум 31 день, UTC date buckets.
Prometheus counters включены в `data.exporterMetrics` без credential labels;
это JSON envelope, не отдельный открытый scrape endpoint.

WalletConnected, сессии/длительность, retention, client crash, device, IP, onboarding
и off-chain funnel steps не восстанавливаются из цепочки. Они возвращаются как
`{value:null,dataQuality:"unavailable",reason:"requires_client_telemetry"}`.

## Cross-game identity

Exporter **не получает shared identity secret** и не вычисляет local wallet hash.
`WATCHTOWER_PLAYER_HASH_SALT` оставлен для совместимости списка env, но должен быть
пустым: непустое значение отвергается. Будущий Watchtower/identity service использует
HMAC-SHA256(secret, canonical address) с `playerKeyVersion`; экспорт cross-game
возможен только после согласования сервиса и controlled key-version migration.
Пока endpoint возвращает unavailable и не раскрывает полные wallet addresses.
Другие авторизованные on-chain event endpoints содержат публичные адреса из цепочки.

## Проверки

```sh
npm run typecheck
npm run build
npm test                  # PG suite skipped, если test DB не настроена
# Только disposable DB с точным именем watchtower_test: suite удаляет свою схему!
WATCHTOWER_TEST_DATABASE_URL='<локальная тестовая БД>' npm run test:integration
```

CI `.github/workflows/watchtower.yml` использует disposable PostgreSQL 17; отсутствие
БД — ошибка, не skip. Покрыты все decoder fixtures, Unknown, CPI/rollback attribution,
дубли/replay/resume, инъекция SQL fault, **завершение PG backend во время записи**,
HTTP 429/5xx/timeout, gap detection/healing, finalized reconciliation, write guard,
auth/config privacy, JSON Schema, пагинация/фильтры, 40 concurrent read requests и
отдельный процесс с synthetic RPC→PostgreSQL→HTTP→graceful SIGTERM.

Локально 2026-09-21: 69 проверок прошли без skips на PostgreSQL **18.4**; отдельно
прошли types/build. Это synthetic/local runtime, **не devnet evidence**.

Для commit `c733fc8fdae082920b96afcf0c1b0899e40f40c1` подтверждены:
- [Watchtower CI 35553774523](https://github.com/Leo88q/ares1/actions/runs/35553774523):
  types, build и suite на PostgreSQL 17, включая fault/crash recovery и process smoke.
- [Общий CI 35553774450](https://github.com/Leo88q/ares1/actions/runs/35553774450):
  web/backend, Docker, Rust units/SBF, localnet integrations/migrations, full IDL gate.
- [Security scan 35553774449](https://github.com/Leo88q/ares1/actions/runs/35553774449):
  текущие файлы/новые коммиты; не отзыв исторического credential.
- Локальный `npm audit`: 0 найденных уязвимостей в зависимостях exporter.


## Усиленная проверка runtime smoke

`verify:devnet` теперь проверяет не только совпадение payload:

- genesis devnet, executable account и согласованность signature/slot/blockTime/error
  транзакции с RPC-списком и finalized tip;
- безопасный `/config` именно ARES-1/devnet с `writes=false`, а не чужой exporter;
- фактический `ready=true`, mode=rpc, database=up, отсутствие gaps и свежесть
  heartbeat **до и после** чтения событий; одного HTTP 200 недостаточно;
- каждую запись целиком: programId/signature/slot, outer/inner/log indices,
  applied, blockTime, commitment и декодированный payload, включая Unknown;
- все страницы результата, строго возрастающие ID, прогресс cursor и отсутствие
  пропусков/лишних событий. Если последняя успешная транзакция не испускает событий,
  берётся следующая из ограниченного окна до 20 signatures, не выдуманный fixture.

Bearer token передаётся только по HTTPS либо HTTP loopback (`localhost`,
`127.0.0.1`, `[::1]`). `WATCHTOWER_VERIFY_EXPORTER_URL` — **origin** exporter без
userinfo, path prefix, query и fragment. Redirects запрещены. HTTP-ответ ограничен
2 MiB, действуют request timeout и общий CLI deadline 60 секунд.

Тесты verifier используют только synthetic RPC/HTTP. Отдельно весь CLI проверяется
через живые локальные HTTP-процессы и PostgreSQL, **без `--capture-fixture`**.
Ни успешный synthetic тест, ни само совпадение событий не подтверждают deployed
binary/полный inventory и не включают флаг центрального подключения.

После этого изменения локально прошли **111 тестов без skips**, typecheck и build;
в том числе 42 проверки verifier и запуск CLI против synthetic RPC, реальной
локальной PostgreSQL и отдельного exporter-процесса. Это не новый devnet PASS.
Повторный публичный RPC probe вернул `ECONNRESET`; live RPC/DB/token/exporter URL
в окружении не настроены, `watchtower/.env` отсутствует. `lastVerifiedAt` не менялся.

Контрольный commit `cd8cae9fe3c758a9e8145695a3914139ace5e00b`:
[Watchtower CI 35556440719](https://github.com/Leo88q/ares1/actions/runs/35556440719),
[общий CI 35556440813](https://github.com/Leo88q/ares1/actions/runs/35556440813) и
[security 35556440772](https://github.com/Leo88q/ares1/actions/runs/35556440772)
**PASS**. Watchtower suite выполнен с обязательной PostgreSQL 17, включая verifier
CLI; общий CI подтвердил прежние web/backend/Docker/Anchor/localnet/migrations/IDL
проверки. Эти результаты не означают live deployment или центральный handshake.

## Оставшиеся gates (не скрывать)

1. Разрешённый devnet RPC: проверить runtime и сохранить реальные fixtures:
   `node --env-file=.env --import tsx scripts/verify-devnet.ts --capture-fixture`.
   Exporter должен уже завершить backfill и быть ready. Для удалённого exporter
   используйте `WATCHTOWER_VERIFY_EXPORTER_URL` (server-side URL, не browser localhost).
2. Сверить deployed binary/IDL provenance, Config/mints/treasury/PDA и authority
   inventory. В manifest сейчас source-derived program ID, пустые непроверенные
   списки адресов, `deploymentVerified=false`, `lastVerifiedAt=null`.
3. Согласовать конкретную версию API/schema/cursor с Games Watchtower, выдать
   отдельный exporter credential вне Git/чата, провести центральный runtime smoke.
4. Только после этих проверок отмечать интеграцию подключённой и manifest verified.
   Скрипт smoke **не** меняет manifest и **не** отмечает центральное подключение.

Попытка публичного devnet RPC probe в sandbox завершилась transport error. Реальных
fixtures здесь пока нет. Исторический RPC credential игры всё ещё требует отдельного
отзыва; новый exporter не использует этот credential и не устраняет ту утечку.

Не входят: on-chain изменения/deployment, новые цены/валюты/правила, dashboard,
автоматические rewards/bans/campaigns, Redis, Sentry, client telemetry collector.
