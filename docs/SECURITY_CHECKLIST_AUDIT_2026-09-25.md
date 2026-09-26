# Аудит по чек-листу (30 пунктов): игра + смарт-контракт `solana_potato`

**Дата:** 2026-09-25 · **Ветка:** `arena/01a0daed-ares1` · **Объект:** `game/programs/solana_potato/src/lib.rs` (v0.2.0, Anchor 0.31.2 / Solana 4.2.2), `migrations.rs`, тесты `game/tests/`.

**Вердикт: контракт защищён по всем 30 пунктам чек-листа — ни одной критической или высокорисковой находки не обнаружено.** Все классы из списка либо закрыты конструкцией (PDA/has_one/signer-констрейнты, checked-математика, CEI-порядок, тимлоки и рейт-лимиты), либо неприменимы к модели Solana/Anchor и покрыты рантаймом. Найдено 6 **остаточных рисков** (низкий/средний, требуют организационных решений, не патчей кода) — раздел «Остаточные риски». Дополнительно зафиксировано 2 некритичных замечания по чистоте кода (Z1, Z2).

Проверка выполнена чтением всего `lib.rs` (3811 строк), `migrations.rs`, конфигов и существующих тестов; каждое «✅» подкреплено ссылкой на код и/или тестом. Новые тесты: см. раздел «Добавленные тесты».

---

## Сводная таблица

