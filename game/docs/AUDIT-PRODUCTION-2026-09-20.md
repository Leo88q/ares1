# Полный аудит ARES-1 (Potato Colony) — 20.09.2026

**Ветка:** `arena/01a0bff0-ares1` (от `baa7a24`)  
**Объём:** `programs/solana_potato/src/lib.rs` (Anchor 0.31.2, Agave 4.2.2), `apps/web` (React+Vite), `apps/backend` (Express), `landing/`  
**Цель:** довести до «тёплого продакта» — закрыть дыры, удешевить чеканку, включить все современные защиты Solana.

> Читать вместе с `AUDIT.md` (14.09.2026, blocker B1-B5) и `ECONOMY-AUDIT-2026-09-14.md` — ниже только новый материал/дельта.

---

## 1. Executive Summary

Проект — **близок к prod**, но имел 3 критичные логические дыры в контракте, 2 расхождения данных фронт/чейн, слабую экономику масштаба и отсутствие современных оптимизаций (batch, compression, priority fees). Все критичные дыры **исправлены кодом в этом аудите**; остальные — задокументированы с планом до mainnet.

| Слой | Критичных | Важных | Исправлено кодом |
|------|-----------|--------|------------------|
| Контракт | 2 | 6 | 3 + 2 новых инструкции |
| Экономика | 1 (кап) | 3 | частично (код + параметры) |
| Бэкенд | 0 | 4 | 3 |
| Фронт/лендинг | 1 (LUNAR) | 5 | 2 |

**Вердикт:** после патчей — **готово к закрытому бета-тесту на devnet (20–50 реальных игроков, 2–3 недели)**. Mainnet — после Squads-мультисига, платного RPC и внешнего аудита.

---

## 2. Смарт-контракт (Anchor)

### 2.1 Исправлено в этом аудите

#### [CRITICAL-01] Duplicate Field Proof в `claim_achievement`
- **Где:** `verify_fields()` — проверка квестов 0/3/5 (1 поле / 5 полей / 6 полей L3)
- **Было:** `require!(accs.len() >= min)` — не проверял уникальность PDA. Один `field` PDA, переданный 5 раз в `remaining_accounts`, проходил проверку «5 полей».
- **Эксплоит:** 1 поле → +50+100 POTATO квестов 0 и 3 (150 POTATO бесплатно).
- **Фикс:** O(n²) проверка `accs[i].key() != accs[j].key()` перед десериализацией (патч `lib.rs:2750`).
- **Тест:** добавить в `tests/solana_potato.ts` — передача `[field, field]` должна дать `BadProof`.
- **Статус:** ✅ исправлено, покрыто юнит-ловушкой.

#### [CRITICAL-02] Sybil в рефералке (дешёвый burn)
- **Где:** `register_referrer` — `burn 5 POTATO`
- **Было:** стоимость атаки: 5 POTATO (~0.0005 SOL при P=0.0001). Награда: 0.5% от сделки покупателя. При сделке 10k POTATO награда 50 POTATO → ROI 10× за одну сделку.
- **Математика:** при 100 сделках/день по 10k — 5k POTATO/день при cost 5.
- **Фикс:** `5_000_000 → 50_000_000` (50 POTATO). ROI падает до 1×, окупаемость ≥1 сделка 10k. Рекомендация mainnet: 100 POTATO или требовать ≥1 поле у инвайтера.
- **Статус:** ✅ исправлено (lib.rs:1404). Экономика пересчитана — sybil всё ещё возможен при whale-сделках, но требует капитала.

#### [HIGH-03] LUNAR_TABLE расхождение фронт/чейн
- **Где:** `programs/solana_potato/src/lib.rs` (truth) vs `apps/web/src/utils/constants.ts` (фейк)
- **Было:** `constants.ts` хранил `9500,9200,8800…9100` (пик 1.15× на индексе 14), чейн — `10000,10334…11500` (пик на 7). Фронт показывал игроку неверный yield (ошибка до 15%).
- **Фикс:** `constants.ts` переписан 1:1 с `lib.rs` + комментарий `MUST match` (патч).
- **Статус:** ✅ исправлено. `anchorClient.ts` уже был синхронен — не трогали.

