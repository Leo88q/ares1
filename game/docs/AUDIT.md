# AUDIT — текущее состояние репозитория (Этап 1 «Мастер-промта: довести игру до продакшена»)

**Дата:** 14.09.2026 · **Объём:** `programs/solana_potato` (Anchor 0.30.1, Agave 4.2.2), `apps/web` (React/Vite, Telegram Mini App), `apps/backend` (Express), `apps/bot` (grammY), `landing/`, скрипты деплоя, CI.

> **⚠ Изменение после этого аудита (14.09.2026, продуктивное решение):**
> Telegram удалён полностью (Mini App, кран наград, бот, initData, рефералка
> через бота) — продукт целится в **Solana dApp Store**, идентичность = кошелёк.
> Последствия для документов:
> - `apps/bot/` удалён (workspaces, CI, README).
> - `apps/backend` урезан: больше нет крана наград (`/api/reward/*`) и
>   рефералки (`/api/referral/*`) — остались `/health`, `/api/config` и
>   on-chain epoch-roller. Найдения **I7, I12, I13** (и всё, что связано с
>   `TELEGRAM_CHANNEL_ID`, `VITE_BOT_USERNAME`, `getChatMember`, initData)
>   **не актуальны** — код удалён.
> - Квесты/нашивки теперь on-chain: `claim_achievement` (идентичность —
>   кошелёк, пул 550 🥔). Рефералка on-chain: `register_referrer`/`fill_order`.
> - Экономика пересчитана без TG-крана — см. `ECONOMY-AUDIT-2026-09-14.md §9`
>   (finding E1 недействителен).
> Ниже — состояние **на момент аудита** (историческая справка); строки,
> описывающие TG-компоненты, отражают тот срез, а не текущий.
**Живое состояние:** devnet-программа `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf` (config, эпоха, пресейл cap 500 / 0.25 SOL / 1053 SKR, казны, SKR-рельса активна). Предыстория закрытых дефектов: `docs/AUDIT-2026-09-13.md` (C1–C9, H1–H4 закрыты) и гит-лог.

Критичность: **blocker** — без этого «продакшн» невозможен; **important** — нужно закрыть до mainnet, но devnet-игра работает; **nice-to-have** — гигиена.

---

## 1. Blocker

| # | Слой | Находка | Что сделать |
|---|---|---|---|
| B1 | infra/web | **Старый program id `48D2…` закреплён во всех production-путях**, хотя живая программа — `DUUBi…`: закоммиченные `apps/web/.env.production` и `.env.example`, fallback `DEFAULT_PROGRAM_ID` в `apps/web/src/contexts/SolanaContext.tsx`, `Anchor.toml` (все 3 кластера), job `web` в `ci.yml` (env `VITE_PROGRAM_ID`), `apps/backend/.env.example`, `landing/content.ts`, `README.md`, `docs/API.md`, `apps/web/check-devnet*.mjs`. CF Pages собирает prod из `main` → продакшн-UI будет стучать в мёртвую программу. | Единым коммитом заменить id на `DUUBi…` (+ решить вопрос mainnet-айра, см. B3); удалить fallback из `SolanaContext` (fail-fast: нет `VITE_PROGRAM_ID` → ошибка, а не старый адрес) |
| B2 | infra | **GitHub Actions отключены** (`/actions` → 404, запусков нет). `ci.yml` (build + 13 unit + `anchor test` + tsc + vite build + IDL-freshness) существует, но не работает — каждое изменение идёт без гейта. | Включить Actions (Settings → Actions → General), прогнать PR до зелёного; далее — обязательное условие любого мержа |
| B3 | security | **Один authority-ключ = полный контроль игры** (`withdraw_treasury` без лимитов/таймлока, `set_paused`, `update_config`, `propose/accept_authority`, `grant_reward`), **внешний аудит не проводился**. | Squads-мультисиг на authority; лимит/таймлок на вывод казны (или отдельная инструкция `close_treasury_sol`, см. I6); внешний аудит (OtterSec/Sec3/Neodyme) до вывода реальных денег. Код-ревью агентом ≠ аудит |
| B4 | security/backend | **Бэкенд держит тот же полный authority-ключ** (`AUTHORITY_KEYPAIR_JSON`) на сервере: компрометация сервера = вывод казны + пауза + смена authority. Ограничений у ключа нет (инструкции программы не разграничивают права). | Выделить «reward signer»: в v2 программы — отдельная роль (только `grant_reward`), на devnet — принять риск и держать ключ на отдельной VM/вolumes, доступ только под бэкендом |
| B5 | infra | **Продакшн-сборка не функциональна из коробки:** `VITE_BACKEND_URL` пуст в `.env.production` (квесты/награды отключены), бэкенд никуда не задеплоен (инфраструктуры нет), `VITE_RPC_URL` = публичный devnet (429 при десятках игроков). | Задеплоить бэкенд (Fly.io/Render/CF Workers-не-пойдёт из-за keypair → VM), задать `VITE_BACKEND_URL`, платный RPC (Helius/Triton) для фронта и бэкенда |

