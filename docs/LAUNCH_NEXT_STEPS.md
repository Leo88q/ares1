# Что дальше: включение devnet-беты и приём предоплаты

**Дата:** 2026-10-08 · Состояние: `main` = `695cd0d`, history-gate зелёный, security-периметр чист.
Документ отвечает на вопрос «включить devnet и mainnet-предоплату» фактами из репозитория
и делит работу на то, что делает владелец, и то, что можно закрыть кодом.

---

## 0. Главное в трёх пунктах

1. **На devnet деньги собрать нельзя** — devnet SOL бесплатный (`docs/PRESALE_PHASE1_RFC_2026-10-06.md` §2.1).
   «Включить devnet» = открыть **бесплатную бету**, а не приём платежей. Заявленная «предоплата на devnet»
   физически невозможна: собирать нечего.
2. **Приём денег = Фаза 1 (офчейн-предоплата, 888 SKR/пак, 500 паков) и/или Фаза 2 (ончейн за SOL/SKR).**
   Код Фазы 1 готов (бэкенд, миграции, баннер, ранбук). Упирается не в код, а в **инфраструктуру**
   (бэкенд 24/7 + БД + Cloudflare + казначейство) и в **4 HUMAN-шага** (см. §7).
3. **Валюта волны 1 по факту — не SKR.** SKR в этом проекте — **собственный токен** (пиннутый
   devnet-минт `Fotom38…`, `lib.rs:159`, в клиенте помечен «Монт SKR (devnet)», утилита
   `npm run grant-skr` начисляет тестовый SKR). На mainnet этого минта нет, рынка и цены у него нет.
   Продажа паков за SKR сейчас = продажа за внутреннюю валюту без источника для покупателя
   (предупреждение из RFC §12.4). Денежная рельса волны 1 — **SOL**.

**Обещание «выдача в день листинга на mainnet» требует mainnet-деплоя программы (~4.155 SOL rent,
RFC §5), который вне объявленного бюджета «<1 SOL» и требует внешнего аудита (ROADMAP M0, $15–30k).
Это надо решить до первой реальной оплаты, а не после (RFC §10, вопрос 5 — открыт).**

---

## 1. Что уже готово (проверено по main `695cd0d`)

| Слой | Готово |
| --- | --- |
| Программа devnet | deployed 14.09.2026: `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`; config `9FDhkBwmcNx3gh8hSgShpiAVXHW9cZBnv4t1xyHGU39q`; POTATO mint `HFEL9rBqmYwYDsZNxuV2ZonfS7adbjENUc3CdgbaiYxv`; presale cap 500 / 0.25 SOL / 1053 SKR (`game/README.md`) |
| Бутстрап devnet | `npm run init-onchain` — идемпотентно создаёт mint/config/epoch/presale (cap 500, 0.25 SOL), казну, квест-пул, SKR-ATA; проверяет наличие SKR-минта на кластере |
| Фаза 1 (офчейн) | `apps/backend/src/presale/*` (catalog/chain/orders/verify/reconcile/delivery), роуты `/api/presale/*`, миграции `game_ops` 0004–0006, `yarn presale:open-run`, `yarn presale:reconcile`, ранбук выдачи `docs/PRESALE_DELIVERY_RUNBOOK.md` |
| Витрина | лендинг `landing/PresaleBanner.tsx` (цена/остаток из строки тиража, валюта — колонка `currency`), игра `Phase1Notice.tsx` + `PresaleSection.tsx` |
| Прод-прокси API | `functions/api/[[path]].js` (Root проекта Cloudflare `ares1` = корень репо) + переменная `PRESALE_API_ORIGIN` |
| Фаза 2 (ончейн) | `buy_field_skr` подключён в игре (`GameContext.buyFieldPresale` → `PresaleSection`); `buy_field_sol` есть в клиенте, но **не вызывается ни из одного компонента** |
| Бэкенд-стек | `game/docker-compose.yml` (postgres + migrate + backend, роли БД, read-only, healthcheck), `.env.example` со всеми переменными |
| Гейты | `scripts/preflight-mainnet.sh --strict`, `scripts/deploy-mainnet.sh --prepare-squads-upgrade`, `scripts/check-invariants.ts`, `scripts/inventory-programs.mjs` + крон в `monitoring.yml` |

---

## 2. Путь A — открыть devnet-бету (без денег, дни)

