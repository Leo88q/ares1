# Devnet smoke — экспортёр ARES-1 (watchtower)

Живая read-only проверка того, что экспортёр фактически работает против devnet:
инжестит финализированные события программы и декодирует их так же, как
офлайн-декодер IDL.

## Что проверяет `verify:devnet`

1. `getGenesisHash` RPC = devnet (защита от переподключения на другой кластер).
2. Аккаунт программы `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf` существует
   и executable (finalized).
3. Экспортёр поднят: `/watchtower/config` отвечает ожидаемым safe-конфигом,
   `/watchtower/readyz` — 200 и свежий (`lastSuccessAt` в пределах
   `max(pollMs*3, 60 c)`, `finalizedLag` в обёртке и в data совпадают).
4. Берутся до 20 последних финализированных транзакций программы; для первой
   успешной с известными применёнными событиями:
   - транзакция перечитывается с проверкой slot/metadata против страницы
     подписей (`FINALIZED_SLOT_MISMATCH`, `TRANSACTION_METADATA_MISMATCH`);
   - события декодируются офлайн по IDL;
   - результат сверяется **строго** (`isDeepStrictEqual`) с тем, что экспортёр
     постранично отдал через `/watchtower/events/<signature>`
     (`SMOKE_EVENTS_MISMATCH`).

Успех: `{"result":"runtime_smoke_pass", ...}`. Это **не** подтверждение
подключения к центральному Games Watchtower (`watchtowerConnected` остаётся
`false` — handshake хаба отдельный гейт) и не подтверждение `deploymentVerified`
манифеста.

## CI

Job `devnet-smoke` в `.github/workflows/watchtower.yml` (push при изменении
`watchtower/**`, либо workflow_dispatch; PR-запуски пропускаются):

- postgres-сервис (схема `migrations/watchtower-read-model.sql`), экспортёр
  `npm run dev` с `WATCHTOWER_EVENT_PROVIDER=rpc` (read-only,
  `WATCHTOWER_ENABLE_WRITES=false`), токен — `openssl rand -hex 24` на каждый run;
- ожидание `readyz` до 3 минут (прогресс публикуется аннотациями каждые 30 s,
  вместе с ответом readyz); затем `npm run verify:devnet`;
- все исходы публикуются аннотациями (`::notice`/`::warning`/`::error`) —
  архив логов job из API-окружений недоступен, аннотации единственный канал.

Семантика исходов (красный run только при доказанной ошибке декодирования/
пагинации/конфига экспортёра):

| Исход | Значение | Run |
|---|---|---|
| `runtime_smoke_pass` | экспортёр готов и события строго совпали с офлайн-декодом IDL | ✅ + `::notice` |
| `NO_KNOWN_APPLIED_EVENT` | по программе нет трафика с известными событиями (тихая devnet ≠ регрессия) | ✅ + `::warning` |
| не `readyz` за 180 s, `phase=backfill/head` + `issues` содержит `RPC_429`/`RPC_5*` | публичный RPC троттлит исторический backfill — данных для сверки нет (окружение, не код) | ✅ + `::warning` |
| не `readyz` за 180 s с другой причиной (phase=error, процесс ответил не HTTP и т.п.) | экспортёр сломан | ❌ + `::error` |
| `SMOKE_EVENTS_MISMATCH`, `TRANSACTION_METADATA_MISMATCH`, `INVALID_EXPORTER_PAGINATION`, `WRONG_EXPORTER_CONFIG` и остальные | реальный дефект экспортёра/данных | ❌ + `::error` |
| процесс экспортёра умер / `migrate` упал | окружение или код — всегда | ❌ + `::error` |

**Жёсткий гейт.** Публичный `https://api.devnet.solana.com` rate-limit'ит
backfill, поэтому на нём smoke по определению «best effort». Чтобы сделать job
жёстким гейтом, задайте в репозитории secret (или variable)
`WATCHTOWER_SMOKE_RPC_URL` — URL с API-ключом (например, пост-S-01 Helius
devnet-ключ), лимит которого выдерживает backfill; job подхватит его
автоматически. URL в аннотации не попадает — публикуется только метка
«публичный/настроенный RPC».

## Локальный запуск (нужен egress к devnet RPC)

```sh
# 1. PostgreSQL со схемой
createdb watchtower
WATCHTOWER_DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/watchtower" \
WATCHTOWER_EXPORTER_TOKEN="$(openssl rand -hex 24)" \
  npm run migrate

# 2. Экспортёр (rpc-провайдер, read-only)
WATCHTOWER_EVENT_PROVIDER=rpc \
WATCHTOWER_RPC_URL="https://api.devnet.solana.com" \
WATCHTOWER_DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/watchtower" \
WATCHTOWER_EXPORTER_TOKEN="$(openssl rand -hex 24)" \
WATCHTOWER_ENABLE_WRITES=false \
  npm run dev &

# 3. Дождаться readyz, затем верификация
curl -s -H "Authorization: Bearer $WATCHTOWER_EXPORTER_TOKEN" \
  http://127.0.0.1:8790/watchtower/readyz
WATCHTOWER_EVENT_PROVIDER=rpc \
WATCHTOWER_RPC_URL="https://api.devnet.solana.com" \
WATCHTOWER_DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/watchtower" \
WATCHTOWER_EXPORTER_TOKEN="$WATCHTOWER_EXPORTER_TOKEN" \
  npm run verify:devnet
# для захвата фикстуры (реальная devnet-транзакция в events/fixtures/real-devnet/):
#   ... npm run verify:devnet -- --capture-fixture
```

Фикстуры из `--capture-fixture` — реальные финализированные devnet-транзакции
с явной пометкой происхождения (`provenance: real-devnet`).

## Известные ограничения

- Публичный devnet RPC: при rate-limit экспортёр пишет `INGESTION_RETRY` и
  ретраит; smoke может не успеть за 3 минуты — повторный запуск обычно
  проходит.
- Devnet-состояние (аккаунты, история) может быть сброшено операцией
  кластера; тогда требуется пересовместить реестры/манифесты вручную.
- Smoke не заменяет централизованный handshake и `deploymentVerified=true`
  (см. `WATCHTOWER_HANDOFF.md` §A, «Три главных блокера»).