## 2. Important

| # | Слой | Находка | Что сделать |
|---|---|---|---|
| I1 | tests | **Нет тестов на новые money-инструкции:** `buy_field_skr` / `buy_field_sol` (on-chain ролл 70/25/5, split 80/20, лимит 5/кошелёк, cap 500, paused), `claim_achievement` (пул 550 🥔, double-claim, proof полей), `buy_export_license` (новый флоу: SKR → казна, а не burn; продление; insolvent; подмена ATA казны), `init_presale` / `update_presale_price`. Есть 33 теста на базовые механики (initialize, fields, marketplace, referrals, admin) — см. §6 | Тесты в Этапе 2; критерии приёма — в `docs/MASTER-PROMPT-PRODUCTION.md` |
| I2 | program/token | **SKR mint захардкожен** (`Fotom…`, devnet) в программе и в фронте (`TEST_SKR_MINT`). На mainnet без mainnet-minta SKR-пресейл и лицензии мертвы; параметризовать без деплоя нельзя. | Решение судьбы SKR (roadmap M1): либо mainnet-mint до деплоя v2, либо вынести `skr_mint` в `GameConfig`/`PresaleState` |
| I3 | program | **`PresaleState.authority` фиксируется при init**: после `accept_authority` все покупки пресейла падают по `has_one = authority`. | Инструкция `migrate_presale_authority` (или записывать `presale.authority = config.authority` динамически) |
| I4 | ops | **Бэкенд — единственный кранк `roll_epoch`**: лёг бэкенд → эпок-кап «замирает» до 24 ч (permissionless roll есть, но никто не крутит). Fee payer кранка — backend-кошелёк: без SOL роулл молча фейлится (только лог). | Uptime-алерт на бэкенд + алерт «N эпох без roll» + держат SOL на fee; опционально публичный crank-бот |
| I5 | backend | **Состояние в JSON-файле + in-memory Map**: рестарт/редеплой теряет claims (идемпотентность сломана между рестартами), вторая реплика невозможна; Map rate-limiter **никогда не чистится** → неограниченный рост памяти на долгоживущем инстансе. | SQLite/Postgres (roadmap M1, вместе с индексером); pruning Map (TTL-очистка) — быстро, до mainnet |
| I6 | program/ops | **Средства SOL-пресейла и SKR-казны заперты on-chain навсегда:** SOL приходит в PDA `treasury_sol` (0-байтовый System-аккаунт), а инструкция, забирающая SOL из него или закрывающая аккаунт, **не существует**; SKR-казна (ATA PDA `treasury_sol`) — аналогично, вывода SKR нет. Команда не сможет забрать proceeds. | Инструкция `close_treasury_sol` / `withdraw_skr_treasury` (authority + PDA-подпись) до mainnet; на devnet — осознанно принять |
| I7 | backend | **Квест `social_channel`: верификация молча отключена**, если не задан `TELEGRAM_CHANNEL_ID` (`isChannelMember` возвращает `true`). В продакшне 10 🥔 за «подписку» выдавались бы без подписки. | Сделать env обязательным (fail-fast в `env.ts`) или явный режим `VERIFY_CHANNEL=false` с предупреждением в логах |
| I8 | backend | CORS по умолчанию `*` (`CORS_ORIGIN` не задан в примерах кроме комментария), `trust proxy 1` без описания topology. | В проде — явный `CORS_ORIGIN=<мини-апп домен>`; зафиксировать схему reverse-proxy |
| I9 | economy/backend | **Сибил в бэкенд-рефералке:** приглашённый сам выбирает реферера при `/api/referral/register` — можно вписать свой же второй кошелёк (self по одному кошельку запрещён, по двум — нет) и получить 30 🥔 за первый харвест на каждый новый TG-аккаунт. Ончейн-рефералка (`register_referrer`, burn 5 🥔) — отдельная система (скидка на рынке), для бонусной бэкенд-рефералки ончейн-стоимости нет. | Варианты: реферер обязан быть «известным» (его TG-аккаунт в БД), или burn-плата через ончейн-`register_referrer` как precondition бонуса, или снизить бонус ниже стоимости сибила. Задокументировать выбор |
| I10 | ops | **Нет мониторинга/алертов** на `TreasuryWithdrawn`, `PausedToggled`, `AuthorityProposed`, `ConfigUpdated`, `OrderFilled` (крупные), сбой roll_epoch, падение бэкенда. Единственная защита от злоупотребления authority до мультисига. | Helius webhooks → Telegram-алерт (roadmap T6) |
| I11 | web/landing | **Лендинг публичный и нечестный:** фейковые цифры пресейла (`sold: 47`), старый program id в `landing/content.ts`. | Читать `PresaleState` ончейн (devnet/mainnet) или убрать цифры; обновить id |
| I12 | web | `ReferralSection`: `TODO` — username бота из env `VITE_BOT_USERNAME` с placeholder-дефолтом; переменная отсутствует в `.env.example`. | Зафиксировать бота, добавить env в пример |
| I13 | backend | `isChannelMember`: любой сбой Telegram API трактуется как «не участник» → ложный отказ в квесте (у пользователя нет способа узнать, почему). | Отличать «нет сети» (повторить позже) от «не участник» |
| I14 | backend | Startup-чек authority — только `console.warn`: при неверном ключе бэкенд работает, а `/claim` падает в рантайме у каждого пользователя. | Либо fail-fast (exit), либо 503 с понятной причиной на `/health` + алерт |