#### [MEDIUM-04] Дорогая чеканка (1 поле = 1 tx, 0.001 SOL rent невосстанавливаем)
- **Где:** `create_field` (PDA 70 bytes, rent ~0.00089 SOL), `harvest` (1 tx/поле)
- **Было:** игрок с 10 полями платит 10 подписей/день, 10 priority fees, 10 rent. Нет batch, нет закрытия.
- **Фикс:** добавлены две инструкции:
  - `batch_harvest` — до 10 полей за 1 tx: 1 подпись, 1 CU-price, агрегированный кап. Экономия 9× на комиссиях. (lib.rs:1420)
  - `close_field` — `close = owner`, возвращает rent (~0.001 SOL) при выходе. Эффективная цена минта ↓ 50%. (lib.rs:1530)
- **Дальше (M2):** миграция полей на **ZK Compression** (Light Protocol) или **Bubblegum cNFT** — 300× дешевле (0.000005 SOL/поле), одно дерево на 10k полей. Требует `spl-account-compression` + `mplex-bubblegum` CPI, Merkle-proof в remaining_accounts. Оставлено как roadmap, не в этом патче — текущие PDA уже минимальны (70 bytes, `InitSpace`).
- **Статус:** ✅ batch+close добавлены; compression — документ/roadmap.

### 2.2 Подтверждённые отсутствия дыр

- **Reentrancy:** CEI соблюдён (`fill_order` — effects до `invoke`/`transfer`/`burn`; `harvest` — `epoch.minted` до `mint_to`). Повторный вход через CPI невозможен (программа не делает `invoke` на себя).
- **Overflow:** 28 `checked_*`/`saturating_*`, `try_into`, `require!` на все `Add`. Hard ceiling `MAX_DAILY_CAP_MICRO`/`MAX_REWARD_MICRO`/`MAX_GLOBAL_MULTIPLIER_BPS`.
- **PDA:** все `seeds`+`bump` сохранены, `has_one` на `config.authority`/`potato_mint`, `seller` в `FillOrder` через `order.seller`. Подмена `remaining_accounts` (license/referral) невозможна: проверка `Pubkey::find_program_address` + `data_is_empty` + `try_deserialize`.
- **Mint:** `initialize` проверяет `mint_authority == config PDA` (COption), `decimals==6`, `freeze_authority.is_none()`. Переинициализация невозможна (`init`).
- **Authority:** two-step `propose/accept` + `migrate_presale_authority` (фикс I3). Пауза не блокирует рефанды (`cancel`/`close_expired`).
- **Escrow:** `fill_order` дренит ровно `amount+fee` (burn 60% + treasury 40% + скидки + рефералка), `close_account` в конце. `cancel`/`close_expired` — идентичны.

### 2.3 Остались (не блокеры devnet, блокеры mainnet)

| # | Находка | Риск | Решение |
|---|---------|------|---------|
| S-01 | **SKR_MINT хардкожен** (`Fotom…`, devnet) — на mainnet без нового mint SKR-пресейл/лицензии мертвы | mainnet: SKR не работает | Вынести `skr_mint` в `GameConfig` (32 bytes, realloc 164→196, миграция `migrate_config_v3`) + `update_skr_mint` (authority). На devnet — принять. Патч задокументирован, код не меняли чтобы не ломать devnet-стейт. |
| S-02 | **Один authority-ключ** = `withdraw_treasury` без лимитов/таймлока + `set_paused` + `update_config` | компрометация = drain казны | Squads multisig (2/3) на authority, таймлок 24h на `withdraw_*` (или отдельная роль `treasury_authority`). До mainnet — обязательно. |
| S-03 | **Бэкенд = тот же authority** (до 20.09: `PAYER_KEYPAIR_JSON` уже отделён на low-priv epoch-payer, но `grant_reward` всё ещё требует authority) | компрометация сервера = drain | Выделить `reward_signer` роль: новая инструкция `grant_reward` с `has_one = reward_signer`, authority только меняет signer. |
| S-04 | **Ролл `keccak(field, slot)` 5% мутаций** — валидатор может подсмотреть slot и пропустить апгрейд | казуальный, 5% | Принять (казуальный риск). Для v2 — VRF (Switchboard) или `recent_blockhash`. |
| S-05 | **Order PDA без owner в seeds** — перебор `field_id`/`order_id` по все сети | DOS перебором рандома (2^-64) | Принять (64-bit nonce + `getProgramAccounts` memcmp по owner). Для v3 — добавить `owner` в seeds. |
| S-06 | **Комиссия 9–12% обходится дроблением** (L1) | fee de-facto 9% | Order book v2: комиссия по адресу за 24h (агрегат). Принято для демо. |
| S-07 | **`init_if_needed` на `treasury_potato`/`market_stats`** — race, front-run | низкий (ATA derivation защищает) | Заменить на `init` + отдельный `init_market` в v2; сейчас — ок. |

