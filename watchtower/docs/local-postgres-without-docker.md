# Настоящий PostgreSQL без Docker и apt (для проверки read-model)

Зачем: тест `tests/watchtower-postgres.test.ts` пропускается без `WATCHTOWER_TEST_DATABASE_URL`, а в
закрытых песочницах/CI без сервисных контейнеров Postgres поставить нечем. PGlite — это настоящий
PostgreSQL, собранный в WASM; через wire-протокол (`@electric-sql/pglite-socket`) к нему подключается
обычный драйвер `pg`, поэтому миграции, `jsonb`, `FOR UPDATE`, триггеры и HMAC-курсор проверяются
по-настоящему, а не на моках.

**Новых зависимостей в `package.json` нет.** Установка — только для локальной проверки, с явным
`--no-save` (контроль supply chain, чек-лист 66/79):

```sh
cd watchtower
npm i --no-save @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11
node scripts/local-pg-pglite.mjs &        # слушает 127.0.0.1:55432, применяет migrations/watchtower-read-model.sql
export WATCHTOWER_TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/watchtower_test'
npm run test:integration                  # см. ниже
```

Тест отказывается работать вне базы с именем `watchtower_test` — это защита от разрушительных
операций (`DROP SCHEMA`).

```sh
# полный DB-набор (в т.ч. обычно пропущенный интеграционный тест)
WATCHTOWER_TEST_DATABASE_URL=... npx tsx --test tests/watchtower-postgres.test.ts
# отдельные подтесты, когда нужно изолировать окружение
WATCHTOWER_TEST_DATABASE_URL=... npx tsx --test --test-name-pattern="authenticated HTTP endpoints" tests/watchtower-postgres.test.ts
```

## Ограничения PGlite (важно для интерпретации результатов)

PGlite — **один бэкенд**, поэтому две вещи проверить нельзя (фиксируется как «не проверено», а не как
«прошло»):

1. **Терминация бэкенда во время записи** (подтест «database backend termination during write rolls
   back and supports replay»). `pg_terminate_backend()` возвращает `false` и ничего не делает;
   `pg_stat_activity` показывает единственную строку `pid=42`, `wait_event='PgSleep'` не появляется.
2. **Отдельный процесс экспортёра** (подтест «separate exporter process…»). Socket-сервер обслуживает
   одно соединение: пока один клиент держит соединение, второй блокируется/рвётся
   (`Connection terminated unexpectedly`). По той же причине **нельзя измерять конкурентный RPS** API —
   под конкуренцией запросы к хранилищу падают и обработчик честно отдаёт `503 EXPORTER_UNAVAILABLE`.

Остальные пять подтестов (дедупликация и UNIQUE raw, откат страницы при сбое записи курсора,
`FINALIZED_RECONCILIATION_MISMATCH`/`STALE_CURSOR`, сохранение unknown-событий, HTTP-контракт с 401 и
границами фильтров) проходят на PGlite и подтверждают транзакционную семантику read-model.
Для полной проверки нужен обычный PostgreSQL (несколько бэкендов) — сервисный контейнер в CI.

Тот же предел виден и на слое `game_ops`: с `PG_MAX_CONNECTIONS > 1` транзакции
разных сессий физически идут в один бэкенд, поэтому **параллельные сессии не
изолированы как в настоящем PostgreSQL** — одновременные `BEGIN/ROLLBACK` из разных
процессов откатывали чужие результаты (наблюдали исчезновение реестра миграций
`schema_version`). Отсюда два правила:

- DB-тесты `game_ops` запускаются последовательно (`yarn test:db` идёт с
  `--test-concurrency=1`), а тесты внутри прогона не полагаются на изоляцию,
  которой на этом стенде нет (сверка работает на отдельной цепочке `t_<runId>`);
- конкуренцию, блокировки и нагрузку измеряйте на настоящем PostgreSQL (джоб CI
  `gameops-db` или `postgres:18` из `game/docker-compose.yml`), а не здесь.

`PG_APPLY_GAME_OPS=1` применяет миграции `game_ops` и заполняет реестр версий
(`schema_version`) теми же контрольными суммами, что и `yarn db:migrate`, — иначе
`db:verify` и тесты честно сообщали бы «миграции не применены».

## Нагрузочный прогон

```sh
# mock JSON-RPC + ingestion (страницы по 50 tx, атомарный savePage) + HTTP API
WATCHTOWER_TEST_DATABASE_URL=... node --import tsx scripts/bench-load.mjs 1500 32
```

Выводит JSON: пропускную способность декодера (без БД), ingestion (tx/с, событий/с, строк БД/с) и
латенси HTTP-маршрутов. Числа на PGlite — **нижняя граница**; результат прогона 2026-09-27 и методика —
в `docs/DATA_TESTS_AND_CAPACITY_2026-09-27.md`.