## 3. Nice-to-have

| # | Находка |
|---|---|
| N1 | `programs/solana_potato/src/lib.rs.bak`, `lib.rs.bak2` в гите — удалить (T7) |
| N2 | Dev-скрипты в корне приложения: `apps/web/scripts/*` (sim_buy*, fund_browser_wallet, init_presale_skr, check_*, fill_test), `apps/web/check-devnet*.mjs`, `migrate-devnet.mjs` — перенести в `dev/` или вынести; часть содержит старый id |
| N3 | `TEST_SKR_MINT` в `anchorClient.ts` — вводящее в заблуждение имя (это реальный devnet-mint) → `SKR_MINT` |
| N4 | `useGame() as any` в `PresaleSection.tsx` — убрать |
| N5 | `migrate_config/field/epoch` — нужны только для legacy-state (48D2, не мигрирован; свежий деплой DUUBi создан сразу в v2-layout) — держать с явным доком «только для миграции старого devnet» или удалить в v2 |
| N6 | `PresalePurchase.sol_amount` хранит SKR-атомы (L6, историческое имя) — не менять (совместимость логов) |
| N7 | `Epoch`-аккаунты накапливаются 49 B/день бессрочно (L2) — закрытие в v2 |
| N8 | Прогрессивная комиссия (9→12 %) обходится дроблением ордера (L1, принято; решение — order book v2, roadmap M2) |
| N9 | Ролл мутаций `keccak(field, slot)` предсказуем при известном слоте (M5, принято как казуальный риск 5 %) |
| N10 | `fill_order`: PDA лицензии/рефералки из `remaining_accounts` проверяются по адресу (деривация) + deserialize, но не по owner. **Разбор:** подделать адрес PDA нельзя (уникален), чужой owner → `data_is_empty`/parse-fail → скидка просто не применится → **риск отсутствует**, owner-check — опциональная пара строк в v2 (M6, деградирован) |
| N11 | Логи бэкенда — `console.log`; в проде — structured logging (pino) + сбор |
| N12 | Кнопка airdrop в UI (devnet-удобство) — зашита от mainnet (`IS_MAINNET`), можно скрыть за флагом |
| N13 | Dev-ветка claim в `GameContext` (`localStorage dev_claimed`) — гeytится `import.meta.env.DEV`, из prod-сборки вырезается; переименовать/вынести, чтобы не пугать |