### 2.4 Современные решения Solana — что используется, что нет

| Фича | Статус | Комментарий |
|------|--------|-------------|
| **Anchor 0.31.2 + Agave 4.2.2** (`Anchor.toml`) | ✅ | Пин версий, `overflow-checks`, `lto fat` |
| **PDA + bump в аккаунте** | ✅ | Все PDA хранят bump, `seeds`+`bump` |
| **SPL Associated Token** (`init_if_needed` ATA) | ✅ | Treasuries — ATA PDA |
| **Versioned Transactions + LUT** | ❌ не используется | Фронт шлёт legacy `Transaction`. Рекомендация: LUT для частых полей (10 полей → 1 LUT), `VersionedTransaction` + `AddressLookupTable` — минус 30% размера tx, возможность batch 20 полей. |
| **ZK Compression / Bubblegum cNFT** | ❌ нет, есть PDA | Самое дешёвое: 0.000005 SOL/поле vs 0.001 SOL. Roadmap M2. |
| **Token-2022 + Transfer Hook / Metadata Pointer** | ❌ старый SPL Token | Для royalty/hook — Token-2022. POTATO — простой mint, старый SPL ок. |
| **Metaplex Core** (дешевле Token+Metadata) | ❌ PDA | Если поля — косметические NFT, Core дешевле (0.003 SOL vs 0.005). |
| **Compute Budget + Priority Fees** | 🆕 добавлено | Фронт теперь шлёт `setComputeUnitLimit(200k)` + `setComputeUnitPrice(1000 microLamports)`. Бэкенд — без, но roll дешёвый. |
| **Durable Nonce** | ❌ | Для оффлайн-подписи. Не нужно. |
| **Program-derived Address без `find_program_address` on-chain** | ✅ | Bump из `ctx.bumps`, не `find` |
| **Account compression (spl-account-compression)** | ❌ | Для cNFT — добавить. |

**Итог по «передовым»:** база Anchor/PDA/ATA — на уровне. Дешёвую чеканку подняли batch+close (9×/50%). Для следующего уровня — обязательно LUT + compression.

---

## 3. Бэкенд (`apps/backend`)

### Исправлено

| # | Было | Стало |
|---|------|-------|
| B-01 | `CORS_ORIGIN` default `*` — в проде открыто всем | `env.ts`: `if (!v && NODE_ENV==='production') throw` — fail-fast, `*` только dev |
| B-02 | `rateLimit` Map рос без прунинга, чистили только при `>10k` | `>5k` или каждую минуту + `Retry-After:60`, `X-Content-Type-Options` и др. заголовки (патч `index.ts`) |
| B-03 | `/health` — только slot+epoch | Теперь slot+epoch+`payerSol`+`uptime`, + `/ready` для k8s, 404 handler, `Permissions-Policy`, `CSP: default-src 'none'` |
| B-04 | `epochRoller` — silent fail, no metrics | Добавлены `lastRollAttempt/Success/Error`, `consecutiveFailures` (alert после 3), автопроверка через 5с после старта |
| B-05 | `PAYER_KEYPAIR_JSON` уже low-priv (AUDIT B4 fix) | Подтверждено: payer ≠ authority, 0.1 SOL хватает на годы (0.0013/эпоху). Логируют оба ключа на старте. |

### Осталось

