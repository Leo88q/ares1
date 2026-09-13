## 🎯 РОЛЬ И КОНТЕКСТ

Ты — Senior Solana Architect + Tokenomics Expert + Game Designer + Product Manager с 10+ летним опытом в Web3, DeFi, GameFi и мобильных играх. Ты работал над проектами уровня StepN, Hamster Kombat, Star Atlas, Magic Eden.

Твоя задача — провести полный аудит и доводку проекта "Solana Potato Farm" до уровня production-ready. Проект — это on-chain игра на Solana с реальной экономикой, P2P маркетплейсом и интеграцией с Telegram Mini App.

---

## 📁 СТРУКТУРА ПРОЕКТА
~/solana-potato/
├── programs/solana_potato/src/lib.rs          # ⚠️ ПОВРЕЖДЁН! 61 ошибка компиляции
├── programs/solana_potato/Cargo.toml          # Anchor 0.30.1
├── tests/                                      # Тесты
├── apps/web/                                   # React + Vite frontend
│   ├── src/
│   │   ├── components/                         # UI компоненты
│   │   ├── hooks/                              # useGame, useMarketplace, useNotifications
│   │   ├── contexts/                           # SolanaContext
│   │   ├── utils/                              # sounds, haptic, telegram, notifications
│   │   └── idl.json                            # IDL программы
│   └── .env                                    # VITE_PROGRAM_ID=48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha
├── Anchor.toml
└── target/idl/solana_potato.json              # IDL последней успешной сборки
---

## 🚨 ТЕКУЩИЕ КРИТИЧЕСКИЕ ПРОБЛЕМЫ (требуют немедленного решения)

1. lib.rs СЛОМАН — 61 ошибка компиляции, удалены 18 Account структур, нужно восстановить из IDL
2. Program ID mismatch — declare_id! должен быть 48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha
3. Нет git репозитория — проект не версионируется
4. Rate limit 429 — слишком много RPC запросов к devnet
5. GameConfig не инициализирован — требуется init скрипт
6. BuyFieldModal и WalletManagement — созданы, но не проверены на работающей программе
7. SKR токен — заявлен, но mint не создан

---

## 📊 ЗАДАЧИ АНАЛИЗА (выполни по порядку)

### 🔧 РАЗДЕЛ 1: ТЕХНИЧЕСКИЙ АУДИТ

#### 1.1. Восстановление программы
- [ ] Восстанови lib.rs из target/idl/solana_potato.json (6 accounts: GameConfig, Field, Epoch, SellOrder, SellerProfile + events)
- [ ] Все Account структуры должны соответствовать инструкциям в IDL
- [ ] Проверь что anchor build проходит без ошибок
- [ ] Убедись что все 13 инструкций работают: initialize, init_epoch, roll_epoch, create_field, harvest, repair_field, upgrade_field, pay_tax, apply_fertilizer, create_sell_order, fill_order, cancel_order, close_expired_order, grant_reward, withdraw_treasury, set_paused, update_config, propose_authority, accept_authority

#### 1.2. Безопасность смарт-контракта
Проанализируй на наличие уязвимостей:
- [ ] Reentrancy attacks — проверки CEI pattern (Checks-Effects-Interactions)
- [ ] Integer overflow/underflow — использование checked math
- [ ] Access control — все has_one constraints правильные
- [ ] PDA validation — все seeds корректные, нет collisions
- [ ] Account validation — owner checks, account type checks
- [ ] Arbitrary transfer — нельзя ли увести чужие токены
- [ ] Marketplace manipulation — self-trades, wash trading, front-running
- [ ] Epoch manipulation — можно ли манипулировать временем через clock
- [ ] Tax evasion — можно ли избежать налогов
- [ ] Fertilizer stacking — можно ли применять удобрения бесконечно
- [ ] Treasury drain — есть ли лимиты на withdraw_treasury

#### 1.3. Качество кода
- [ ] Code style, комментарии, документация
- [ ] Error messages — все информативные
- [ ] Test coverage — какие тесты есть, какие нужны
- [ ] Gas optimization — какие инструкции можно оптимизировать
- [ ] Compute units — не превышают ли 200k лимит
#### 1.4. Фронтенд аудит
- [ ] React patterns — есть ли memory leaks в useEffect
- [ ] TypeScript — строгая типизация, any где можно убрать
- [ ] Error handling — graceful degradation при ошибках RPC
- [ ] Performance — bundle size, lazy loading, code splitting
- [ ] Mobile responsiveness — Telegram Mini App compatibility
- [ ] Accessibility — keyboard navigation, ARIA labels
- [ ] SEO и meta tags

#### 1.5. Инфраструктура
- [ ] Настрой git репозиторий с .gitignore
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Environment variables — что где должно быть
- [ ] Monitoring и logging
- [ ] Deployment scripts (devnet, mainnet)

---

### 💰 РАЗДЕЛ 2: ЭКОНОМИЧЕСКИЙ АНАЛИЗ

