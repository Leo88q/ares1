# Деплой бэкенда: Flux Orbit + внешний managed Postgres

**Решение владельца 2026-10-08:** бэкенд живёт на Flux Orbit, база `game_ops` —
внешний managed Postgres. Фронтенды остаются на Cloudflare Pages как есть
(`functions/api/[[path]].js` проксирует `/api/*` на бэкенд через
`PRESALE_API_ORIGIN`).

Под этот деплой в коде уже сделаны две правки (PR текущей сессии):

| Правка | Где | Зачем |
| --- | --- | --- |
| `PAYER_KEYPAIR_JSON` принимает **inline-JSON**, не только путь к файлу | `apps/backend/src/payerKey.ts` | у платформ без файловых секретов ключ передаётся только переменной окружения |
| Крон эпохи берёт **advisory-лок** в Postgres | `apps/backend/src/rollLock.ts`, `gameops/epochLock.ts` | при 2+ инстансах (перекрытие выкатки, план Standard/Pro) никто не катает эпоху дважды |

---

## 1. База данных — до первого деплоя

База — реестр заказов и платежей; «поднимем потом» не допускается. На Flux
managed Postgres нет (их Shared-DB — только MySQL), поэтому берём внешнего
провайдера (Neon / Supabase / DigitalOcean / любой managed Postgres).

```bash
cd game
# 1. Миграции под мигратором/владельцем схемы (идемпотентно; реестр версий + контрольные суммы)
yarn db:migrate --url="$MIGRATOR_URL"

# 2. Логины приложения и роль-ридера.
#    ВАРИАНТ для managed-БД, где CREATE ROLE запрещён (типовой случай):
#      миграции — с --skip-roles, логин заводится в консоли облака, роли выдаются отдельно
yarn db:roles --url="$MIGRATOR_URL" --writer-login=ares1_backend --reader-login=ares1_dash
#    ...или, когда логины заводит облако:  yarn db:roles --no-login

# 3. Приёмка ДО переключения трафика
yarn db:verify --url="$MIGRATOR_URL"
```

Требования к managed-БД: **PITR или ежедневные бэкапы**, и **отрепетированный
restore** (DB_RUNBOOK §7) — не «бэкап включён», а «я один раз восстановил».
Если роль `game_ops_writer` не создаётся средствами облака — используйте
`--skip-roles` и выдайте права вручную; запускать бэкенд под владельцем схемы
нельзя (слой прав держит неизменяемость журнала).

Для приложения понадобятся **две** строки подключения:
`GAME_OPS_DATABASE_URL` (логин `ares1_backend`, роль `game_ops_writer`) и
`MIGRATION_DATABASE_URL` — вторая нужна только разово для миграций и в рантайме
платформы не хранится.

---

## 2. Секреты и переменные окружения

Собираются из `apps/backend/.env.example`. В Orbit задаются как **secret
variables** (шифруются на ArcaneOS-нодах); ни одна из них не попадает в git.

| Переменная | Значение | Тип |
| --- | --- | --- |
| `NODE_ENV` | `production` | обычная |
| `PORT` | `8080` | обычная |
| `RPC_URL` | платный devnet-RPC (Helius/Triton/…) | **секрет** |
| `RPC_URL_SECONDARY` | второй, независимый провайдер (п. 103) | **секрет** |
| `REQUIRE_SECONDARY_RPC` | `1` (в production значение по умолчанию и так `true` — задать явно, чтобы не было сюрпризов) | обычная |
| `PROGRAM_ID` | `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf` | обычная |
| `PAYER_KEYPAIR_JSON` | **inline-JSON** массива из 64 чисел (см. ниже) | **секрет** |
| `PAYER_MAX_LAMPORTS` | `500000000` (0.5 SOL — потолок остывания hot-wallet) | обычная |
| `CORS_ORIGIN` | `https://ares1-play.pages.dev,https://<игровой-домен>` | обычная |
| `EPOCH_ROLL_CRON` | `*/10 * * * *` | обычная |
| `TRUST_PROXY` | `1` — ровно один прокси (проверить тестом §4.3) | обычная |
| `RATE_LIMIT_PER_MINUTE` | `30` | обычная |
| `ALERT_WEBHOOK_URL` | вебхук алертов (Slack/Discord/ntfy) | **секрет** |
| `GAME_OPS_DATABASE_URL` | строка подключения роли `ares1_backend` (логин/пароль задаются на шаге §1; значение — в секрет-стор, не в репозиторий) | **секрет** |
| `GAME_OPS_DB_ROLE` | `game_ops_writer` | обычная |
| `ADMIN_API_TOKEN` | ≥ 32 символов, сгенерировать заново | **секрет** |

Правила по ключу плательщика (без изменений, но теперь актуальнее):

- это **отдельный low-privilege кошелёк**, не authority и не reward-signer
  (`assertDedicatedPayer` отвергнет запуск иначе);
- на балансе — 0.1–0.2 SOL, потолок `PAYER_MAX_LAMPORTS` = 0.5 SOL;
- ключ попадает на чужие ноды (Flux — децентрализованный хостинг): риск
  ограничен потолком и тем, что authority этим ключом не подписать;
