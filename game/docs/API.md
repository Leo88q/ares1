# API Reference

## On-chain program `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`

Anchor 0.30.1 · IDL: `target/idl/solana_potato.json` (копия для клиента — `apps/web/src/idl.json`). Все суммы `*_micro` — в 10⁻⁶ 🥔.

### PDA

| Аккаунт | Seeds | Размер | Назначение |
|---|---|---|---|
| `GameConfig` | `["config"]` | 156 | Синглтон, mint authority $POTATO, параметры эмиссии |
| `Epoch` | `["epoch", u64 le epoch_id]` | 41 | Окно эмиссии на 24 ч |
| `Field` | `["field", u64 le field_id]` | 69 | Поле игрока (`field_id` — клиентский nonce) |
| `MarketOrder` | `["order", u64 le order_id]` | 83 | Ордер на продажу, закрывается при исполнении/отмене/истечении |
| escrow (TokenAccount) | `["escrow", order_pubkey]` | 165 | Хранит amount + fee ордера |
| `MarketStats` | `["market_stats"]` | 49 | Счётчики рынка |
| `SellerProfile` | `["seller", seller_pubkey]` | 49 | Кулдаун после отмены |
| `Referral` | `["referral", owner_pubkey]` | 49 | Одноразовая привязка «кто пригласил» (register_referrer) |
| `Achievements` | `["achv", user_pubkey]` | 25 | Bitmap выданных квест-наград (claim_achievement) |
| `quest_treasury` | `["quest_treasury"]` | — | PDA-казна пула квестов (550 🥔, заправлена init-onchain) |
| treasury ATA | ATA(`config`, `potato_mint`) | 165 | 40 % комиссий рынка |

### Инструкции

| Инструкция | Кто | Аргументы | Эффект |
|---|---|---|---|
| `initialize` | любой (становится authority) | — | Создаёт `GameConfig`; требует mint с authority = config PDA, 6 decimals, без freeze |
| `init_epoch` | authority | — | Создаёт эпоху `config.epoch_id` (только bootstrap) |
| `roll_epoch` | **любой** | — | Если прошло 24 ч — создаёт следующую эпоху, `epoch_id += 1` |
| `create_field` | игрок | `field_id: u64, field_type: u8` | Сжигает 100/250/500 🥔, создаёт поле, налог оплачен на 7 дней |
| `harvest` | владелец поля | — | Минтит накопленный урожай (≥ 60 с с прошлого сбора, ≤ 48 ч накопления), с учётом капа эпохи и max supply |
| `repair_field` | владелец | — | Сжигает 6/15/30 🥔, прочность → 100 |
| `upgrade_field` | владелец | — | Сжигает 100·L × type_cost, уровень +1 (≤ 50) |
| `pay_tax` | владелец | — | Сжигает 2.4/6/12 🥔, +7 дней налога (≤ 28 дней вперёд) |
| `apply_fertilizer` | владелец | — | Сжигает 4/10/20 🥔, +24 ч ×1.5 (≤ 7 дней вперёд) |
| `create_sell_order` | продавец | `order_id: u64, amount_micro: u64, price_lamports_per_potato: u64` | Переводит amount + fee в escrow; ≥ 0.1 🥔, итог ≥ 10 000 lamports, кулдаун 3 ч после отмены |
| `fill_order` | покупатель ≠ продавец | — | SOL → продавцу, 🥔 → покупателю, 60 % fee burn / 40 % treasury, escrow и ордер закрываются |
| `cancel_order` | продавец | — | Возврат amount + fee, `last_cancel_at = now`; работает и на паузе |
| `close_expired_order` | **любой** | — | После `expires_at`: возврат продавцу, ордер закрыт |
| `claim_achievement` | игрок | `quest_id: u8` (0–5) | Проверка прогресса в программе (поля/balance через remaining-аккаунты), одноразово (bitmap); выплата из квест-казны: 50/50/100/100/200/50 🥔 |
| `register_referrer` | игрок | `referrer: Pubkey` | Создаёт PDA Referral (одноразово, burn 5 🥔). Далее: приглашённому −1 % комиссии, рефереру +0.5 % от суммы его сделок (до burn-доли) |
| `grant_reward` | authority | `amount_micro ≤ 1 000 🥔` | Минт в счёт капа эпохи (используется init-onchain для заправки квест-казны; backend-кран наград удалён 14.09.2026) |
| `withdraw_treasury` | authority | `amount_micro` | Перевод из treasury ATA в любой 🥔-аккаунт |
| `set_paused` | authority | `paused: bool` | Блокирует минт и траты; возвраты работают |
| `update_config` | authority | `daily_mint_cap? ≤ 250k`, `base_yield?`, `global_multiplier_bps? ≤ 20 000` | Кап применяется со следующей эпохи |
| `propose_authority` / `accept_authority` | authority / новый ключ | `new_authority` | Двухшаговая передача управления |

