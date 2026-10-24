# Runbook слоя данных `game_ops`

> Этот runbook описывает текущую PostgreSQL-реализацию. Он не разрешает нерешённый выбор PostgreSQL vs SQLite: решение владельца остаётся открытым; SQLite потребует полноценного porting и повторных тестов. Используй этот документ только для текущего изолированного PostgreSQL test/dev окружения, пока выбор не подтверждён.

Документ отвечает на вопросы «как выкатить», «как проверить, что защита работает»,
«что делать, если сверка разошлась» и «какую нагрузку это держит». Все команды
запускаются из каталога `game/`; строка подключения передаётся `--url` или
`GAME_OPS_DATABASE_URL`.

Реализация: `game/migrations/game_ops/*.sql`, сервисный код —
`game/apps/backend/src/gameops/`, админ-API — `game/apps/backend/src/routes/gameops.ts`,
скрипты — `game/scripts/db-*.ts`, тесты — `game/tests/db/*.test.ts`.

## 1. Что именно развёрнуто

| Объект | Назначение |
|---|---|
| `reward_intents` | единственное место, где офчейн-состояние опережает цепь: намерения выплат с `nonce`, машиной состояний и неизменяемыми денежными полями |
| `reward_ledger` | append-only зеркало финализированных ончейн-событий (hash-chain `prev_hash` → `row_hash`) |
| `ledger_chain_head` | голова цепочки; писатели держат её `FOR UPDATE`, поэтому «вилка» цепочки невозможна даже при нескольких процессах |
| `admin_audit` | аудит админ-действий: `actor`, `action`, `subject`, `outcome`, `detail_hash` |
| `chain_reconciliation` | доказательство сходимости: `granted − ledger = drift` (append-only) |
| `service_cursors` | курсоры сервисов; единственная изменяемая таблица, и та — только CAS по `version` |
| роли | `game_ops_migrator` (DDL), `game_ops_writer` (рантайм), `game_ops_reader` (дашборды) |
| 28 триггеров в текущих миграциях | append-only, batch-проверка цепочки, машина состояний, неизменяемость денежных полей, CAS курсоров, аудит и Colony event/challenge guards |

Три независимых уровня защиты (падение одного не открывает историю):

1. **права** — у писателя нет `UPDATE`/`DELETE` на журнал, аудит и сверку; на
   интенты `UPDATE` выдан по колонкам (`state`, `signature`, `slot`,
   `failure_code`, `updated_at`), а не на таблицу;
2. **триггеры** — даже владелец схемы, отключивший права, получает
   `APPEND_ONLY_UPDATE`/`APPEND_ONLY_DELETE`; связность пакета проверяется
   statement-level триггером (один проход на батч, а не N триггеров);
3. **содержимое** — hash-chain строк журнала; суточный Merkle-корень
   (`merkleAnchor`) печётся во внешнюю систему (цепь/подписанный чекпойнт).

## 2. Выкатка

```bash
# 0. Переменные окружения приложения (секреты — из хранилища, не из репозитория)
#    GAME_OPS_DATABASE_URL=postgres://…      # строка подключения приложения
#    GAME_OPS_DB_ROLE=game_ops_writer        # роль рантайма (startup-параметр role)
#    ADMIN_API_TOKEN=<≥32 символов>          # токен админ-API
#    GAME_OPS_* — пул, таймауты, ожидаемая версия схемы (см. env.ts)

# 1. Миграции под мигратором/владельцем схемы (идемпотентно, реестр версий + контрольные суммы)
yarn db:migrate --url="$MIGRATOR_URL"

# 2. Логины приложения и роль-ридера (пароли — из секрет-стора)
GAME_OPS_WRITER_PASSWORD=… GAME_OPS_READER_PASSWORD=… \
  yarn db:roles --url="$MIGRATOR_URL" --writer-login=ares1_backend --reader-login=ares1_dash

# 3. Приёмка ДО переключения трафика
yarn db:verify --url="$MIGRATOR_URL"          # полная приёмка схемы и прав, ненулевой код при провале

# 4. Запуск бэкенда (слой включается только при заданном GAME_OPS_DATABASE_URL)
yarn workspace backend start
```

### Выкатка в контейнерах (docker-compose.yml)