## 4. Движение денег: кто, что и как может подписать

### 4.1 Матрица активов

| Актив | Где хранится | Кто может двигаться | Механизм | Статус |
|---|---|---|---|---|
| $POTATO (mint authority) | `config` PDA | Только программа | `harvest` / `grant_reward` / `claim_achievement`, всё в пределах эпок-капа (250–750k/день) и max supply (1B); freeze authority запрещён и проверен в `initialize` | ✓ корректно |
| $POTATO казна (`treasury_potato` ATA, owner=config PDA) | on-chain | **Только `GameConfig.authority`** (один ключ) | `withdraw_treasury(amount)` — **без лимитов и таймлока** | ⚠ B3/I-часть |
| $POTATO квест-пул (550 🥔, owner=`quest_treasury` PDA) | on-chain | Только программа | `claim_achievement`, bitmap — одноразово на игрока, пул конечен | ✓ корректно |
| $POTATO escrow | PDA `escrow` (владеет собой) | Только программа | `fill_order` / `cancel_order` / `close_expired_order`, всегда сливается в 0 (бухгалтерия проверена, C5 закрыта) | ✓ корректно |
| SOL (`treasury_sol` PDA) | on-chain (0-байт System-аккаунт) | **Никто — выхода нет** | Приход: `buy_field_sol` (0.25 SOL/модуль). Вывода/закрытия инструкция **не существует** | ⚠ I6 |
| SKR казна (ATA PDA `treasury_sol`) | on-chain | **Никто — выхода нет** | Приход: 80 % SKR-пресейла + 500 SKR за лицензию (с d8affe1). Вывода нет | ⚠ I6 |
| SKR buyback (ATA кошелька authority) | обычный кошелёк | Владелец ключа | 20 % SKR-пресейла; buyback-and-burn **ручной**, ончейн-автоматики нет (L7, roadmap M4) | ⚠ принято |
| SOL игрока | кошелёк игрока | Только сам игрок | Подписи кошелька в `sendIx`; бэкенд не трогает SOL игроков | ✓ |

### 4.2 HTTP-эндпоинты бэкенда и доступ

| Эндпоинт | Аутентификация | On-chain эффект | Оценка |
|---|---|---|---|
| `GET /health`, `GET /api/config`, `GET /api/reward/quests`, `GET /api/reward/status`, `GET /api/referral/*` | status/referral — Telegram initData | чтение | ✓ |
| `POST /api/reward/claim` | Telegram initData + rate limit 30/мин/IP + in-flight lock + привязка TG↔кошелёк 1:1 + серверная on-chain верификация квеста + daily cap 500 🥔 + per-claim 200 🥔 | `grant_reward` (эпок-кап) | ✓ единственный write-эндпоинт, защищён; **но** подписывает полный authority-ключ (B4) |
| `POST /api/referral/register` | Telegram initData | без on-chain записи (БД) | ⚠ I9 (сибил) |
| **Admin-эндпоинтов нет** (никакой HTTP-маршрут не вызывает `withdraw_treasury`/`set_paused`/`update_config`/`accept_authority`) | — | — | ✓ риск — только в самом ключе |

### 4.3 PDA как authority: где правильно / неправильно

- **Правильно (все с `seeds`+`bump`, bump хранится в аккаунте и проверяется):** `config` (mint authority + казна), `escrow` (сам себе authority), `quest_treasury` (квест-пул), `epoch`/`field`/`order`/`market_stats`/`seller`/`buyer_presale`/`license`/`referral`/`achv` (state).
- **Осознанно не-PDA:** `buyback_skr_ata` — ATA обычного кошелька authority (ручной buyback, L7).
- **Нашёл и зафиксировал:** `treasury_sol` как 0-байтовый System-аккаунт — «правильный» приём денег, но без инструкций-выхода (I6).
- Подмена PDA-аккаунтов через `remaining_accounts` (`fill_order`) — риск отсутствует (разбор в N10).