| # | Шаг | Кто | Проверка |
| --- | --- | --- | --- |
| A1 | **Ротация Helius-ключа (S-01)** — иначе нет оснований для платного RPC с ограничениями (браузерный ключ публичен) | владелец | Helius dashboard |
| A2 | Платный RPC для клиента и бэкенда (публичный devnet-RPC отдаёт 429 под нагрузкой) | владелец | нет 429 в консоли |
| A3 | Прогнать `npm run init-onchain` на devnet (идемпотентно): досоздаст отсутствующее, проверит SKR-минт | владелец (ключ) | exit 0 |
| A4 | Поднять бэкенд 24/7 (нужен крон `EPOCH_ROLL_CRON`, иначе эпохи не катаются и экономика встаёт) | владелец | `/live` отвечает |
| A5 | БД: `yarn db:migrate && yarn db:roles && yarn db:verify` | владелец | `db:verify` = ok |
| A6 | Задать в сборках: `VITE_PRESALE_RUN=wave1` (лендинг+игра), `VITE_BACKEND_URL` + origin в `connect-src` (`public/_headers`) | владелец | счётчик Фазы 1 грузится |
| A7 | Алерты: `ALERT_WEBHOOK_URL`, мониторинг (`monitoring.yml`) + `watchtower` | владелец | тестовый алерт дошёл |
| A8 | Анонс бету: правила, «бесплатно, devnet, прогресс не переносится», краник SOL в игре | владелец | — |

**Чего на devnet включать НЕ нужно:** форму приёма денег. Фаза 1 на devnet не имеет смысла
(платить нечем), в UI это уже написано («пак не действует в devnet-бете»).

---

## 3. Путь B — включить приём денег (Фаза 1, офчейн)

Порядок обязателен: сначала HUMAN-гейты, потом инфра, только потом `open-run`.

1. **HUMAN-гейты (§7 пп. 1–4):** ротация ключа, GitHub secret scanning / branch protection, казначейство.
2. **Инфра:** бэкенд 24/7 + Postgres (A4/A5) с `ADMIN_API_TOKEN` ≥32 символов, `CORS_ORIGIN`, `RPC_URL`,
   `RPC_URL_SECONDARY` + `REQUIRE_SECONDARY_RPC=1`, `ALERT_WEBHOOK_URL`.
   Конкретный маршрут (Flux Orbit + внешний managed Postgres, env-таблица, проверки после выкатки):
   `docs/DEPLOY_BACKEND_ORBIT.md`.
3. **Cloudflare Pages (проект `ares1`):** `PRESALE_API_ORIGIN=https://<бэкенд>` (без `/api`).
   Без неё `/api/*` отвечает `503 presale_api_not_configured` — проверить
   `curl -s https://ares1-7e1.pages.dev/api/presale/runs/wave1`.
4. **Валюта волны 1 — решить (см. §5). Для SOL:** кошелёк-казначейство, `PRESALE_CURRENCY=sol`,
   `PRESALE_PRICE_UNITS` в лампортах (пример 250000000 = 0.25 SOL), `PRESALE_TREASURY=<кошелёк>`.
5. **Открыть тираж:** `cd game && PRESALE_RUN_ID=wave1 PRESALE_PACK_ID=meadow-4 PRESALE_CURRENCY=sol
   PRESALE_PRICE_UNITS=… PRESALE_TREASURY=… PRESALE_CAP=500 yarn presale:open-run` (идемпотентно;
   при расхождении параметров — exit 1).
6. **Гейт перед выдачами:** `yarn presale:reconcile` → `ok:true` (для SOL — полноценная автосверка;
   для SKR автосверки нет: CLI выходит с кодом 2, нужен поштучный `POST /admin/orders/:id/verify`).
7. **Выдача:** `docs/PRESALE_DELIVERY_RUNBOOK.md` — `grant_reward_once`, окно подписи 15 минут,
   ≤1000 POTATO за грант, квота 10 % капа эпохи (25 000–75 000 POTATO/сутки, RFC §12.1).
8. **Операционка:** очередь `GET /api/presale/admin/pending`, `X-Actor: <оператор>` в каждом POST.

---

## 4. Путь C — mainnet-деплой программы (для выдачи Фазы 1 и Фазы 2)

Гейты `game/docs/MAINNET_LAUNCH_GATE.md`: G-2 (Squads ≥3-of-N как upgrade authority и `GameConfig.authority`),
G-3 (воспроизводимая сборка + буфер через Squads), G-5 (**внешний аудит до реальных средств**),
G-6 (мониторинг), G-7.3 (`RPC_URL_SECONDARY` от другого вендора обязателен).