```bash
# Run from game/. The Compose build context is the repository root so the local
# apps/web/vendor/solana-buffer-layout-utils dependency is included safely.
# .env рядом с docker-compose.yml:
#   GAME_OPS_POSTGRES_PASSWORD=<сильный пароль>
#   MIGRATION_DATABASE_URL=postgres://postgres:<пароль>@postgres:5432/ares1
docker compose up -d --build

# Логины приложения (один раз, из хоста: порт публикуется только на 127.0.0.1)
GAME_OPS_WRITER_PASSWORD=… GAME_OPS_READER_PASSWORD=… \
  yarn db:roles --url="postgres://postgres:<пароль>@127.0.0.1:5432/ares1"
# В apps/backend/.env: GAME_OPS_DATABASE_URL=postgres://ares1_backend:<пароль>@postgres:5432/ares1
```

Что происходит: поднимается `postgres` (порт только на loopback), затем
одноразовый сервис `migrate` применяет миграции из образа
(`node apps/backend/dist/db-migrate.js`, тот же код, что и `yarn db:migrate`) и
завершается; `backend` стартует только после его успеха
(`depends_on: service_completed_successfully`) под ролью `game_ops_writer`
(`GAME_OPS_DB_ROLE`), то есть без прав на DDL и без права править журнал. При `COLONIES_ENABLED=true` startup дополнительно требует ровно `GAME_OPS_DB_ROLE=game_ops_writer` и проверяет фактический `current_user` вместе с узкими Colony grants (runtime не может напрямую выдавать entitlements, менять Field/owner, править event log или выполнять DDL; бесплатная стартовая выдача разрешена только через ограниченную `SECURITY DEFINER` функцию миграции 0013).
Проверка после выкатки: `curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
http://127.0.0.1:8080/api/gameops/ready` — `ready: true` и все проверки `ok`.

### Включение бесплатного Colony onboarding на изолированном devnet/staging

Это только серверная возможность; включение не делает релиз или продажу. Сначала применить миграции до версии 13, создать runtime-роли и пройти `db:verify`, затем настроить на staging:

```env
SOLANA_CLUSTER=devnet
COLONIES_ENABLED=true
COLONY_FREE_STARTER_ENABLED=true
GAME_OPS_DB_ROLE=game_ops_writer
GAME_OPS_EXPECTED_SCHEMA_VERSION=13
```

Понадобятся также отдельная devnet `GAME_OPS_DATABASE_URL`, `COLONY_SESSION_SECRET` (не менее 32 случайных байт), `RPC_URL`, `RPC_URL_SECONDARY` если включён `REQUIRE_SECONDARY_RPC`, точный `PROGRAM_ID` и allowlist `CORS_ORIGIN`. Использовать отдельную тестовую БД, привязанную к devnet; не подключать production/mainnet базу или секреты. Backend бесплатно выдаёт один Starter на кошелёк (в рамках одного cluster) только в той же транзакции, где проверенный Field становится primary и записывается genesis event; дополнительные Field-бонусов нет. Лимит на кошелёк не является Sybil-защитой: несколько отдельных кошельков могут получить несколько стартов. Флаг по умолчанию выключен в production, mainnet заблокирован `COLONY_V1_RELEASE_READY=false`. Покупки и платежи остаются выключенными.

После настройки пройти `/ready`, wallet-signature → active Field verification → initialize → повторный `GET /state`; дополнительно проверить отказ для неподходящего Field и повторный вызов без дублей. Этот workspace не имеет staging-конфигурации, поэтому реальные переменные, миграция и запуск сервиса здесь намеренно не выполнялись.

Особенности, которые важно знать при выкатке:

- `db:migrate` **падает** (`MIGRATION_CHECKSUM_MISMATCH`), если применённый файл
  изменился после применения: правка истории миграций запрещена, изменения
  вносятся новым файлом;
- `db:migrate --skip-roles` — для managed-баз, где нельзя создавать роли;
- `db:roles --no-login` — когда логины заводит облако, а роли уже созданы;
- **контейнер `postgres` в `Restarting (1)`, порт 5432 не слушается** — том
  смонтирован по старому пути. Начиная с образа 18 том монтируется в
  `/var/lib/postgresql` (данные — в `/var/lib/postgresql/18/docker`), а
  монтирование в `/var/lib/postgresql/data` entrypoint отвергает даже пустым и
  печатает «there appears to be PostgreSQL data in … (unused mount/volume)».
  Симптом снаружи: `ECONNREFUSED 127.0.0.1:5432` на всех `db:*` и ничего больше.
  Лечение для дев-тома: `docker compose down -v && docker compose up -d postgres`.
  Если в томе есть данные, созданные старым образом, — это честный отказ, а не
  поломка: данные переносятся `pg_upgrade` (в образе есть обе версии), просто
  подсовывать каталог следующему мажору нельзя;