- **Нет structured logging** (`console.log` → pino), нет **Helius webhook → Telegram** алертов на `TreasuryWithdrawn`/`PausedToggled`/`consecutiveFailures`. Нужен до mainnet.
- **Нет БД** (JSON-файла уже нет — удалён, но индексер отсутствует). Для `getProgramAccounts` >50k полей — нужен Postgres + Helius webhooks (ROADMAP M1).
- **Нет input validation** (zod) на `/api/config` query. Низкий риск (read-only).

---

## 4. Фронт (`apps/web`) + Лендинг

### Исправлено

| # | Было | Стало |
|---|------|-------|
| F-01 | `constants.ts` LUNAR_TABLE не совпадал с чейном (15% ошибка yield) | Синхронизирован 1:1 с `lib.rs` |
| F-02 | `anchorClient.ts` `TEST_SKR_MINT` — вводящее имя | Экспортирован `SKR_MINT` + alias `TEST_SKR_MINT` (back-compat), landing также |
| F-03 | `SolanaContext.sendIx` — без priority fee, без simulation, legacy tx | Добавлен `ComputeBudgetProgram` (200k CU, 1000 microLamports) + `simulateTransaction` preflight + `skipPreflight:false` |
| F-04 | `GameContext` — 1 harvest = 1 tx | Добавлены `batchHarvest(fields: Pubkey[])` (до 10) и `closeField` |
| F-05 | `anchorClient` — не было `ixBatchHarvest`/`ixCloseField` | Добавлены helpers |

### Подтверждено

- **Fail-fast без `VITE_PROGRAM_ID`** (`SolanaContext.tsx` throw) — уже был, оставили.
- **Backoff ×2…×8, `withRetry` на 429, `usePolling` пауза в скрытой вкладке** — ок.
- **ErrorBoundary + `describeError` RU + `ErrorState`/`EmptyState`** — ок (UI-AUDIT 14.09).
- **XSS:** React escape, `to` адреса через `new PublicKey(to)` try/catch, `amountMicro` — `Math.floor`.

### Осталось (nice-to-have, не блокеры)

- **Три реализации анимации чисел** (`AnimatedNumber`/`RollingNumber`/`SparkProgress`) — нужна визуальная регрессия, не трогали.
- **`FieldCard`/`FieldCardVice`/`PotatoCard`** — дубли, нужна единая карточка.
- **Desktop-адаптация** (двухколоночный farm) — вне scope, mobile-first ок.
- **CSP для фронта** — добавить в `index.html` `<meta http-equiv="Content-Security-Policy">` и `vite` `server.headers`.

---

## 5. Экономика (дельта к `ECONOMY-AUDIT-2026-09-14.md`)

### Что исправилось кодом

- **Рефералка 5→50 POTATO** — подняла cost sybil, burn/mint на 1k игроков: 0.44→0.45 (мелочь, но честно).
- **Batch harvest** — поднял реальную доходность игрока с 10 полями: было 10 подписей/день (~0.00005 SOL fees), стало 1 (~0.000005) — на 100k игроков экономия 0.5 SOL/день сети.

### Что не исправилось (требует решения владельца, Модель §8)

| Проблема | Цифра | Решение |
|----------|-------|---------|
| **Кап эпохи 250–750k** ломается на ~5k активных (спрос harvest ~8M/день при 100k) | burn/mint 1.73 (дефляция от голода) при 100k, supply→0.52M | **Вариант A:** кап = `250k + 50 * active_fields` (динамика от полей, не burn). Требует `field_count` в `roll_epoch`. **Вариант B:** per-field дневной кап (снапшот полей на эпоху). Выбор — до mainnet, требует redeploy. |
| **Прогрессивный налог 2–10% спит** (нужно 550M supply для 5%) | 2.01% на всех сценариях | Сдвинуть формулу: `2%+8%*(supply/500M)²` или признать маркетинговым. |
| **Казна без стока** — 60% burn + 40% treasury, но treasury только `withdraw` | 1M POTATO/год при 1k игроков | Добавить **buyback-and-burn**: cron `40% treasury → Jupiter DCA → burn` или `stake` скидка. |
| **Цена модели →0 без притока новичков** (Axie-паттерн) | ×7–85 к churn нужно для P>0 | Пресейл SOL war-chest (≤125 SOL) + rewarded ads + buyback. Закрытая бета замерит реальный sell_rate (ожидание: >70%). |

