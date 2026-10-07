# ARES-1 → Games Watchtower: handoff для read-only подключения

**Дата отчёта:** 2026-10-06
**Репозиторий:** https://github.com/Leo88q/ares1.git
**Проверенный commit:** `338033327e088062b8a222ce5f3ac0953662f3c7` (ветка `arena/68cc8c3f-ares1`, база `main`)
**Метод:** только чтение. Ни деплоев, ни транзакций, ни минтов, ни записей в игру и в хаб не выполнялось.
Секретов, реальных игровых записей и production-статусов без доказательств в отчёте нет.

Machine-readable части:

* `watchtower/events/event-catalog.json` — 31 реальное событие: эмиттер, поля, identity, asset/units, статус, доказательства, а также список того, что игра **не** эмитит.
* `watchtower/events/runtime-evidence.json` — read-only факты devnet от 2026-10-06 (аккаунт программы, минты, PDA, декодированные события).
* `watchtower/events/fixtures/real-devnet/` — 4 реальные финализированные devnet-транзакции (3 типа событий), с явной пометкой происхождения.
* `watchtower/events/fixtures/synthetic/` — синтетика: Borsh-payload'ы всех 31 события и примеры формы ingest-сообщений.

---

## A. Краткий статус

| Поле | Значение |
| --- | --- |
| Игра | ARES-1 (Solana Potato) |
| Канонический `gameId` | `ares1` — совпадает с манифестом и адаптером хаба |
| Проверенный commit | `338033327e088062b8a222ce5f3ac0953662f3c7` |
| Окружения | `localnet` (anchor-тесты в CI) · `devnet` (бета; программа и POTATO-минт подтверждены чтением) · `mainnet-beta` — **не запущен**, gate не пройден |
| Общий статус | Данные для read-only интеграции собраны; **интеграция не подключена**. Manifest остаётся `deploymentVerified=false`, `lastVerifiedAt=null`: сертифицированный devnet-smoke exporter'а и центральный handshake не выполнялись |
| Готовность данных | 31 on-chain событие с IDL и эмиттерами; 3 типа событий подтверждены реальными devnet-транзакциями; off-chain emitter'ов в игре нет |

**Три главных блокера**

1. **Имена событий в адаптере хаба почти не существуют на цепи.** Из списка `ares1` (`PlayerJoined`, `PotatoPlanted`, `PotatoHarvested`, `RewardGranted`, `TokenMinted`, `TokenBurned`, `TreasuryChanged`) реально эмитится только `RewardGranted`. Реальные события — `Harvested`, `BatchHarvested`, `FieldCreated`, `PresalePurchase`, `AchievementClaimed` и т. д. Нужно согласованное обновление allowlist/mapping на стороне хаба; ARES-1 не переименовывает on-chain события без согласованного апгрейда программы.
2. **Нет client-telemetry и сессий.** `WalletConnected`, `SessionStarted/Ended`, `RetentionDay1/7`, `CrossGameEntry`, `PackPurchased`, `PaymentSettled` в игре отсутствуют (проверено grep'ом по программе, backend'у и клиенту). Хаб-проекции `playerKey`/funnel/retention на этих данных построить нельзя.
3. **Off-chain факты есть, события — нет.** Реальные покупки Phase 1 и выдачи живут в PostgreSQL backend'а (`game_ops.presale_orders`, `reward_intents`), но push/export-пути в хаб не существует, а контракт `offchainIdentity()` хаба требует `eventId`/`sessionId`/`seq`/`campaignId`/`pageId`, которых у ARES-1 нет. Плюс не выполнен сертифицированный devnet-smoke (`verify-devnet --capture-fixture`).

---

## B. Паспорт и deployment

### B.1. Окружения