- откат миграций не предусмотрен: неизменяемость важнее «быстрого отката»,
  совместимость держится аддитивными изменениями (правило в
  `docs/DATABASE_DESIGN.md § 9`).

## 3. Проверка (приёмка, а не «посмотрели глазами»)

```bash
yarn db:verify --url="$MIGRATOR_URL"                        # полная приёмка
yarn db:verify --url="$URL" --skip-privileges               # managed-база без ролей
yarn db:mutate --url="$URL" --anchor=/secure/audit.json     # мутационные пробы
GAME_OPS_TEST_URL="$URL" GAME_OPS_TEST_ROLE=game_ops_writer yarn test:db
yarn test:db:unit # isolated PGlite migrations + schema/Colony grants; no configured DB required
```

Тесты слоя делят один стенд, поэтому `test:db` запускает файлы последовательно
(`--test-concurrency=1`), а пробы, которые нарочно создают «инцидент» (дрейф
сверки), пишут разрешающую строку в `finally` — упавший тест не должен оставлять
на стенде состояние, которое `db:verify` справедливо посчитает расхождением.
Сам тест сверки работает на отдельной цепочке (`t_<runId>`), чтобы его результат
не зависел от того, кто ещё пишет в журнал в этот момент.

`db:verify` проверяет 21 факт, разбитый на группы:

| Группа | Что доказывается |
|---|---|
| `migrations.*` | все файлы в реестре, контрольные суммы совпадают с репозиторием |
| `schema.*` | 12 обязательных таблиц (в текущей схеме 17), 3 представления, ≥16 триггеров, ключевые индексы, включая uniqueness Field links |
| `privileges.*` | у писателя нет `UPDATE`/`DELETE` на журнал/аудит/сверку, `UPDATE` на интенты только по колонкам, нет права `CREATE` |
| `mutate.*` | фактические попытки `UPDATE`/`DELETE`/подмены отклоняются (под `SET ROLE` рантайм-роли) |
| `chain.*` | содержимое каждой строки журнала, связность, голова, `row_count` |
| `intents.ledger_amount_match` | суммы и получатели подтверждённых интентов совпадают с зеркалом (ловит подмену денежного поля интента, которую hash-chain не видит) |
| `reconciliation.drift` | по каждому потоку последняя сверка имеет `drift = 0` |

Локальный прогон `yarn test:db:unit` (PGlite 0.5.8) применяет миграции `0001`–`0013`; проверки включают grants, Field-link lifecycle, безопасную бесплатную стартовую выдачу и повторный claim. Отдельный CI job `gameops-db` применяет миграции на настоящем PostgreSQL и запускает `colony-postgres.test.ts` с runtime-ролью, включая сервисный путь создания Colony. В этом workspace operational `GAME_OPS_TEST_URL` не задан, поэтому PostgreSQL acceptance и `db:verify` против целевой БД здесь не выполнялись. PGlite не проверяет failover, managed-provider behavior, production backup или restore; CI acceptance тоже не заменяет эксплуатационный backup/restore drill.

## 4. Что делать, если

**Сверка разошлась (`drift ≠ 0`).**
Readiness отдаёт 503, выдача наград закрыта. Порядок действий: (1) остановить
подписанта, (2) зафиксировать окно — `stream_id`, `finalized_slot`, `from_slot`,
суммы; (3) найти расхождение: ончейн-события (по signature/slot) против строк
журнала, `yarn db:verify` покажет расхождение интент↔зеркало; (4) после
объяснения причины записать **новую** строку сверки с `drift = 0`
(`POST /api/gameops/reconciliation`); прежняя строка с расхождением остаётся в
истории навсегда — это и есть доказательство инцидента. Править прежние строки
нельзя ни правами, ни триггером.

**Цепочка не сходится (`db:verify` → `chain.verify`).**
Немедленно: остановить запись, снять дамп `reward_ledger` и `ledger_chain_head`.
`verifyChain`/`db:verify` скажут точку и тип нарушения: `content_mismatch`
(подмена строки), `link_broken` (удаление/вставка), `head_mismatch` (откат
головы), `row_count_mismatch` (запись в обход триггера). Восстановление — из
дампов + ончейн-истории; журнал не «лечится» правкой строк.