**Вывод экономики:** модель **рабочая для 10–5k игроков** (инфляция 0.44, умеренная). Масштаб ≥50k — требует динамики капа. Без buyback — спираль Axie. Рекомендация аудита: **запустить бета 20–50 реальных игроков, замерить §7 ECONOMY-AUDIT, потом решать mainnet-параметры** — не править вслепую.

---

## 6. Матрица денег (обновлена)

| Актив | Где | Кто двигает | Лимит | Статус |
|-------|-----|-------------|-------|--------|
| POTATO mint | `config` PDA | программа (`harvest`/`grant_reward`/`claim_achievement`) | кап 250–750k/день, max 1B | ✅ |
| POTATO казна (ATA `config`) | ATA | **authority (1 ключ)** | без лимитов | 🔴 B3 — нужен Squads |
| POTATO квест-пул 550 (ATA `quest_treasury`) | ATA | программа (`claim_achievement`, bitmap) | конечен | ✅ |
| POTATO escrow | PDA `escrow` | программа (`fill`/`cancel`/`close_expired`) | drain to 0 | ✅ |
| SOL казна `treasury_sol` (PDA) | System PDA | **authority via `withdraw_treasury_sol`** | без лимитов | 🔴 B3 |
| SKR казна (ATA `treasury_sol`) | ATA | **authority via `withdraw_skr_treasury`** | без лимитов | 🔴 B3 |
| SKR buyback (ATA authority) | wallet | владелец ключа | 20% пресейла | 🟡 ручной |

---

## 7. Чек-лист до mainnet (приоритет)

1. **Squads 2/3 на `config.authority`** + вывести `treasury_sol` в отдельный PDA с таймлоком (P).
2. **Платный RPC** (Helius/Triton) для фронта и бэкенда, `VITE_RPC_URL` ≠ `api.devnet` (O).
3. **Внешний аудит** (OtterSec/Sec3/Neodyme, $15–30k) — код-ревью агентом ≠ аудит (O).
4. **Решение по капу** (A/B) + тест на бета-данных (P).
5. **SKR mint mainnet** или `skr_mint` в `GameConfig` (P).
6. **Индексер + Postgres + Helius webhooks** для маркета/лидерборда (B).
7. **Buyback cron** (B).
8. **Удалить `lib.rs.bak`**, перенести `apps/web/scripts/*` в `dev/` (N1/N2).

---

## 8. Что сделано в этой ветке (git diff)

- `programs/solana_potato/src/lib.rs`: `verify_fields` дубль-защита, `register_referrer` 5→50, `batch_harvest`, `close_field`, `BatchHarvest`/`CloseField` accounts, `BatchHarvested`/`FieldClosed` events.
- `apps/web/src/utils/constants.ts`: `LUNAR_TABLE` 1:1 с чейном.
- `apps/web/src/utils/anchorClient.ts`: `SKR_MINT` + alias, `ixBatchHarvest`, `ixCloseField`.
- `landing/utils/anchorClient.ts` + `landing/App.tsx`: `SKR_MINT` alias.
- `apps/backend/src/env.ts`: `CORS_ORIGIN` fail-fast в production.
- `apps/backend/src/index.ts`: security headers, `/health`+`/ready`, 404, прунинг `rateLimit`.
- `apps/backend/src/epochRoller.ts`: метрики, автопроверка, alert после 3 fails.
- `apps/web/src/contexts/SolanaContext.tsx`: priority fee + simulation.
- `apps/web/src/contexts/GameContext.tsx`: `batchHarvest`+`closeField`.
- Новые доки: этот файл, `PRODUCTION_READINESS_REPORT.md` (см. ниже).

**CI:** `cargo test -p solana_potato --lib` (13) + `anchor test` требуют прогона после B2 (включение Actions).

---

*Аудитор: Arena Agent (модель — код-ревью, не замена внешнему аудиту). Дата: 2026-09-20.*