| Среда | Сеть/cluster | Статус | Доказательство | Дата проверки |
| --- | --- | --- | --- | --- |
| Localnet | `Localnet` (`Anchor.toml`) | используется для `anchor test` в CI | `game/Anchor.toml` (`[provider] cluster = "Localnet"`), CI job «Anchor build + unit + integration» | 2026-09-29 (CI #36561243186, зелёный) |
| Devnet | `devnet` | бета-клиент + задеплоенная программа | public explorer (ниже), `README.md` | **2026-10-06** (чтение аккаунтов), транзакции 2026-09-30 |
| Mainnet-beta | `mainnet` | **не запущен** | `game/docs/MAINNET_LAUNCH_GATE.md` — «mainnet не запущен, gate не пройден»; `reports/ares1-audit.md` — «audit gate — NOT PASSED» | 2026-09-29 |

Клиентская часть (Cloudflare Pages: лендинг `ares1-7e1.pages.dev`, игра `ares1-play.pages.dev`) —
это хостинг UI, **не** доказательство состояния программы. Из песочницы прямой egress к
`ares1-play.pages.dev` и к Solana RPC закрыт (см. §G), поэтому hosting-статус не перепроверялся.

### B.2. Программа

| Поле | Значение | Статус | Доказательство |
| --- | --- | --- | --- |
| Program ID | `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf` | `verified_runtime` (аккаунт программы) | Explore: executable=Yes, upgradeable=Yes, owner BPF Upgradeable Loader, last deployed slot 507112076 |
| Program data account | `CrTBMUR4wyMDT2SZotSrtDAZoWwQC5U9cpvZp4z7pY5Y` | `verified_runtime` | тот же explorer-аккаунт программы |
| Последний деплой | slot `507112076`, 2026-10-03 20:03:14 UTC (in-place upgrade: buffer `FVt7jrMH…`, +42 200 байт к 757 245) | `verified_runtime` | tx [`4LXiVvZW…`](https://explorer.solana.com/tx/4LXiVvZWQxq2gjfqkXub5DSSwfp4t427HS1GbQ5Em9EaJgeLfKZfY6zhkD4tidTeFir2Q4rA7P3FQwfAaC8BNM3w?cluster=devnet) |
| Deployed binary provenance | Verified build = **No**; соответствие задеплоенного бинаря коммиту не подтверждено | `unavailable` | explorer: «Program Not Verified»; committed IDL проверен только на 3 типах событий |
| Upgrade authority | единственный кошелёк (не мультисиг) | `verified_runtime`, адрес намеренно не переносится в отчёт | explorer-аккаунт программы; в манифесте `upgradeAuthorityMultisig: null` |
| Program ID в репозитории | `declare_id!` в `game/programs/solana_potato/src/lib.rs:50`, три записи в `game/Anchor.toml` | `code_only` (декларация) | `watchtower/tests/address-registry.test.mjs` сверяет Rust ↔ Anchor.toml ↔ IDL ↔ manifest |

### B.3. IDL / схема

| Поле | Значение |
| --- | --- |
| IDL | `game/apps/web/src/idl.json`, sha256 `2f03931ee9cf4c92b4d95febf67157f741bc022189b3b1187cef4006467f4587` |
| Артефакт exporter'а | `watchtower/events/ares1-idl.json` (events + layouts + instruction discriminators), `sourceIdlSha256` совпадает с источником |
| Состав ABI | 44 инструкции / 13 аккаунтов / **31 событие** / 51 ошибка |
| Anchor / toolchain | anchor 0.31.2, solana 4.2.2 (`game/Anchor.toml`, `game/rust-toolchain.toml`) |
| Версия IDL | `0.2.0`; `parserVersion` exporter'а — `ares1-v1` (Unknown — `ares1-raw-v1`) |
| Синхронизация | `watchtower/scripts/sync-idl.mjs` падает, если `events/ares1-event-map.json` расходится с IDL; CI гоняет этот гейт |
| Deployed IDL | **не подтверждён**: explorers показывают инструкции как «Unknown» (у них нет нашего IDL); совпадение layout'ов проверено только на 3 событиях (см. D.2) |

### B.4. Активы, казна, PDA

| Тип | Адрес | Роль | Статус | Источник |
| --- | --- | --- | --- | --- |
| SPL mint | `HFEL9rBqmYwYDsZNxuV2ZonfS7adbjENUc3CdgbaiYxv` | POTATO, decimals **6**; mint authority = config PDA (`9FDhkBw…`), т.е. минт управляется программой | `verified_runtime` | [explorer mint](https://explorer.solana.com/address/HFEL9rBqmYwYDsZNxuV2ZonfS7adbjENUc3CdgbaiYxv?cluster=devnet): supply на 2026-10-06 — 434.280849, mint authority = config PDA |
| SPL mint | `Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o` | SKR, decimals 6; пиновая константа `SKR_MINT` (`lib.rs:159`) | `verified_runtime` | tx `4RjYypni…`: перевод ровно 500.000000 SKR при покупке лицензии |
| PDA | `9FDhkBwmcNx3gh8hSgShpiAVXHW9cZBnv4t1xyHGU39q` | `["config"]`: конфиг игры, mint authority POTATO | `verified_runtime` | аккаунт #1 в реальных tx `ClaimAchievement`; совпал с выводом из seeds |
| PDA | `9bGsUX3u2imMyLgu7ottPSxzXs1rSUGJfX9J9r3WJ5s2` | `["quest_treasury"]`: казна квестов, владелец ATA с POTATO | `verified_runtime` | authority token-перевода в реальных tx `ClaimAchievement` |
| PDA | `2RVYyVzR6tzLXiLsGYrEGSvU8Mj5nQiS7Q3e8MXFa1ao` | `["treasury_sol"]` | `code_only` (выведен из seeds, в наблюдавшихся tx не встречался) | `lib.rs`, seeds |
| PDA | `8UC7Yw8T3R8JRCpNn2C7uPRf9n7XiwGUyn7G2UVUEqbg` | `["market_stats"]` | `code_only` | `lib.rs` |
| PDA | `ADraxnQtgMWUAAn46K5oNf6nRRGrUMS2SxyRmfbCZCfk` | `["admin_state"]` | `code_only` | `lib.rs` |
| PDA | `4NwdeEHuDPfh2oFZ6Bq5SbRxCfxRo7dh9SqhhMAqxs7o` | `["presale"]` | `code_only` | `lib.rs` |
| Treasury / vault balances | — | — | `unavailable`: balances/PDA-инвентарь без RPC не читались, а explorer-снапшот — не измерение инвентаря | — |
| Mints на mainnet | — | — | `not_applicable`: mainnet не запущен | — |

Обновление манифеста: `watchtower/integration-manifest.json` и `watchtower/address-registry.json` теперь
несут POTATO-минт и два подтверждённых PDA; `deploymentVerified`/`lastVerifiedAt` **намеренно** оставлены
`false`/`null`, потому что сертифицированный smoke и центральный handshake не выполнены (эти значения
закреплены тестами `watchtower-readonly.test.ts`, `watchtower-verification.test.ts`).

Отдельно: `WATCHTOWER_INTEGRATION.md` — сгенерированная поверхность OS-реестра
(`watchtower/src/os/stack-v3.js`); его строка `address_provenance = repository_only_not_network_verified`
относится к v3-сплиту (`CgInv…`, `SessKeys…`, `STrEaSuRy…`, `ARES1_CORE_PROGRAM_ID`), адреса которых
по-прежнему не скоммичены и не проверялись.

### B.5. Что производит события

* **On-chain producer:** программа `solana_potato` (Anchor). Событийный индексер внутри игры отсутствует.
* **Backend (`game/apps/backend`)** — Express API: единственная write-операция — permissionless `roll_epoch`,
  подписываемая отдельным low-priv payer'ом; event'ов в хаб backend не отправляет.
* **Exporter (`watchtower/`)** — отдельный read-only процесс: читает RPC и складывает в собственную PostgreSQL;
  не имеет signing-кода и работает без signer/admin-доступа. Именно его данные хаб может читать.
* **Клиент** — не отправляет телеметрию (аналитических вызовов нет).

---

## C. Источники событий

### C.1. On-chain (единственный реальный источник событий)

| Параметр | Значение |
| --- | --- |
| Источник | программа `DUUBi…`, Anchor-события в program logs (CPI-фреймы учитываются, чужие программы отбрасываются) |
| Как читаются | exporter: `getSignaturesForAddress` (newest→oldest) + `getTransaction(finalized)`; декод по discriminator'ам из `events/ares1-idl.json`; inner instructions учитываются; лог атрибутируется стеку invocation'ов |
| Версия парсера | `ares1-v1` (Unknown — `ares1-raw-v1`) |
| Финализация | **finalized-only**: `processed`/`confirmed` отклоняются 400; `blockTime` и `slot` — из транзакции; в событиях есть отдельные игровые timestamp'ы (`paid_until`, `active_until`, `expires_at`, `start_time`) |
| Порядок | устойчивый локальный ingestion id (не хронология slot'ов) |
| Failed/caught-CPI | сохраняются с `applied=false` и не попадают в daily-проекции |
| Неизвестные layout'ы | не отбрасываются: `eventType="Unknown"`, `dataQuality=partial`, сырой payload в `data.rawBase64` |
| Independence | hаб **должен** либо читать exporter, либо поднимать собственный индексатор; ARES-1 не гарантирует полноту провайдера (`provider_available_only`) |

### C.2. Off-chain (реальные факты есть, событий нет)

| Источник | Реальные факты | Идентификаторы | Статус |
| --- | --- | --- | --- |
| Backend presale API + `game_ops.presale_orders` (`game/migrations/game_ops/0004_presale.sql`) | жизненный цикл заказа: `reserved → payment_seen → paid → delivered / refunded / expired / cancelled`, timestamps, `tx_signature`, `paid_slot`, `intent_id` | `run_id`, `order_no`, `payer_wallet`, `tx_signature`; **нет** `eventId`, `sessionId`, `seq`, `campaignId`, `pageId` | `unavailable` для хаба: нет emitter'а и нет контракта identity |
| `game_ops.reward_intents` / `reward_ledger` (`0001_schema.sql:28-84`) | намерения выдачи reward'ов (UNIQUE `recipient_ata, nonce`), append-only зеркало финализированных on-chain reward-событий (`signature`, `slot`, `block_time`) | `recipient_ata`, `nonce`, `signature`, `slot` | `unavailable`: внутренние ops-данные, отдельная privacy-основа не согласована |
| `game_ops.admin_audit` | аудит административных действий | actor, subject | `unavailable`: может содержать IP/actor — не для экспорта |
| Клиент | connect/disconnect кошелька происходит локально; телеметрии нет | — | `not_applicable` |

**Push/pull.** Сторона игры ничего не пушит в хаб. Доступный путь — pull: хаб читает
read-only HTTP exporter'а (`GET /watchtower/*`, Bearer) либо поднимает собственный
индексатор. Данные за пределы игры уходят только по согласованному контракту
(`POST /api/ingest/solana` или pull), с секретом вне Git/чата.

**Retention источника.** Глубина истории = то, что доступно выбранному RPC-провайдеру
(`provider_available_only`); собственного архива у игры нет. Inbox хаба — оперативная
in-memory ёмкость (≤250 000 событий), это **не** архив: replay/backfill должны
оставаться на стороне игры/провайдера.

---

## D. Event map

Полная карта — `watchtower/events/event-catalog.json`; ниже сводка. `verificationStatus`
не смешивается с `dataQuality`.

### D.1. Реально существующие события (31) и предлагаемый mapping

| `sourceEventName` | Предлагаемый `watchtowerEventType` | Emitter (инструкция) | Identity | Asset | Runtime-статус |
| --- | --- | --- | --- | --- | --- |
| `EpochRolled` | `EpochRolled` | `roll_epoch` | — | — | `code_only` |
| `FieldCreated` | `AssetCreated` | `create_field`, `buy_field_skr`, `buy_field_sol` | `owner` | POTATO (burn при create) | `code_only` |
| `PresalePurchase` | `PurchaseCompleted` | `buy_field_skr` / `buy_field_sol` | `buyer` | SKR atoms / lamports (из инструкции!) | `code_only` |
| `Harvested` | `CropHarvested` | `harvest` | `owner` | POTATO | `code_only` |
| `TreasuryTaxed` | `TreasuryDeposited` | `harvest` | field+treasury | POTATO | `code_only` |
| `FieldRepaired` / `FieldUpgraded` / `TaxPaid` / `FertilizerApplied` | одноимённые (`TaxPaid`, `FieldUpgraded`, …) | `repair_field`, `upgrade_field`, `pay_tax`, `apply_fertilizer` | field PDA (owner в payload нет) | POTATO | `FieldUpgraded` — **`verified_runtime`**; остальные `code_only` |
| `ExportLicensePurchased` | `PurchaseCompleted` | `buy_export_license` | `owner` | SKR (500 000 000 atoms) | **`verified_runtime`** |
| `OrderCreated` | `OrderCreated` | `create_sell_order` | `seller` | POTATO/SOL | `code_only` |
| `OrderFilled` | `OrderFilled` | `fill_order` | `buyer` | POTATO + SOL | `code_only` |
| `OrderCancelled` | `OrderCancelled` | `cancel_order` | `seller` | — | `code_only` |
| `OrderExpiredEvent` | `OrderExpired` | `close_expired_order` | — | — | `code_only` |
| `RewardGranted` | `RewardGranted` | `grant_reward` | `recipient` | POTATO | `code_only` (имя есть в allowlist хаба) |
| `RewardGrantedOnce` | `RewardGrantedOnce` | `grant_reward_once` | `recipient` | POTATO | `code_only` (replay-safe rail, nonce) |
| `ReferralRewardPaid` | `ReferralRewardPaid` | `fill_order` | buyer+referrer | POTATO | `code_only` |
| `ReferrerRegistered` | `ReferrerRegistered` | `register_referrer` | `owner` | POTATO (burn 5) | `code_only` |
| `AchievementClaimed` | `null` (нет согласованного mapping; exporter → `RewardClaimed`) | `claim_achievement` | `user` | POTATO из quest treasury | **`verified_runtime`** |
| `BatchHarvested` | `BatchCropHarvested` | `batch_harvest` | `owner` | POTATO | `code_only` |
| `FieldClosed` | `FieldClosed` | `close_field` | `owner` | — | `code_only` |
| `TreasuryWithdrawn` / `TreasurySolWithdrawn` / `TreasurySkrWithdrawn` | `TreasuryWithdrawn` | `withdraw_treasury`, `withdraw_treasury_sol`, `withdraw_skr_treasury` | `destination` | POTATO / SOL / SKR | `code_only` |
| `PresaleAuthorityMigrated`, `AuthorityAccepted`, `RewardSignerUpdated` | `AuthorityChanged` | `migrate_presale_authority`, `accept_authority`, `update_reward_signer` | — | — | `code_only` |
| `AuthorityProposed` | `AuthorityProposed` | `propose_authority` | — | — | `code_only` |
| `PausedToggled` | `PausedToggled` | `set_paused` | — | — | `code_only` |
| `ConfigUpdated` | `ConfigUpdated` | `update_config` | — | — | `code_only` |
| `SkrMintUpdated` | `ConfigUpdated` | `apply_pending_skr_mint` | — | SKR | `code_only` |

Все 31 имя реально присутствуют в `lib.rs` как `#[event]` и испускаются через `emit!`
(34 site'а). Emitter-привязка проверена скриптом по исходникам; у `OrderFilled`/`ReferralRewardPaid`
владелец — `fill_order`, у `BatchHarvested` — `batch_harvest`.

### D.2. Подтверждено реальным devnet

Декодировано против committed IDL (sha256 `7ae6844b…`), payload'ы сходятся байт-в-байт по длине:

| Событие | Tx | Slot / время | Payload |
| --- | --- | --- | --- |
| `FieldUpgraded` | `3rNqeHwz…` | 505995704 · 2026-09-30 18:27:59 UTC | `field=7oLddc…`, `new_level=2`, `cost_micro=40000000` |
| `AchievementClaimed` | `5PVnUNjs…` | 505985253 · 17:47:07 UTC | `user=HPMr5r…`, `quest_id=1`, `reward=50000000` (+ перевод 50.000000 POTATO) |
| `AchievementClaimed` | `4pUB58DR…` | 505985220 · 17:46:59 UTC | `user=HPMr5r…`, `quest_id=3`, `reward=100000000` (+ перевод 100.000000 POTATO) |
| `ExportLicensePurchased` | `4RjYypni…` | 505983829 · 17:41:33 UTC | `owner=HPMr5r…`, `expires_at=1794616485`, `cost_skr_atoms=500000000` (+ перевод 500.000000 SKR) |

Координаты: `cluster=devnet`, `commitment=finalized`, `instructionIndex` = 2 или 3 (Compute Budget
инструкции перед игровой), `innerIndex=-1`. Fixtures: `watchtower/events/fixtures/real-devnet/*.json`.

### D.3. Что игра **не** эмитит (не выдумывать)

| Имя (адаптер/хаб) | Статус | Причина / ближайшее реальное событие |
| --- | --- | --- |
| `PlayerJoined` | `unavailable` | нет ни on-chain, ни off-chain join-события |
| `PotatoPlanted` | `unavailable` | посадки нет; поле создаётся (`FieldCreated`) |
| `PotatoHarvested` | `unavailable` | реальные имена — `Harvested`, `BatchHarvested` |
| `TokenMinted` | `unavailable` | минт внутри `harvest`/`batch_harvest`/`grant_reward`; отдельного события нет |
| `TokenBurned` | `unavailable` | burn'ы — внутренние CPI без события |
| `TreasuryChanged` | `unavailable` | движения казны itemized: `TreasuryTaxed` / `TreasuryWithdrawn*` / `ConfigUpdated` |
| `WalletConnected`, `SessionStarted/Ended` | `unavailable` | нет телеметрии и нет `sessionId` |
| `PackPurchased`, `PaymentSettled` | `unavailable` | off-chain предоплата живёт в БД backend'а, emitter'а нет |
| `RetentionDay1`, `RetentionDay7` | `unavailable` | retention нигде не считается; искусственные события не создавались |
| `CrossGameEntry` | `unavailable` | кросс-гейм механики/моста/identity-сервиса нет; в i18n есть только лор-строка про будущий burn-мост |
| `PurchaseCompleted` (generic) | `partial` | реально только `PresalePurchase` и `ExportLicensePurchased` |

### D.4. Семантика и точность (важное)

* Все события — «success only»: в payload нет отклонённых попыток; failed/caught-CPI сохраняются exporter'ом отдельно с `applied=false`.
* `PresalePurchase.amount` **не содержит валюту**: `buy_field_skr` → SKR atoms, `buy_field_sol` → lamports; неизвестная инструкция → `resource=null`, без догадок.
* `AchievementClaimed` — не минт, а перевод уже существующих токенов из quest treasury (quest_id 0–5, `QUEST_REWARD_MICRO`).
* `RewardGranted` (legacy, signature-only) и `RewardGrantedOnce` (nonce + PDA) — разные рельсы; вторая replay-safe.
* Неизвестные типы не получают бизнес-смысла: `raw/unmapped`, `Unknown`, `dataQuality=partial`.
* Исходное имя события сохраняется (`onChainEvent`), нормализованное — отдельное поле (`eventType`); переименований в программе нет.

---

## E. Replay, gaps и качество

| Аспект | Факт |
| --- | --- |
| Idempotency (on-chain) | `UNIQUE (cluster, slot, signature, instruction_index, inner_index)` в PostgreSQL exporter'а; raw-строка = одна invocation инструкции, а несколько `emit!` внутри — children по `log_index`. Один и тот же набор координат при replay не создаёт нового события |
| Idempotency (off-chain) | отсутствует: emitter'ов нет. Особенность хаба (`offchainIdentity()` = provider + `campaignId`/`pageId`/`sessionId`/`seq`) ARES-1 сегодня удовлетворить не может — этих полей нет; выдумывать их запрещено |
| Cursor / backfill | `getSignaturesForAddress` newest→oldest ограниченными страницами; каждая транзакция перечитывается `getTransaction(finalized)`; preserved `before`/head/phase/watermark → resume. Глубина — только то, что отдаёт провайдер (`provider_available_only`) |
| Finalized lag | `finalizedLag` = разница между наблюдённым finalized slot и полностью просканированным watermark (не «возраст последнего игрового события»); до catch-up = null |
| Gaps / reorg / ошибки | изменившийся finalized-fingerprint, откат watermark, отсутствующая metadata → gap и `readyz=503`; 429/5xx/timeout — до 4 попыток с backoff+jitter; курсор не двигается «ради зелёного health» |
| Replay | `WATCHTOWER_REPLAY_CONFIRM=ares1 node --env-file=.env --import tsx scripts/replay.ts` — только собственная БД, raw/normalized не удаляются, неизменные записи дедуплицируются |
| Покрытие | `coverage=provider_available_only`, `dataQuality=partial`; пустая страница RPC не доказывает genesis-coverage. `complete` не присваивается |
| Что **не** проверено | сертифицированный devnet-smoke, соответствие задеплоенного бинаря исходникам, глубина истории конкретного провайдера, поведение при реальном reorg, полнота по всем 31 типам событий |
| Тестовые vs реальные данные | синтетика — `fixtures/synthetic/*` (Borsh для всех 31 события + примеры ingest-формы); реальные — 4 devnet-tx в `fixtures/real-devnet/*` с пометкой `real_devnet_public_explorer_capture`; production-данных нет вообще |

---

## F. Privacy, economy и optional capabilities

### F.1. Идентичность и приватность

| Вопрос | Ответ |
| --- | --- |
| Поля игрока в событиях | Публичные on-chain pubkey: `owner`, `recipient`, `buyer`, `user`, `seller`, `destination`, `referrer`, `pending_authority`, `new_signer`. Примитива `payload.playerKey` игра не создаёт |
| `playerId` / `walletHash` / `owner` | `playerId` и `walletHash` отсутствуют; `owner` — публичный кошелёк |
| Стабильность | Кошелёк стабилен между сессиями; игровой «профиль» на цепи отсутствует; поля вроде `field` — PDA (не игрок) |
| Тип идентификатора | публичный Solana-адрес; не случайный псевдоним, не внутренний account ID |
| Consent / opt-out | Consent-механики для телеметрии нет; CookieConsent в клиенте — про cookies, не про игровые события |
| Retention / deletion | Политики удаления для on-chain данных не существует (цепь неизменяема). Для off-chain БД правила retention не формализованы в этом handoff |
| Cross-game связка | Технически возможна только по публичному адресу; сервиса/секрета identity у игры нет. Самостоятельно выбирать cross-game identity и присылать хеш с неизвестной солью — запрещено |
| Что нельзя передавать | Имена, email (`payer_email` существует в БД и **не** экспортируется), телефоны, токены, IP, device fingerprint, cookies, платёжные данные, содержимое чата. В fixture'ах только публичные devnet-адреса бета-кошельков |

Замечание для хаба: входное событие сначала попадает в ingest/inbox, поэтому raw wallet
можно передавать в production только после согласования поля, privacy-основания и срока
хранения с владельцем интеграции; read API хаба псевдонимизирует идентификаторы, но
inbox — нет.

### F.2. Экономика и активы

| Актив | Единицы | Источник | Замечания |
| --- | --- | --- | --- |
| POTATO | 6 decimals, поля `*_micro` (u64 → decimal string) | mint `HFEL9r…`, mint authority = config PDA | max supply 1 000 000 000 POTATO, cap эпохи 250 000/сутки; оба — константы/конфиг, не измерение |
| SOL | lamports (1 SOL = 1e9), `amount_lamports`, `total_lamports`, `price_lamports_per_potato` | нативный | рынок сеттлится в SOL |
| SKR | atoms, 6 decimals, `*_skr_atoms` | пиновая `SKR_MINT = Fotom38…` | лицензия 500 SKR; пресейл 1053 SKR (owner-confirmed), но `PresalePurchase.amount` валюту не несёт |
| Преобразование в USD | — | — | `unavailable`: реального источника цены нет; raw units нельзя выдавать за USD, decimals не конвертируются хабом (его парсер — не конвертер) по умолчанию |
| Диапазоны | u64 максимум `18446744073709551615` > `Number.MAX_SAFE_INTEGER` | — | exporter уже отдаёт u64/i64 строками; до расчётов на стороне хаба парсер должен быть расширен контрактно |
| Supply / treasury / revenue | — | — | supply на 2026-10-06 — 434.280849 POTATO (devnet-снапшот, не экономический факт); treasury balances, revenue/costs, circulating supply — `unavailable` |
| Направления потоков | mint: `harvest`/`batch_harvest`/`grant_reward*`; burn: покупка/ремонт/апгрейд/налог/удобрение и 60 % комиссии рынка; reward: квесты (перевод, не минт); treasury: `TreasuryTaxed`/`Treasury*Withdrawn`; trade: `OrderFilled`; fee: внутри `fill_order` (в payload не itemized) | `game/programs/solana_potato/src/lib.rs`, `game/docs/API.md` | roadmap/оценки экономики (`game/economy/simulate.py`) — модель, не измеренные факты |

### F.3. Location

`not_applicable`: ни в программе, ни в backend'е, ни в клиенте нет регионов, карт или
location-полей. Хаб не должен выводить географию ARES-1 (в т. ч. из IP).

### F.4. Cross-game

`unavailable`: нет программы-моста, инструкций, событий и linking-механики. В i18n есть
лишь лор-строка про будущий burn-мост в Age of Farming; ни `BridgeIn`, ни `BridgeOut`,
ни `CrossGameLinked`, ни `CrossGameAssetGranted` игрой не эмитятся. Примеры переходов не
создавались и мост не внедрялся.

### F.5. Operator Game progress (опционально)

| Поле | Статус | Комментарий |
| --- | --- | --- |
| `wallet` | `supported` (source) | публичный адрес владельца поля/получателя; в БД есть `payer_wallet` |
| `hours` | `unavailable` | игровое время нигде не измеряется: нет foreground/background/AFK-логики |
| `rank` | `partial` (code_only, не хранится) | `floor(active fields / 3) + 1`, считается в клиенте (`GameContext.tsx:203`) из on-chain полей; серверной записи нет, `updatedAt` отсутствует |
| `updatedAt` | `unavailable` | per-player прогресса в БД нет |

`POST /api/games/progress` (HMAC) — отдельный протокол; ARES-1 не симулирует часы/ранг и
не имеет готового push. Если/когда появится реальный учёт — потребуются ENV-имена вида
`WATCHTOWER_INGEST_HMAC_SECRET` **без значений** и передача секрета через согласованный
vault/secret manager.

---

## G. Проверки и блокеры

### G.1. Выполненные команды и фактические exit codes (2026-10-06, read-only)

| Команда | Результат |
| --- | --- |
| `node game/scripts/check-contract.mjs` | exit 0 — «Contract checks passed (44 instructions). Full ABI comparison requires the built IDL argument.» |
| `python3 game/economy/simulate.py --check` | exit 0 — «ECONOMY SIMULATION CHECK OK: 7 scales, tax formula, 9 pinned constants, 3 scenarios.» |
| `node watchtower/src/os/handoff-v3.js --check` | exit 0 — «handoff artifacts up to date» |
| `node --test watchtower/tests/os/watchtower-os-v3.test.mjs` | exit 0 — 15/15 |
| `node --test watchtower/tests/address-registry.test.mjs` | exit 0 — 1/1 (в т.ч. после добавления минта/PDA в manifest+registry) |
| `node --test game/scripts/security-guards.test.mjs` | exit 0 — 52/52 |
| `npm ci --ignore-scripts` (watchtower) | exit 0 — 35 пакетов, 0 уязвимостей |
| `npm run typecheck` / `npm run build` (watchtower) | exit 0 / exit 0 |
| `npm test` (watchtower) | exit 0 — 101 тест: 100 pass, 0 fail, 1 skipped (PG-интеграция без тестовой БД) |
| `npm ping` | exit 0 — PONG (registry доступен) |

**Не выполнено и почему:**

| Команда/проверка | Причина |
| --- | --- |
| `curl https://api.devnet.solana.com` (и `rpc.ankr.com`, `api.mainnet-beta.solana.com`, `ares1-play.pages.dev`) | egress песочницы закрыт: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (DNS резолвится, `github.com` отвечает 200). Прямая RPC-верификация невозможна |
| `npm run verify:devnet` / `node --import tsx scripts/verify-devnet.ts --capture-fixture` | нет разрешённого RPC, exporter URL, токена и БД; сертифицированный smoke не запускался |
| `npm run test:integration` | нет disposable PostgreSQL `watchtower_test` |
| `anchor build` / `anchor test` / `yarn workspace …` (game) | нет Rust/Anchor/JS-тулчейна и зависимостей в песочнице; в `game/tests/solana_potato.ts` нет ассершенов на события |
| Реальный RPC-инвентарь mint/treasury/PDA | заменён read-only чтением публичного explorer'а; это не заменяет smoke |

**Fixtures:** синтетика — `watchtower/events/fixtures/synthetic/` (все 31 событие + примеры ingest-формы);
реальные — `watchtower/events/fixtures/real-devnet/` (4 tx, 3 типа событий, provenance проставлен);
production-данных и mainnet-транзакций в fixtures нет.

### G.2. Блокеры и что нужно от владельца Watchtower

| # | Блокер | Точная причина | Решение/владелец |
| --- | --- | --- | --- |
| 1 | Список имён событий адаптера `ares1` не совпадает с цепью | В адаптере `PlayerJoined`/`PotatoPlanted`/`PotatoHarvested`/`TokenMinted`/`TokenBurned`/`TreasuryChanged`, на цепи — другие имена | Хаб: обновить allowlist/mapping до реальных имён (см. D.1). Программу не переименовываем без согласованного апгрейда |
| 2 | Маппинг identity | Хаб-проекции ждут `payload.playerKey`; ARES-1 отдаёт `owner/recipient/buyer/user/seller/...` | Хаб + владелец интеграции: согласовать явный маппинг и privacy-основание для raw wallet в ingest |
| 3 | Off-chain покупки/выдачи не попадают в хаб | У игры нет emitter'а и нет `eventId`/`sessionId`/`seq`/`campaignId`/`pageId`; контракт `offchainIdentity()` не выполним | Хаб: описать приемлемый контракт (какие поля и как генерировать) — ARES-1 реализует после согласования. `POST /api/ingest/trafficgen` не использовать |
| 4 | Нет сертифицированного devnet-smoke и подключения | Нет разрешённого RPC/токена/БД; `deploymentVerified=false`, `lastVerifiedAt=null` | Оператор/владелец хаба: выдать RPC-доступ, отдельный exporter credential (вне Git/чата) и провести центральный runtime smoke |
| 5 | Provenance деплоя | Verified build = No; соответствие бинаря коммиту не подтверждено; upgrade authority — один ключ | ARES-1/оператор: reproducible build и multisig-план (mainnet gate) |
| 6 | Клиентская аналитика отсутствует | Нет telemetry-коллектора, сессий, retention | Владелец продукта: отдельное решение и privacy-основание; вне текущего handoff |

### G.3. Открытые вопросы к команде Watchtower

1. Принимает ли хаб реальные имена ARES-1 (`Harvested`, `BatchHarvested`, `FieldCreated`, `AchievementClaimed`, `PresalePurchase`, …) — и в каком виде нужен mapping `sourceEventName → watchtowerEventType`?
2. Какой контракт identity применяется к ARES-1: хаб сам псевдонимизирует wallet или игре нужно отдавать `payload.playerKey`? На каком основании и с каким retention?
3. Нужен ли off-chain ingest presale-заказов, и какой минимальный набор полей (`orderKey`, `payerWallet`, `txSignature`, `state`, timestamps) допустим без PII?
4. Кто и как передаёт exporter credential и HMAC-секрет (ENV-имена, vault), и нужен ли pull exporter'ом или push в `POST /api/ingest/solana`?
5. Какой глубины backfill требуется и есть ли у хаба собственный архив/индексатор, чтобы не полагаться на `provider_available_only`?

### G.4. Границы этого handoff

Не выполнялись и не заявлены: деплой программ, транзакции, минты/берны, изменение цен и
экономики, новые endpoints exporter'а (`GET /watchtower/*` не создавались), ML/security
метрики, финансовые прогнозы, cross-game PDA, новые SDK. Секреты и реальные игровые
данные в отчёт и fixtures не включались.