- inline-форма задаётся одной строкой: `PAYER_KEYPAIR_JSON=[12,34,...]` —
  без кавычек-обёрток и без переносов внутри (парсер отвергает мусор, не эхая
  значение в логи);

> **Никогда** не задавайте эти переменные в spec обычного (не-Enterprise)
> приложения classic Flux Cloud: спека публикуется на сети, env-переменные
> уезжают в открытый доступ. В Orbit secret variables шифруются; в classic
> Flux для секретов обязателен режим Enterprise.

---

## 3. Приложение в Orbit

1. Подключить GitHub-репозиторий `Leo88q/ares1`, ветка `main`.
2. **PROJECT_PATH = `game`** — не `game/apps/backend`. Причина: workspace-корень
   монорепо, от него резолвится `file:apps/web/vendor/solana-buffer-layout-utils`;
   сборка одного подкаталога без корня не увидит вендорную зависимость.
3. Сборка: `yarn install --frozen-lockfile --non-interactive && yarn workspace backend build`.
4. Запуск: `yarn workspace backend start` (внутри — `node dist/index.js`).
5. Порт приложения: `8080`. Health check: путь `/live`.
6. План: **Starter (1 инстанс)** достаточен на старте; Standard/Pro (2 инстанса)
   безопасны для крона — advisory-лок из коробки; держать 2 инстанса имеет смысл
   ради failover (Starter допускает краткий простой при перезапуске ноды).
7. Custom domain подключить сразу (CNAME на выданный Flux-домен, TLS — автоматом):
   в `PRESALE_API_ORIGIN` нельзя класть адрес, который потом сменится.

Эксплуатационные ожидания на 1 инстансе: рестарт ноды → короткий простой API;
крон эпохи догонит эпоху на следующем такте (или при старте, через 5 с);
`/ready` вернёт 503, только пока недоступна цепь/БД.

---

## 4. Проверки после деплоя (обязательные)

```bash
BACKEND="https://<выданный-или-кастомный-домен>"

# 4.1 Живость, готовность, здоровье
curl -sS -o /dev/null -w '%{http_code}\n' "$BACKEND/live"     # 200
curl -sS "$BACKEND/ready"                                      # {"ready":true,"gameOps":"on",...}
curl -sS "$BACKEND/health"                                     # ok:true, payerSol ≈ 0.1–0.2

# 4.2 Админ-поверхность (токен из секретов платформы)
curl -sS -H "Authorization: Bearer $ADMIN_API_TOKEN" "$BACKEND/api/gameops/ready"

# 4.3 TRUST_PROXY: подделка X-Forwarded-For НЕ должна менять лимитер.
#     30+ запросов с разными фальшивыми XFF: если после лимита нет 429 —
#     прокси не перекрывает заголовок, TRUST_PROXY надо ужесточить (0/false).
for i in $(seq 1 35); do
  curl -sS -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 203.0.113.$i" \
    "$BACKEND/api/config" ; done; echo
#     ожидаем серию 200 и затем 429 (лимит 30/мин на реальный IP).

# 4.4 Лендинг видит бэкенд (после обновления PRESALE_API_ORIGIN в Cloudflare Pages)
curl -sS -D- https://ares1-7e1.pages.dev/api/presale/runs/wave1 | head -1   # 200, JSON
#     без переменной было бы 503 presale_api_not_configured

# 4.5 Замок эпохи (если инстансов ≥ 2): в логах одного инстанса — «rolled epoch»/
#     «startup roll», у остальных — «another instance holds the roll lock — skipping this tick».
```

Отдельно, перед открытием тиража (денежный гейт, не «проверка деплоя»):

```bash
cd game && GAME_OPS_DATABASE_URL=… ADMIN_API_TOKEN=… RPC_URL=… PRESALE_RUN_ID=wave1 \
  yarn presale:reconcile      # exit 0 и ok:true; exit 2 — не SOL-тираж (для SKR автосверки нет)
```

---

## 5. Если авто-сборка Orbit не возьмёт монорепо

Nixpacks-детект может споткнуться о yarn-workspace + вендорную `file:`-зависимость.
Порядок действий — от простого к сложному:

1. Указать явные команды из §3 (иногда достаточно `PROJECT_PATH` + build/start).
2. Собрать образ в CI (job «Backend container build» уже делает это) и
   опубликовать в GHCR, затем — **Deploy with Docker** на Flux. Помнить: classic
   Flux требует ≥3 инстансов и для секретов — Enterprise-режим; ключ плательщика
   передавать inline-переменной (правка уже в коде), БД — внешняя.
3. VPS (Hetzner/аналог) + `docker compose up -d --build` из `game/` — путь,
   который репозиторий поддерживает без изменений (см. OPERATIONS.md,
   «Backend deployment»). Домен и TLS — Caddy/nginx или Cloudflare proxy.

---

## 6. Что этот документ НЕ закрывает

- **Ротация Helius-ключа (S-01)** — human-only, до платного RPC в проде.
- **Казначейство и решения по деньгам** (валюта волны 1, срок выдачи, бюджет
  mainnet) — см. `docs/LAUNCH_NEXT_STEPS.md` §5–7.
- **Проверка restore managed-БД** — разовая ручная процедура; без неё гейт «БД
  готова к приёму денег» не закрыт.