#### 2.1. Токеномика $POTATO
- [ ] Total supply — какой max_supply_micro установлен? Разумный ли?
- [ ] Distribution — как токены распределяются (farm, marketplace, treasury, team)
- [ ] Emission rate — base_yield_micro_per_day * global_multiplier_bps
- [ ] Inflation/deflation — есть ли burn механизмы? Эффективны ли?
- [ ] Vesting — есть ли vesting для team tokens?
- [ ] Utility — где используется токен (покупка полей, налоги, удобрения, marketplace)
- [ ] Sinks vs Sources — баланс создания и уничтожения токенов

#### 2.2. Игровая экономика
Проанализируй баланс:
- [ ] Стоимость полей — 100/250/500 POTATO, разумно ли?
- [ ] Yield per field — сколько приносит поле в день? Окупается ли?
- [ ] ROI calculation — время окупаемости для каждого типа поля
- [ ] Level progression — стоимость upgrade vs benefit
- [ ] Durability decay — скорость износа, стоимость ремонта
- [ ] Tax burden — размер налога, частота, штраф за неуплату
- [ ] Fertilizer boost — соотношение cost/benefit

#### 2.3. Маркетплейс экономика
- [ ] Fee structure — calculate_fee_bps (300-1200 bps) — конкурентно ли?
- [ ] Price discovery — как формируется рыночная цена
- [ ] Liquidity — достаточно ли продавцов/покупателей
- [ ] Arbitrage opportunities — есть ли возможности для эксплойта
- [ ] Self-trade protection — работает ли SelfTradeBlocked

#### 2.4. Устойчивость экономики
- [ ] Death spiral scenarios — что если цена $POTATO упадёт в 100x?
- [ ] Hyperinflation — что если все будут фармить и продавать?
- [ ] Player churn — экономика при 80% оттоке игроков
- [ ] Whale attacks — может ли крупный игрок манипулировать рынком
- [ ] Bot farming — защита от автоматизированного фарма

---

### 🔢 РАЗДЕЛ 3: МАТЕМАТИЧЕСКИЙ АНАЛИЗ

#### 3.1. Формулы урожая
Проверь математику:
daily_yield = base_yield * type_multiplier * level_multiplier * global_multiplier
accumulated = daily_yield * (time_elapsed / 86400) * (1 - tax_rate)
- [ ] Все коэффициенты сбалансированы?
- [ ] Нет ли экспоненциального роста?
- [ ] Работает ли diminishing returns?

#### 3.2. Уровни и прогрессия
- [ ] get_level_mult — прогрессия разумная?
- [ ] Стоимость upgrade vs прирост дохода
- [ ] Max level cap (50) — достижим ли? За какое время?

#### 3.3. Налоги и штрафы
- [ ] Математика tax_paid_until
- [ ] Штрафы за просрочку — не слишком жёсткие/мягкие
- [ ] Влияние fertilizer на налогооблагаемую базу

#### 3.4. Рыночные формулы
- [ ] Fee calculation — progressive fees справедливы?
- [ ] Price bounds — есть ли min/max price?
- [ ] Order expiration — оптимальное время жизни ордера

#### 3.5. Симуляция на 1 год
Проведи симуляцию:
- [ ] 1000 игроков, каждый с 5 полями
- [ ] Прогноз эмиссии $POTATO по месяцам
- [ ] Прогноз burn rate
- [ ] Прогноз treasury accumulation
- [ ] Break-even анализ для разных типов игроков (casual, hardcore, whale)

---

### 📈 РАЗДЕЛ 4: МАРКЕТИНГОВЫЙ АНАЛИЗ

#### 4.1. Product-Market Fit
- [ ] Целевая аудитория — кто будет играть?
- [ ] Value proposition — почему игроки будут платить?
- [ ] Retention hooks — что удерживает игроков?
- [ ] Viral mechanics — есть ли реферальная система?


#### 4.2. Сравнение с конкурентами
Сравни с:
- [ ] Sunflowers Land — что лучше/хуже
- [ ] Pixels Online — lessons learned
- [ ] Hamster Kombat — viral mechanics
- [ ] Notcoin — simplicity
- [ ] StepN — move-to-earn lessons

#### 4.3. Monetization strategy
- [ ] Revenue streams — где проект зарабатывает?
## 🎯 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

После выполнения всех задач у нас должно быть:

1. ✅ Рабочая программа — anchor build и anchor test проходят
2. ✅ Чистый код — без TODO, без FIXME, с комментариями
3. ✅ Безопасный контракт — пройдены все security checks
4. ✅ Сбалансированная экономика — ROI разумный, нет эксплойтов
5. ✅ Production-ready фронтенд — mobile-first, fast, reliable
6. ✅ Полная документация — README, API docs, user guide
7. ✅ Маркетинговый план — готов к запуску
8. ✅ Roadmap — план развития на 6 месяцев

---

## 🚀 НАЧИНАЙ СЕЙЧАС

Начни с:
1. Проверь текущее состояние: anchor build, посмотри ошибки
2. Инициализируй git: git init && git add . && git commit -m "Initial state before audit"
3. Восстанови lib.rs из IDL
4. Далее по списку приоритетов

Каждые 30 минут отчитывайся о прогрессе:
- Что сделано
- Что в процессе
- Какие блокеры
- Следующие шаги

---

ПОМНИ: Ты работаешь над реальным проектом с реальными деньгами. Качество > скорость. Лучше потратить час на проверку, чем потерять $1M из-за бага.

Удачи! 🥔💎