**Пропала строка аудита.**
Без внешнего якоря удаление строки аудита неотличимо от «события не было» —
это честное ограничение (мутация `m5`). Поэтому: `yarn db:mutate
--anchor=/secure/audit.json --write-anchor` периодически (по расписанию) пишет
`{count, max(id)}` в защищённое хранилище **вне БД**; расхождение с якорем и есть
сигнал. Рекомендуется писать якорь после каждой эпохи.

**Компрометация ключей/доступа.** Права не дают выполнить `DELETE`/`UPDATE` на
журнал, аудит и сверку даже приложению; но у владельца схемы остаются оба
следа: отключение триггера и подмена — ловятся `db:verify` и hash-chain. При
подозрении на компрометацию владельца: снять доступ, снять дампы, прогнать
`db:verify`/`db:mutate`, сверить Merkle-корни суток с ончейн-якорем (совпадение
корня означает, что данные дня не менялись).

**Устаревшая сверка.** `reconciliation_freshness` в readiness: если последняя
сверка старше `GAME_OPS_RECONCILIATION_MAX_AGE_MINUTES` (по умолчанию 20 мин),
сервис отдаёт 503 — «нет доказательства» трактуется как «нет готовности».

## 5. Мутационные тесты (доказываем, что защита ловит дефект)

Каждая мутация применяется **в транзакции и откатывается**; база остаётся
чистой, отчёт — нет.

| # | Мутация (привилегированная, как у владельца схемы) | Детектор | Результат |
|---|---|---|---|
| m1 | подмена суммы в строке журнала (триггер `UPDATE` отключён) | пересчёт `row_hash` из колонок | поймано |
| m2 | удаление строки журнала | связность цепочки (`link_broken`) | поймано |
| m3 | откат головы цепочки | `head_mismatch` | поймано |
| m4 | вброс строки с корректным hash-chain в обход триггера | `row_count` головы против числа строк | поймано |
| m5 | удаление строки аудита | внешний якорь (без якоря — «нет якоря», честно) | поймано с якорем |
| m6 | `GRANT UPDATE` писателю на журнал | проверка фактических прав | поймано |
| m7 | удаление триггера машины состояний интента | инвентаризация триггеров + проба запрещённого перехода | поймано |
| m8 | подмена суммы интента (guard-триггер отключён) | сверка интент↔зеркало | поймано |

Запуск: `yarn db:mutate --url=…` (внутренние детекторы), полный вариант — с
`--anchor=<файл>` после `--write-anchor=<файл>`.

## 6. Нагрузка (измерено, а не оценено)

Стенд: `yarn db:bench --url=… --rows=5000 --concurrency=16 --json=db-bench.json`.
Каждый сценарий идёт тем же кодом, что и прод (сервисные модули + `pg.Pool`).

Диапазоны — по пяти прогонам (2 000–5 000 строк, 8–16 воркеров) на PGlite 0.5.8
в песочнице; порядок величин стабилен, отдельные сценарии «плавают» в 2–5 раз
из-за WASM и общего CPU.

| Сценарий | Строк/с | p50, мс | Комментарий |
|---|---|---|---|
| интенты поштучно | 440–650 | 1.4–2.0 | каждый вызов — своя транзакция (жёсткий путь) |
| интенты пачкой 100 | 3 900–6 500 | 14–23 | `unnest`, один round-trip на пачку |
| интенты пачкой 1000 | 7 200–10 400 | 17–141 | точка, где PGlite начинает «дышать» |
| интенты пачкой 5000 | 35 000–53 000 | 24–71 | 5000 строк одним запросом |
| журнал пачкой 100 | 5 200–13 300 | 4.5–17 | плюс 100 хэшей и запись головы |
| журнал пачкой 1000 | 6 000–47 600 | 8.5–97 | |
| журнал пачкой 5000 | 8 300–42 900 | 19–462 | 5000 sha256 + проверка связности в БД |
| журнал поштучно | 196–504 | 1.8–4.3 | худший случай (событийный индексатор) |
| журнал, 8–16 воркеров × пачка 100 | 8 600–14 400 | 30–37 | сериализация на голове: масштабирования нет по замыслу |
| проверка хвоста 100 записей | не показательна | 0.9–9.6 | тёплый/холодный кэш WASM |
| проверка хвоста 1000 записей | не показательна | 0.9–18.6 | в readiness стоит лимит 500 |
| чтение actionable-интентов | 50–256 | 3.9–20 | представление с фильтром по сроку |

Как это читать:

- **цифры — нижняя граница, а не потолок**: PGlite — это PostgreSQL 18,
  скомпилированный в WASM и работающий в одном потоке; настоящий `postgres:18`
  на двух vCPU даёт больше на всех сценариях (тот же SQL, тот же протокол,
  те же тесты). Цифры CI-джоба `gameops-db` (артефакт `db-bench.json`) — это уже
  честный сервер, их и стоит брать в capacity-план;
- запись по одной строке (сотни строк/с) — сознательно не основной путь: и
  индексатор событий, и админ-API пишут пачками, где даже на PGlite выходит
  **десятки тысяч строк/с**;
- конкурирующая запись **не масштабируется линейно** и не должна: писатели
  сериализуются на строке головы цепочки. Это цена гарантии «нет вилок
  журнала»; выигрыш в пропускной способности даёт размер пачки, а не число
  воркеров;
- проверка целостности хвоста стоит единицы–десятки миллисекунд, поэтому
  readiness (лимит 500 строк) не влияет на latency выдачи наград.

По этим цифрам «выдерживаемая нагрузка» слоя данных на одном узле: десятки
тысяч строк журнала в секунду на пачках, единицы тысяч транзакций выплат в
секунду при пакетной выдаче и сотни — при поштучной. Для игры этого достаточно
с большим запасом: награды не являются высокочастотным потоком (лимит
`grant_reward` и дневной mint cap ограничивают поток раньше, чем СУБД).

Воспроизведение в CI: джоб `gameops-db` поднимает `postgres:18`, применяет
миграции, прогоняет тесты/мутации/приёмку и складывает `db-bench.json` в
артефакты — цифры из CI и есть «выдерживаемая нагрузка» на честном сервере.

## 7. Эксплуатационные пределы и что осталось за рамками

- **Внешний якорь аудита обязателен**: без него удаление строки аудита
  неотличимо от отсутствия события (мутация m5). Нужен расписанный по
  расписанию `db:mutate --write-anchor` в защищённое хранилище.
- **Merkle-якорь ончейн**: `merkleAnchor` считает корень окна; транзакцию якоря
  и продвижение курсора `anchor:<chain_id>` выполняет ончейн-часть
  (существующий механизм эпох). Пока якорь не подтверждён, курсор не двигается.
- **Репликация/бэкапы**: логическая репликация таблиц `game_ops` + PITR; бэкап
  нельзя считать доказательством неизменяемости (это снимок, а не цепочка) —
  доказательство даёт hash-chain + сверка.
- **Секреты**: `ADMIN_API_TOKEN` ≥32 символов, пароли ролей ≥20, хранятся вне
  репозитория; токен сравнивается постоянным временем.
- **Не покрыто тестами**: поведение под реальной сетевой деградацией
  (потери пакетов, failover) — это проверяется на staging, а не в песочнице.

## 8. Persistent Colony backup / recovery gate

Migration `0010_colonies.sql` adds an append-only event history whose event payloads
contain each committed state snapshot. Before any production enablement:

1. Configure encrypted automated backups and point-in-time recovery in the selected
   PostgreSQL provider. Keep backup credentials and keys outside this repository;
   this repo does not select or purchase a provider.
2. Record the provider's retention window, RPO/RTO, operator access policy and
   alert route in the deployment record. A green health endpoint is not evidence
   that backups are restorable.
3. On a schedule, restore the latest backup to a separate isolated database (never
   over production), run `yarn db:verify` against it, then run
   `GAME_OPS_DATABASE_URL=... yarn colony:audit` using the read-only
   `game_ops_reader` role. The audit checks each immutable hash chain, sequence,
   state checksum and reconstruction from event snapshots.
4. Compare restored row/event counts and sample wallet/Field links without
   exporting wallet lists into logs. Record duration, failures and restore point;
   alert on any mismatch or missed drill.
5. Keep `COLONY_V1_RELEASE_READY=false` until a successful restore drill, a written
   RPO/RTO acceptance and operational sign-off exist. Do not test restoration
   against a live mainnet database or use production wallet secrets in the drill.

The sandbox has no configured operational PostgreSQL provider/credentials, so the provider backup/restore procedure and `db:verify` have not been executed against the selected operational database; this remains a hard production release gate. The local PGlite unit suite applies all thirteen SQL migrations, while CI's `gameops-db` job performs real PostgreSQL migration, role, service-flow, and `db:verify` acceptance. Neither test environment certifies production backup/restore, managed-provider failover, or operational monitoring.