| # | Тема чек-листа | Статус | Защита в коде (доказательство) | Тест |
|---|---|---|---|---|
| 1 | Отсутствие `seeds`/`bump` → произвольный аккаунт | ✅ | Все 13 data-аккаунтов создаются через `init`/`init_if_needed` с `seeds`+`bump` (config, epoch, field, order, escrow, presale, admin_state, license, referral, buyer_presale, achievements, seller_profile, market_stats). `remaining_accounts` проверяются вручную: `owner == program_id` + повторный вывод PDA (`fill_order`: license/referral), `owner+is_writable+try_deserialize` (`batch_harvest`), `MAX_CLAIM_PROOFS`+O(n²)-дубли (`claim_achievement`) | **нов:** «PDA-подмена отклонена» (integration), `achievement_proofs_reject_duplicate_and_foreign_fields` (host), **нов:** guard-test §контексты |
| 2 | Нет `has_one` для mint/authority | ✅ | `has_one = potato_mint` ×10, `has_one = owner` ×4 (все Field-контексты), `has_one = authority` ×18, `has_one = seller` ×3. Платежные ATA: `token::mint = potato_mint, token::authority = owner` | «rejects paying with a foreign mint», **нов:** guard-test §has_one |
| 3 | Нет `signer` у плательщика | ✅ | Каждый плательщик — `Signer<'info>`: `authority`, `owner`, `buyer`, `seller`, `payer`, `user`, `new_authority`. Аналог проверки уже был: «only the owner can act on a field» | **нов:** «платёж без подписи владельца отклонён» (ConstraintSigner) |
| 4 | Подмена system program | ✅ | `Program<'info, System>` (типизированная проверка адреса+executable) во всех 14 контекстах; SOL-переводы — `anchor_lang::system_program::transfer` (typed CPI, SW003, `buy_field_sol`) | **нов:** «поддельный system program отклонён» |
| 5 | Rent-exemption / закрытие до ренты | ✅ | `init` с точным `space = 8 + INIT_SPACE`; миграции добивают shortfall системным переводом (`write_migrated_account`, `Rent::minimum_balance`); `close` возвращает ренту законному владельцу | `migrations_reject_malformed_data…` (host), `test:migrations` (CI), «rejects a foreign owner and refunds rent on close» |
| 6 | Неинициализированное zero-состояние | ✅ | `initialize`/`init_epoch`/`init_presale` заполняют **каждое** поле явно; повторный `init` невозможен; миграции дозаполняют нулями и ревалидируют `try_deserialize` | «cannot be initialized twice», `config_migrations_preserve_every_legacy_byte…` (host) |
| 7 | Reentrancy (CPI до коммита состояния) | ✅ | `fill_order` — строгий CEI: `order.status = Filled` и все счётчики пишутся **до** любого CPI (lib.rs ~1105); закрытие `close = seller` обнуляет аккаунт → повторный fill/cancel невозможен физически; burn перед mint. Anchor не даёт повторного входа в ту же инструкцию с незавершённым borrow (`try_borrow_mut`) | **нов:** «купленный ордер нельзя купить второй раз» (integration) |
| 8 | Self-CPI без дискриминатора / бесконечный цикл | ✅ | F-01: `assert_no_cpi_grind()` — `get_stack_height() > TRANSACTION_LEVEL_STACK_HEIGHT` → `CpiGrindNotAllowed`; стоит на обеих платных-RNG инструкциях (`buy_field_skr`:437, `upgrade_field`:779). Self-CPI-циклы: ни одна инструкция не вызывает сама себя | `cpi_grind_guard_passes_at_top_level_on_host` (host); CPI-обёртка отвергается рантаймом |
| 9 | Устаревшие кэшированные значения | ✅ | Кэшей нет: все значения читаются из аккаунтов в каждом вызове (`config`, `epoch`, `mint.supply` — заново на каждой инструкции) | конструктивно; N/T |
| 10 | Доверие Clock/Slot | ✅⚠ | `slot` используется только как энтропия в смеси с SlotHashes (никогда как стоимость); `unix_timestamp` — только для таймеров доходности/тимлоков (не консенсусно-критично). Остаточный риск R3 (лидер слота) — принят в индустрии | «roll_epoch is rejected before 24h», `lunar_weight_is_segment_weighted…` (host), **нов:** `lunar_weighted_bps_stays_within_table_extremes` |
| 11 | Mint authority не отозван → инфляция | ✅ | `initialize` требует `mint_authority == config PDA` (:180), `decimals == 6` (:183), `freeze_authority == none` (:184). Ни одна инструкция не возвращает authority админу; минтить может **только** программа через PDA-подпись, в пределах `epoch cap` + `max_supply` | **нов:** «прямой минт админом отклонён»; «rejects a mint whose authority is not the config PDA» |
| 12 | Transfer-fee / расширения Token-2022 | ✅(N/A) | Программа пинует классический SPL Token (`anchor-spl` feature `token`; `Program<'info, Token>`). Аккаунт Token-2022 не пройдёт owner-check → «свежие» расширения (TransferFee/NonTransferable) физически не подставить | owner-check в каждом `Account<'info, TokenAccount>`; guard-test §token-program |
| 13 | Переполнение в расчёте комиссий | ✅ | Вся математика: `checked_*` (44 вызова) / `saturating_*` (50) + u128-промежуточные + `overflow-checks = true` в `[profile.release]` (game/Cargo.toml:6) + `u64::try_from(...).map_err(MathOverflow)` | **нов:** `fee_is_never_greater_than_amount…`, `compute_pending_yield_never_panics_on_extreme_inputs`, `upgrade_cost_is_checked_at_every_level_and_type` |
| 14 | Отрицательный баланс через unchecked-sub | ✅ | Тип `u64` исключает отрицательность; все вычитания `saturating_sub`/`checked_sub`; escrow обязана опустошиться точно (`close_account` падает на непустом балансе — fail-safe сходимость | **нов:** host-инварианты fee; «registration rejects 4.999999 POTATO atomically» |
| 15 | Округление комиссий в пользу атакующего | ✅ | `fee = amount × bps / 10_000` — floor; скидки — `.min(fee_listed)`; инвариант `fee ≤ amount`; `MIN_ORDER_TOTAL_LAMPORTS` (0.001 SOL) не даёт ордеру обесцениться в ноль; 60/40 split fee — floor в пользу burn | `order_total_rounds_down_and_is_gated`, `fee_tiers_are_progressive` (host), **нов:** `fee_is_never_greater_than_amount…` |
| 16 | Казна не PDA / дренаж | ✅ | Потато-казна = ATA от `config` PDA (authority = config); SOL-казна = 0-байтовый PDA `treasury_sol`; SKR-казна = ATA от `treasury_sol` PDA. Выводы: `propose → 30 с тимлок → execute`, назначение **прибито** к ATA authority (`associated_token::authority = authority`: 2646/2730/2789), rolling 24 ч лимиты (250k 🥔 / 25 SOL / 100k SKR), `cancel_withdrawal` | «withdraw_treasury is two-step…», «rate-limits SOL withdrawals…», **нов:** «назначение вывода прибито к ATA authority» |
| 17 | Front-running / MEV | ✅⚠ | Платный дроп тира: `keccak(buyer ‖ sold ‖ slot ‖ SlotHashes)` — непредсказуемо при подписании + top-level guard; покупка SOL: slippage-щит `max_total_lamports` → `InvalidPrice`; маркета — escrow с фиксированной ценой (нет AMM-сэндвича); cancel-cooldown 3 ч. Остаточное: обычная гонка за чужой ордер — свойство first-come маркетплейса (R4) | «enforces maxTotalLamports», «SKR rail: rejects a mint different from config», `presale_sol_price_scales_with_field_type` |
| 18 | DoS неограниченными циклами | ✅ | `batch_harvest` ≤ 10 полей (:1740), O(n²)-дубли при n ≤ 10; `claim_achievement` ≤ 12 доказательств (`MAX_CLAIM_PROOFS`:93/:3706); все остальные циклы — по константным таблицам (LUNAR_TABLE 28) | `achievement_proofs_reject_duplicate…` (host), **нов:** «кап 10 полей в batch», **нов:** `achievement_proof_cap_is_enforced` |
| 19 | Спам логов / log-DoS | ✅ | Нет пользовательских строк в `msg!`; события фиксированного размера; `emit!` только на значимых переходах состояния | конструктивно |
| 20 | Admin god mode | ✅⚠ | Двухшаговый transfer authority (`propose`/`accept`); 24 ч тимлок на SKR mint и повышение цены пресейла (мгновенный только kill-switch в 0); guardian — только pause; reward_signer отделён (S-03) + квота грантов 10 % капа эпохи; `update_config` с жёсткими потолками (250k/день, 100 🥔/день, 2.0×); события на все изменения. Остаточное R1 (одиночный ключ authority на devnet → мультисиг Squads на mainnet) | «two-step authority transfer», «update_skr_mint is a timelocked proposal», «update_config enforces ceilings», «guardian can pause but not unpause», «grant_reward is capped at 10 %» |
| 21 | Неверный `space = 8 + …` | ✅ | Везде `space = 8 + T::INIT_SPACE` (+2 исключения — token-аккаунты фиксированного размера); host-тест сверяет байты с декодерами клиентов | `account_sizes_match_client_decoders` (host), `layoutParity.test.ts` (offchain), `yarn check:contract` (CI) |
| 22 | `init` без payer/system | ✅ | Все `init` имеют `payer` (lint `skip-lint = false` в Anchor.toml тоже следит); system_program подключён во все контексты с init | guard-test §init-атрибуты (проверяет каждую `#[account(init…)]`-блоку) |
| 23 | Лишний `mut` на read-only аккаунтах | ⚠ Z1 | Косметика: `potato_mint` помечен `mut` в spend-контекстах, где supply не меняется (burn не трогает mint-аккаунт). Не уязвимость: лишняя write-блокировка, цена транзакции не меняется. Чистить не обязательно | N/T |
| 24 | Недоверенная десериализация | ✅ | `try_deserialize` с дискриминатором; для `remaining_accounts` — `owner == program_id` + PDA-пере-вывод; миграции валидируют legacy-раскладки белым списком размеров (156/164/228/260; 97/145; 69/70; 41/49) + Borsh-перепарсинг; комментарии-`/// CHECK:` у каждого UncheckedAccount | `migrations_reject_malformed_data_and_wrong_authority` (host), **нов:** «PDA-подмена отклонена» |
| 25 | Коллизия дискриминаторов | ✅ | Стандартные 8-байтные Anchor-дискриминаторы всех аккаунтов/инструкций; `write_field_account` пишет с нулевого смещения и проверяет длину | `batch_field_serialization_round_trips_without_extra_discriminator` (host) |
| 26 | Расхождение IDL / сдвиг индексов | ✅ | CI: `yarn check:contract` (IDL == сорцам), `clientAbi.test.ts` (ABI == pinned-build), `layoutParity.test.ts` (web×backend×landing), версии pinned (Anchor 0.31.2, Solana 4.2.2, Node 22); `declare_id` == IDL address == Anchor.toml | весь CI-пайплайн; **нов:** guard-test §program-id-паритет |
| 27 | Исчерпание compute budget | ✅ | Батчи ≤ 10; O(n²) только в пределах капов; тяжёлых аллокаций нет; миграции — разовые; web-клиент выставляет priority fee | «rejects empty, duplicate, read-only and premature batches» |
| 28 | Референс ренты не тому адресу | ✅ | `close = owner` (Field, :2935), `close = seller` ×3 (ордер/эскроу, :2452/:2491/:2512), `close = payer` (Epoch, :2950); каждый close-аккаунт связан `has_one` с получателем | «rejects a foreign owner and refunds rent on close», «close_old_epoch refuses epochs inside the retention window», guard-test §close-назначения |
| 29 | Дубликаты аккаунтов в инструкции | ✅ | `batch_harvest`: O(n²) `BadProof`; `verify_fields` (квесты): O(n²) `BadProof`; Anchor-контексты: дубли среди аккаунтов разных типов невозможны (констрейнты разъезжаются по seeds/mint/authority) | «rejects empty, duplicate…», «rejects repeating one field as a five-field proof» (integration), host-тесты |
| 30 | Feature-gate / deprecated sysvar | ✅⚠ | Единственный «сырой» sysvar — SlotHashes, читается по пиновому адресу (2 контекста, `UnsupportedSysvar` обходится частичным парсингом первых 48 байт; fail-safe → `None`); deprecated-сисваров нет; инструкции не зависят от feature-gates | **нов:** `recent_slot_hash_ignores_truncated_sysvar_data` (host) |

Легенда: ✅ — защищено; ✅⚠ — защищено с документированным остаточным риском; ⚠ — замечание; N/T — неприменимо/покрыто рантаймом; **нов** — тест добавлен этой проверкой.

---

## Остаточные риски (не патчи, а решения)

| ID | Риск | Уровень | Что делать |
|---|---|---|---|
| R1 | Единый EOA-ключ `authority` (на devnet так и осталось): контроль над эмиссией-рычагами (`update_config` до потолков), treasury-выводами (лимит 250k 🥔 + 25 SOL / сутки) и pause. Все изменения — через тимлоки/потолки, но ключ один | средний (mainnet), низкий (devnet) | Перевести authority на мультисиг Squads/Vault на mainnet (уже отмечено в F-02/AUDIT.md). Двухшаговый transfer — готов, миграция пресейла предусмотрена (`migrate_presale_authority`) |
| R2 | `initialize` не требует `mint.supply == 0`: деплойер, создавший mint, мог наминтить запас до `initialize`. Это bootstrap-доверие, не эксплойт программы (после initialize authority у PDA навсегда) | низкий | Перед mainnet-инициализацией публиковать proof-of-zero-supply (сигнатура/скрипт в deploy-mainnet) или добавить require в следующую мажорную версию |
| R3 | RNG: slot + SlotHashes защищают от grind/revert-if-unlucky, но лидер слота знает блокхеш (может цензурить/переставлять, не подделывать). Дроп — только тиры 70/25/5, урон ограничен | низкий | Для mainnet-пресейла допустимо; если тиры станут дороже — Switchboard/Оraсle VRF |
| R4 | MEV-гонка за «хороший» ордер (fill_order permissionless) — свойство любого escrow-маркетплейса first-come | низкий | Приемлемо; при необходимости — partial-fill/аукцион в v3 |
| R5 | `withdraw_*` не проверяют `config.paused` — казну можно опустошать (в лимитах окна) во время паузы | низкий | Сознательный компромисс (пауза — не заморозка казны для команды-мультисига). Если пауза должна замораживать и казну — добавить require в withdraw |
| R6 | order_id не рециклится: после `close` Anchor-`init` на том же PDA падает (аккаунт уже не System-owned) | trivia/UX | Не чинить; задокументировать в API.md (продавец выбирает новый nonce) |

Замечания по чистоте: **Z1** (п.23) лишние `mut` на `potato_mint` в spend-контекстах; **Z2** — `roll_epoch` seeds используют `(config.epoch_id + 1)` без checked-сложения (переполнение достижимо за 2⁶⁴ эпох — неэксплуатируемо, panic в транзакции).

---

## Добавленные тесты (эта проверка)

### 1. Host-юниты — `game/programs/solana_potato/src/lib.rs` (`mod tests`, CI: `cargo test -p solana_potato --lib`)
- `fee_is_never_greater_than_amount_in_any_tier` — инвариант `fee ≤ amount` + floor-формула по всем тирам и границам u64 (пп. 13–15);
- `fee_bps_stay_within_nine_and_twelve_percent` — границы тиров (п. 15);
- `compute_pending_yield_never_panics_on_extreme_inputs` — checked-цепочка не паникует на u64::MAX/отрицательном elapsed (п. 13–14);
- `upgrade_cost_is_checked_at_every_level_and_type` — checked-стоимость апгрейда на границах (п. 13);
- `lunar_weighted_bps_stays_within_table_extremes` — множитель всегда в [8500, 11500] — межэпохальный арбитраж невозможен (п. 10);
- `withdrawal_slots_are_independent_per_asset` — слоты propose/execute/cancel не пересекаются (п. 16, 20);
- `parse_slot_hash_ignores_truncated_sysvar_data` — частичный парсинг SlotHashes fail-safe (п. 30);
- `achievement_proof_cap_is_enforced` — 13-е доказательство отклоняется (п. 18);
- `economic_rails_are_pinned` — константы рельсов (тимлоки, окна, квоты) зафиксированы; изменение = осознанное решение (пп. 16, 20).
- Рефакторинг без изменения поведения: `recent_slot_hash` → обёртка над `parse_slot_hash(&[u8])` для тестируемости.

### 2. Интеграционные — `game/tests/solana_potato.ts` → `describe("security checklist (2026-09-25 audit)")` (CI: `anchor test`)
- «PDA-подмена отклонена: чужой программный аккаунт не проходит как Field» (п. 1, 24);
- «платёж без подписи владельца отклонён» → ConstraintSigner (п. 3);
- «поддельный system program отклонён» (п. 4);
- «прямой минт админом отклонён: authority митта — config PDA» (п. 11);
- «кап 10 полей в batch_harvest» и «дубль поля в батче — BadProof» (пп. 18, 29);
- «подмена epoch в harvest отклонена» (п. 1);
- «купленный ордер нельзя купить второй раз» — CEI + close (пп. 7, 28);
- «вывод казны: сумма строго по proposal, назначение — только ATA authority, тимлок без пропуска» (пп. 16, 20).

### 3. Guard-tripwire — `game/scripts/security-guards.test.mjs` (zero-dep, `node --test`; уже прогнан локально)
Парсит `#[account(...)]`-блоки и исходники, и валит **32 инварианта**: каждый `init` с payer (+space у data-аккаунтов), каждый `seeds` с bump, счётчики `has_one`/`close`-назначений/`burn_from_user`/paused-чеков/SlotHashes-пинов, тимлок-константы, капы батчей, `overflow-checks = true`, отсутствие `unsafe`, паритет program-id (`declare_id` == Anchor.toml == IDL клиента) и др. Любое удаление защиты ломает тест — регрессионная ловушка по всем 30 темам чек-листа. Подключён: `yarn test:guards`, CI watchtower (`node --test`).

---

## Методология и ограничения

- Прочитаны: `lib.rs` (полностью), `migrations.rs`, `Anchor.toml`, `Cargo.toml`, `tsconfig*`, CI-воркфлоу, `tests/solana_potato.ts`, `tests/offchain/*`, скрипты `ci-local.sh`/`ci-run.sh`, `check-contract.mjs`.
- Интеграционные и host-тесты в этой песочнице не исполнялись (нет Rust/Anchor-тулчейна и localnet-валидатора) — они прогоняются CI-джобами `program` (cargo test + anchor test) и `offchain`; guard-tripwire исполнен локально: `node --test game/scripts/security-guards.test.mjs`.
- Внешний аудит зависимостей и секретов — отдельно (gitleaks + npm audit, см. `docs/AUDIT_FIXES_2026-09-23.md`, F-11/F-19): новых расхождений не найдено.