## 5. TODO / моки / хардкод / незакрытые проверки / обработка ошибок

**TODO (1 шт.):** `ReferralSection.tsx` — bot username (I12).

**Placeholder-значения:** `landing/content.ts` (`sold: 47`, старый id) — I11; `VITE_BOT_USERNAME` — I12; `CORS_ORIGIN`/`TELEGRAM_CHANNEL_ID` с «молчаливыми» дефолтами — I7/I8.

**Хардкод (осознанный, зеркало программы):** `apps/web/src/utils/constants.ts` — зеркало констант `lib.rs` с unit-тестом `tests/constants.test.ts` (ок); `TEST_SKR_MINT` — I2/N3; `DEFAULT_PROGRAM_ID` в `SolanaContext.tsx` — B1 (убрать).

**Отключённые/неполные проверки:** `social_channel` (I7); startup authority-check — warn-only (I14); `isChannelMember` false-negative (I13).

**Места без обработки ошибок / деградация:**
- Frontend: единый `ErrorBoundary` + `describeError` (RU) + backoff ×2…×8 + экран «нет связи»; `catch`-и в `GameContext` осознанные (backend offline → квесты просто не отмечаются; tier-чтение дропа — «показываем без тира»). **Дырок не найдено.**
- Backend: глобальный error handler 500, rate limit, in-flight lock. **Дыры:** рост Map rate-limiter (I5), молчаливые cron-сбои (I4/I10), false-negative Telegram API (I13).
- Целостность данных: JSON-store без WAL/атомарности между инстансами (I5); `persist()` — write-tmp+rename (атомарно для одного файла, ок).

## 6. Верификация (что проверено, а что нет)

| Проверка | Результат |
|---|---|
| `cargo test -p solana_potato --lib` | 13 passed (на момент 13.09; после d8affe1 — не перегоняли: rust в песочнице недоступен, CI выключен — **перепустить после B2**) |
| `anchor test` (33 сценария) | 28 passing (13.09); покрывает: initialize (включая double-init и чужой mint), grant_reward (лимиты, unauthorized), fields (все траты, чужой owner, чужой mint, prepay-лимиты, harvest+износ), marketplace (мин. ордер, self-trade, escrow-цикл, cooldown, expired), referrals (burn, self-ref, 0.5 % из escrow, burn-ветка), admin (roll до 24 ч, pause, update_config ceilings, withdraw_treasury только authority, two-step transfer) |
| **Не покрыто тестами** | presale (обе рельсы, ролл, лимиты), claim_achievement, buy_export_license (новый флоу!), init_presale/update_presale_price, migrate_* (I1/N5) |
| Devnet-интеграция | live: DUUBi… — initialize/эпоха/пресейл/казны ✅; квест-пул 550 🥔 — **ожидает** последнего прогона `warm-start-devnet.sh` (ATA-фикс f5d023d + license-флоу d8affe1) |
| Не проверялось | Telegram-флоу на реальных кошельках (нет задеплоенного бэкенда/бота), нагрузка >100 игроков, поведение roll_epoch в живом 24-ч цикле, double-spend/parallel-claim под нагрузкой (покоде — защищено in-flight+идемпотентностью, но реальный сценарий не гонялся) |

## 7. Карта на Этап 2 (что закрывать и в каком порядке)

1. **B1** — единый коммит с новым program id во всех production-файлах + fail-fast без fallback (полчаса).
2. **I1** — тесты presale / quest / license / presale-admin (критерии — в MASTER-PROMPT-PRODUCTION.md).
3. **B2** — включить CI и прогнать (условие для всего остального).
4. **I6** — `close_treasury_sol` + `withdraw_skr_treasury` (маленькая v2-инструкция, до mainnet обязательна).
5. **I3, I7, I12, I14** — точечные program/backend-фиксы.
6. **B3/B4, I2, I4, I5, I9, I10, B5** — операционный блок (мультисиг, RPC, деплой бэкенда, мониторинг, решение по SKR и сибилу).