Порядок аккаунтов в каждой инструкции = порядку полей в `#[derive(Accounts)]` = IDL. Raw-клиенты (`apps/web/src/utils/anchorClient.ts`, `apps/backend/src/solana.ts`) передают ключи позиционно — при изменении структур обновляйте оба.

### События

`FieldCreated`, `Harvested`, `FieldRepaired`, `FieldUpgraded`, `TaxPaid`, `FertilizerApplied`, `OrderCreated`, `OrderFilled`, `OrderCancelled`, `OrderExpiredEvent`, `RewardGranted`, `TreasuryWithdrawn`, `EpochRolled`, `PausedToggled`, `AuthorityProposed`, `AuthorityAccepted`, `ConfigUpdated`, `AchievementClaimed`, `ReferralRewardPaid`. Подписка: `program.addEventListener` или Helius webhooks по program id.

### Ошибки

Коды 6000–6021 зафиксированы (совместимость с клиентами), 6022–6029 добавлены аудитом. Русские сообщения для UI — `apps/web/src/utils/errors.ts`.

| Код | Имя | Когда |
|---|---|---|
| 6000 | Paused | игра на паузе |
| 6003 | HarvestTooSoon | < 60 с с прошлого сбора |
| 6014 | SelfTradeBlocked | покупатель = продавец |
| 6015 | CancelCooldown | < 3 ч после отмены |
| 6017 | EpochCapExceeded | кап эпохи исчерпан |
| 6020 | EpochNotOver | roll_epoch раньше 24 ч |
| 6022 | InvalidMint | token account другого mint |
| 6023–6025 | InvalidMintAuthority / InvalidMintDecimals / MintHasFreezeAuthority | неверный mint в `initialize` |
| 6026 | OrderTotalTooSmall | итог ордера < 10 000 lamports |
| 6027 | PrepayLimitReached | налог > 28 дн / удобрение > 7 дн вперёд |
| 6028 | NothingToRepair | прочность уже 100 |
| 6029 | MaxSupplyReached | награда превысила бы max supply |

Полный список — в IDL (`errors`).

## Backend `apps/backend` (Express)

Все ответы — JSON, без аутентификации (только чтение on-chain state).
(Раньше здесь были кран наград и рефералка с Telegram initData — удалено
продуктовым решением 14.09.2026: квесты выдаёт on-chain `claim_achievement`,
рефералка — on-chain `register_referrer`/`fill_order`.)

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| GET | `/health` | — | `{ ok, slot, epochId, paused }`; 503 если RPC/конфиг недоступны |
| GET | `/api/config` | — | Снимок `GameConfig` + текущей эпохи |

Rate limit: `RATE_LIMIT_PER_MINUTE` req/мин/IP (по умолчанию 30).

Крон `EPOCH_ROLL_CRON` (по умолчанию каждые 10 мин) вызывает `roll_epoch`, когда эпоха старше 24 ч — единственный on-chain write бэкенда, подписывается authority-ключом.

## Переменные окружения

| Приложение | Переменная | Обязательна | Назначение |
|---|---|---|---|
| web | `VITE_SOLANA_CLUSTER` | да | `localnet` / `devnet` / `mainnet-beta` |
| web | `VITE_RPC_URL` | для localnet / prod | RPC endpoint (публичный devnet отдаёт 429) |
| web | `VITE_PROGRAM_ID` | да | адрес программы |
| web | `VITE_BACKEND_URL` | нет | без него бэкенд-запросы не идут (квесты on-chain, он не нужен) |
| backend | `RPC_URL`, `PROGRAM_ID`, `AUTHORITY_KEYPAIR_JSON` | да | см. `.env.example` |
| backend | `CORS_ORIGIN`, `EPOCH_ROLL_CRON`, `RATE_LIMIT_PER_MINUTE`, `PORT` | нет | |
| scripts | `ADMIN_KEYPAIR_PATH`, `RPC_URL`, `PROGRAM_ID` | для `init-onchain` | |