Стоимость: **~4,155 SOL** rent (`RFC §5`, перемерить на целевом кластере) + аудит $15–30k.

**Сделать в этой же сборке (бесплатно, пока деплой и так планируется):**
- **снести replay-уязвимую `grant_reward`** (`lib.rs:1513`; G-1 п. 4 — «видимый аудитору пункт») —
  ровно то, что делал закрытый невлеянным PR #51;
- решить `GRANT_QUOTA_SHARE_BPS` (10 % константа; RFC §12.3 — менять имеет смысл только на этой сборке);
- создать/выбрать SKR-минт mainnet, если SKR-механики остаются (сейчас пинована devnet-константа).

---

## 5. Решение по валюте волны 1: SOL vs SKR

| | SOL | SKR (сейчас) |
| --- | --- | --- |
| Кто может заплатить | у кого есть SOL | **никто**: SKR — внутренний токен проекта, на mainnet его нет, купить негде |
| Автосверка платежей | ✅ `presale:reconcile` (полноценный гейт) | ❌ exit 2; только поштучный `verify` |
| Что показывает UI | баннер лендинга подхватит валюту тиража сам | `Phase1Notice.tsx` **зашит «888 SKR»** — нужна правка |
| Источник денег для деплоя mainnet | ✅ реальные средства | ❌ внутренний токен |

**Рекомендация:** волна 1 — SOL; SKR-тираж — только после того, как у SKR появится рынок/ликвидность
вне игры (или как внутриигровая акция без цели «привлечь деньги»). RFC §12.4 говорит то же самое.

---

## 6. Что закрывается кодом (без владельца)

**Готово** (решение владельца 2026-10-08: Flux Orbit + внешний managed Postgres):

1. ✅ **Keypair из переменной, а не только из файла** — `PAYER_KEYPAIR_JSON` принимает
   inline-JSON (`game/apps/backend/src/payerKey.ts`); хостинги без файловых секретов
   больше не требуют костылей. Покрыто тестами (`tests/payer-key.test.ts`).
2. ✅ **Крон эпохи под несколькими репликами** — Postgres advisory-лок
   (`src/rollLock.ts` + `src/gameops/epochLock.ts`): перекрытие выкатки и план с 2
   инстансами не дублируют `roll_epoch`; без БД — явное предупреждение «ровно одна реплика».
   Покрыто тестами (`tests/roll-lock.test.ts`).
3. ✅ **Ранбук деплоя** — `docs/DEPLOY_BACKEND_ORBIT.md`: env-таблица, шаги Cloudflare
   (`PRESALE_API_ORIGIN`), проверки после выкатки (пробы, TRUST_PROXY, `presale:reconcile`),
   fallback-пути (GHCR-образ / VPS).

**Осталось из «закрываемого кодом»:**

4. **SOL-кнопка в UI:** `ixBuyFieldSol` есть (`apps/web/src/utils/anchorClient.ts:427`),
   но не вызывается ни из одного компонента → покупка поля за SOL (Фаза 2) в интерфейсе
   отсутствует.
5. **Снести replay-уязвимую `grant_reward`** (`lib.rs:1513`) и перевести тесты на
   `grant_reward_once` — повтор работы PR #51; G-1 п.4 называет это «видимым аудитору пунктом».
   Делать в той же сборке, что и mainnet-деплой.
6. **Валюта в игре:** `Phase1Notice` вместо константы `PHASE1_PRICE_SKR = 888` читает строку
   тиража (`GET /api/presale/runs/:id`) → SOL/SKR без правок кода.

---

## 7. HUMAN-гейты (сводка по приоритету)

1. **Ротация Helius-ключа** (S-01) — единственный реальный security-fix; обязателен до платного RPC и денег.
2. **Казначейство:** кошелёк (SOL) или ATA (SKR), кто хранит ключи, кто оператор выдачи.
3. **GitHub:** secret scanning + push protection, Dependabot alerts, branch protection на `main` (S-03, S-04).
4. **Решение о бюджете mainnet:** 4,155 SOL + аудит до реальных средств; иначе обещание «выдача в день
   листинга» не обеспечено (RFC §10 вопрос 5 — открыт с 2026-10-06).
5. Registrar/DNS кастомных доменов (`ares1.is-a.dev` не зарегистрирован — чек-лист §3).
