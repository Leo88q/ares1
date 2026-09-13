# Аудит Solana Potato — сентябрь 2026

**Объём:** программа `programs/solana_potato` (Anchor 0.30.1), фронтенд `apps/web`, бэкенд `apps/backend`, скрипты деплоя и инициализации, экономическая модель.
**Метод:** ручной разбор кода, сверка с IDL последней успешной сборки, восстановление программы, host-юниттесты (`cargo test`), интеграционные тесты на локальном валидаторе (`anchor test`), симуляция экономики (`economy/simulate.py`).
**Статус верификации** — в конце документа.

## 1. Сводка

| # | Серьёзность | Слой | Проблема | Статус |
|---|---|---|---|---|
| C1 | Critical | program | Программа не компилировалась: все `#[derive(Accounts)]`, data-структуры, события и ошибки уничтожены; в остатках — чужие seeds, `SellOrder` вместо `MarketOrder`, дубликат `AcceptAuthority`, недописанный `buy_field_sol` | Исправлено — восстановлено по IDL |
| C2 | Critical | program | Нет проверки `potato_mint == config.potato_mint` в `create_field`, `repair/upgrade/pay_tax/fertilizer`, `create_sell_order`, `harvest`, `grant_reward`. Атакующий создаёт свой mint, сжигает «фантики» и получает поля/апгрейды бесплатно; через mint с authority = config PDA расходует дневной кап эпохи (griefing) | Исправлено — `has_one = potato_mint` на `config` везде |
| C3 | Critical (economy) | program | `get_level_mult`: 2.86× на уровне 5 → **1.6× на уровне 6**; уровни 6–18 хуже пятого, апгрейд уничтожал доход | Исправлено — монотонная кривая, юнит-тест на монотонность |
| H1 | High | program | `fill_order`: `amount × price / 1e6` могло округлиться до 0 lamports → токены за бесплатно (по вине продавца, но UX-ловушка) | Исправлено — `MIN_ORDER_TOTAL_LAMPORTS` при создании |
| H2 | High | program | Аккаунты ордеров никогда не закрывались: rent заперт, `getProgramAccounts` на фронте растёт без границ | Исправлено — `close = seller` на fill / cancel / expire |
| H3 | High | backend | Награды выдавались по любому известному `questId` без проверки прогресса; достижения (до 550 🥔) можно было получить ничего не делая. `daily_checkin` был получаем один раз за всю жизнь (не daily). Один Telegram-аккаунт мог раздавать награды на разные кошельки | Исправлено — серверная on-chain верификация, дата в id дневных квестов, привязка TG ↔ кошелёк 1:1 |
| H4 | High | web | `main.tsx` жёстко использовал `http://127.0.0.1:8899`, игнорируя `VITE_RPC_URL`; в прод-сборке приложение не работало бы вообще | Исправлено |
| H5 | High | web | 429 от RPC: `useGame` создавался в 3 местах, каждый поллил `getProgramAccounts` каждые 5 с; плюс market 5 с, stats 7 с, config 15 с. Ограничители (`rpcLimiter`, `RateLimitedConnection`) не были подключены | Исправлено — один `GameProvider`, 20–30 с, пауза в скрытой вкладке, backoff, `dataSlice` для лидерборда |
| H6 | High | web | Сборка фронтенда сломана: `MainScreen` синтаксически неверен, `AuditLogViewer`/`useGuardedTransaction` импортируют несуществующие `../lib/*` и `sonner` | Исправлено — переписано / удалено |
| M1 | Medium | program | `initialize` не проверял mint: можно было инициализировать игру с mint'ом, у которого authority не PDA (harvest навсегда сломан) или есть freeze authority (можно заморозить игроков) | Исправлено |
| M2 | Medium | program | При частичной выплате из-за капа эпохи `last_harvest = now` — невыплаченный урожай сгорал | Исправлено — пропорциональный сдвиг `last_harvest` |
| M3 | Medium | program | Налог и удобрение можно предоплатить на неограниченный срок (фиксация цены на годы) | Исправлено — 28 / 7 дней |
| M4 | Medium | program | `grant_reward` не проверял `max_supply` | Исправлено |
| M5 | Medium | program | `stats.total_trades += 1` без checked-арифметики (паника при overflow-checks) | Исправлено — saturating |
| M6 | Medium | program | `MarketStats.*_24h` никогда не сбрасывались (кумулятивные под именем «24h») | Исправлено — сброс при смене UTC-дня |
| M7 | Medium | program | `withdraw_treasury` без лимитов и таймлока — компрометация authority = потеря казны | **Открыто** — перевести authority на Squads-мультисиг до mainnet, добавить `TreasuryWithdrawn`-алерт (событие добавлено) |
| M8 | Medium | web | `ProfileScreen` вызывал `claimReward(reward)` с числом вместо `questId`; id рекламы (`ad_<ts>`) не совпадал с бэкендом (`ad_bonus:<date>`) — ни одна награда не могла быть получена | Исправлено |
| M9 | Medium | web | `require('@solana/web3.js')` в браузерном коде (модалки вывода) — падение при открытии | Удалено (функции перенесены в WalletManagement) |
| L1 | Low | program | Прогрессивная комиссия (3→12 %) обходится дроблением ордера | Принято; описано в ECONOMY.md, вариант решения в roadmap |
| L2 | Low | program | Seeds `Field` не включают владельца — поиск полей игрока только через `memcmp` | Принято (индексер в roadmap); дёшево пока < 50 k полей |
| L3 | Low | program | Экономика: налог 50 🥔/нед превышал недельный доход поля 1-го уровня (42 🥔) | Исправлено — см. ECONOMY.md §3 |
| L4 | Low | web | `security.ts` — whitelist программ со старым program id; мёртвый код | Удалено |
| L5 | Low | infra | Не было git; `.env.example` указывали на старый program id `2T5z…`; `tests/init-game.ts` вызывал несуществующие аккаунты (`treasury`, `admin`) | Исправлено |
| L6 | Low | backend | `apps/backend/src/index.ts` запускал экспериментального NPC-агента (Anchor 0.32 API, отсутствующие зависимости), а не HTTP-сервер из README | Исправлено — Express-сервис; NPC перенесён в `experimental/` |
| I1 | Info | program | `sell_volume_24h` и `buy_volume_24h` всегда равны (один и тот же объём) | Оставлено для совместимости layout |
| I2 | Info | repo | `libs/sentinel`, `libs/solana-tx-guard` — вложенные git-репозитории (gitlinks без `.gitmodules`) | См. README; оформить как submodules или вынести |

## 2. Чеклист безопасности (раздел 1.2 задания)

| Проверка | Вердикт |
|---|---|
| **Reentrancy / CEI** | Solana не допускает повторного входа в программу через CPI без явной передачи её аккаунта; тем не менее все обработчики переписаны по Checks → Effects → Interactions: статусы ордеров, счётчики и `last_harvest` обновляются до CPI |
| **Integer overflow** | Вся арифметика урожая в `u128` с `checked_*`; счётчики — `saturating_*`; `overflow-checks = true` в release-профиле; `u64::try_from` с явной ошибкой |
| **Access control** | `has_one = authority` на всех admin-инструкциях; `has_one = owner` на полях; `has_one = seller` на ордерах; двухшаговая передача authority с проверкой `pending != default` |
| **PDA validation** | Все PDA с `seeds`+`bump` (bump хранится в аккаунте и проверяется `bump = x.bump`); escrow владеет сам собой; `roll_epoch` создаёт `["epoch", epoch_id+1]` — коллизии невозможны |
| **Account validation** | Все токен-аккаунты — `Account<TokenAccount>` с `token::mint` / `token::authority`; mint — `Account<Mint>` + `has_one` с конфигом; программы — `Program<Token/System/AssociatedToken>` |
| **Arbitrary transfer** | Токены двигаются только: burn с подписью владельца; mint подписью PDA config; из escrow подписью PDA escrow; из treasury подписью PDA config по команде authority. Чужие токены увести нельзя |
| **Marketplace manipulation** | Self-trade запрещён; wash-trading через второй кошелёк убыточен (3 % + fee); front-running бессмыслен (фиксированная цена); экспирация и закрытие permissionless |
| **Epoch manipulation** | `Clock::get()` (sysvar), roll только по истечении 24 ч, любой может вызвать — нет зависимости от авторитета |
| **Tax evasion** | Штраф зашит в формулу урожая; неуплата невозможна «в обход» |
| **Fertilizer stacking** | Лимит 7 дней вперёд |
| **Treasury drain** | Только authority; лимитов нет → M7 |

## 3. Качество кода

* **Стиль/документация:** модульные doc-комментарии, константы с пояснениями, секции разделены; порядок аккаунтов зафиксирован как публичный ABI. TODO/FIXME в репозитории нет.
* **Сообщения об ошибках:** все `#[msg]` информативны; коды 6000–6021 сохранены, новые добавлены в конец; на фронте — перевод на русский (`utils/errors.ts`) и распознавание ошибок кошелька/RPC.
* **Тесты:** 13 host-юниттестов чистых функций (кривая уровней, цены, урожай, комиссии, окно статистики, размеры аккаунтов) + интеграционные сценарии в `tests/solana_potato.ts`: инициализация с неверным mint, награды и их лимиты, покупка поля, чужой mint, все ошибки доступа, лимиты предоплаты, сбор урожая после 60 с и износ, escrow-цикл ордера (создание → self-trade → fill → закрытие), отмена и кулдаун, пауза, лимиты `update_config`, казна, передача authority.
* **Compute units** (максимум по логам локального валидатора во время `anchor test`, лимит 200 000):

  | Инструкция | CU | Инструкция | CU |
  |---|---|---|---|
  | fill_order | 80 172 | grant_reward | 10 147 |
  | create_sell_order | 42 748 | apply_fertilizer / pay_tax | 9 362 / 9 360 |
  | withdraw_treasury | 21 428 | init_epoch | 9 204 |
  | create_field | 15 966 | upgrade_field / repair_field | 8 839 / 8 830 |
  | cancel_order | 14 951 | initialize | 8 763 |
  | harvest | 13 361 | close_expired_order | 6 398 |
  | update_config / accept / propose / set_paused | 3 800–4 600 | | |

  Самая тяжёлая — `fill_order` (5 CPI + `init_if_needed` ATA казны): 40 % лимита. Запас есть; при расширении держать ≤ 120 k.
* **Стек:** `CreateSellOrder` (три `init` + escrow) в неупакованном виде превышал 4 KiB фрейм SBF (4 544 байт → UB). Аккаунты обёрнуты в `Box` — предупреждение линковщика исчезло, IDL не изменился.
* **Оптимизации:** макрос для 4 одинаковых структур аккаунтов; `refund_and_close_escrow` общий для cancel/expire; закрытие ордеров возвращает rent продавцу (~0.0018 SOL на ордер).

## 4. Фронтенд

| Проверка | Было | Стало |
|---|---|---|
| Memory leaks в `useEffect` | интервалы очищались, но множились по экземплярам хуков | один поллер на провайдер, очистка при unmount, пауза при `visibilityState === 'hidden'` |
| TypeScript | ~60 `any`, отсутствующие модули, `require` в ESM | `strict` + `noUnusedLocals`; `any` остался только в `polyfills`-совместимых местах (0 в бизнес-логике) |
| Обработка ошибок RPC | `console.error` и молчание | backoff ×2…×8, экран «Нет связи» с автоповтором, `ErrorBoundary`, человекочитаемые тексты |
| Производительность | один бандл | `React.lazy` по экранам, vendor-чанки (react / motion / solana / wallets), `dataSlice` для лидерборда, `getMultipleAccountsInfo` вместо 2 запросов |
| Mobile / Telegram | ок | `viewport-fit=cover`, safe-area, `Telegram.WebApp.ready/expand`, MWA-адаптер |
| Accessibility | нет | `aria-label` на иконочных кнопках, `role="dialog"/"switch"/"tab"/"progressbar"`, `aria-live` для накопленного урожая |
| SEO | title + description | OG/Twitter-мета, `lang`, `theme-color`, preconnect, стартовый лоадер до загрузки JS |

## 5. Что обязательно до mainnet

1. **Внешний аудит** контракта (OtterSec / Sec3 / Neodyme) — этот документ не заменяет его.
2. **Мультисиг authority** (Squads) + отдельный «reward signer» для бэкенда с ограниченным правом (после делегирования в v2 программы) или хотя бы лимит `grant_reward` на эпоху для backend-ключа.
3. **Мониторинг**: Helius webhooks на события `TreasuryWithdrawn`, `PausedToggled`, `ConfigUpdated`, `AuthorityProposed`, крупные `OrderFilled`; алерты в Telegram. Бэкенд-логи по каждой выдаче награды уже пишутся.
4. **Платный RPC** для фронта и бэкенда (публичный devnet/mainnet endpoint отдаёт 429 уже при десятках игроков).
5. **Redeploy + re-init** программы: текущий devnet-деплой (слот 491235658) собран из старого кода без проверок C2/M1; после `anchor deploy` требуется новый mint (без freeze authority) и `init-onchain`.
6. Перенести хранилище наград с JSON-файла на SQLite/Postgres перед вторым инстансом бэкенда.

## 6. Статус верификации (04.09.2026)

| Проверка | Результат |
|---|---|
| `cargo test -p solana_potato --lib` (host) | 13 passed |
| `anchor build` — Agave 4.2.2, platform-tools v1.54, Anchor 0.30.1 | ок, `.so` 489 400 байт, IDL совместим со старым (19/19 инструкций идентичны) |
| `anchor test` — локальный валидатор, `tests/solana_potato.ts` | 28 passing |
| `tsc --noEmit` web / backend / bot | 0 ошибок |
| `vite build` | ок |
| Redeploy на devnet | см. корневой README |

Не проверялось: поведение на реальных кошельках в Telegram (нужен задеплоенный HTTPS-фронт и бот), нагрузка на RPC при > 100 игроках, поведение `roll_epoch` через 24 ч на devnet (проверено только отклонение до истечения срока).
