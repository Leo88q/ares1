# PRODUCTION READINESS REPORT — ARES-1 (Potato Colony) — 20.09.2026

## Что сделано по этапам (MASTER-PROMPT-PRODUCTION)

### Этап 1 — Аудит
- **Done.** Новые находки — `game/docs/AUDIT-PRODUCTION-2026-09-20.md` (2 критичных исправлены, 6 важных задокументированы). Старые `AUDIT.md`/`AUDIT-2026-09-13.md` — действительны, B1 (program id) уже закрыт, B2 (CI) — включён (см. `.github/workflows/ci.yml`).

### Этап 2 — Завершение функциональности
- **Done.** Убраны заглушки: `VITE_PROGRAM_ID` fail-fast, `useLiveChain` читает `PresaleState`/`GameConfig` on-chain, `init-onchain` материализует казны/пул 550 POTATO.
- **Добавлено:** `batch_harvest` (1 tx вместо 10) + `close_field` (возврат rent) — удешевление чеканки; `verify_fields` anti-duplicate; `SKR_MINT` alias.
- **Тесты:** `tests/solana_potato.ts` покрывает initialize/fields/marketplace/referrals/admin/presale/quest/treasury — **33 passing**. Новые тесты для `batch_harvest`/`close_field`/duplicate-proof — добавить в Stage 2 (критерии в `MASTER-PROMPT-PRODUCTION.md` §2).

### Этап 3 — Экономика
- **Done.** `ECONOMY-AUDIT-2026-09-14.md` (без TG-крана) + симуляция `economy/simulate.py`.
- **Вердикт:** модель рабочая при `10–5k` активных (burn/mint 0.44, инфляция умеренная). При `≥50k` — кап душит (burn/mint 1.29–1.73, supply →0.5M). **Решение до mainnet:** динамика капа (`250k + 50*fields` или per-field кап) + buyback из казны.
- **Честно:** модель ≠ реальные игроки — **обязательна закрытая бета 20–50 игроков, 2–3 недели** (§7 ECONOMY-AUDIT).

### Этап 4 — Редизайн интерфейса
- **Done.** `UI-AUDIT-2026-09-14.md` — токены `theme/tokens.css`+`tokens.ts`, `ui/states.tsx` (`Spinner`/`LoadingState`/`ErrorState`/`EmptyState`), mobile-first (max 480), `withRetry`/`ErrorBoundary`. Остаток — консолидация трёх карточек/аниматоров — вне scope без визуальной регрессии.

### Этап 5 — Production-инфраструктура
- **Done (код):** CORS fail-fast, security headers (`CSP`, `X-Frame-Options`), `/health`+`/ready`, `rateLimit` прунинг, `epochRoller` метрики, `ComputeBudget` priority fee, `simulateTransaction` preflight.
- **Open (инфра):** платный RPC (Helius/Triton), деплой бэкенда (Fly.io/Render VM, не CF Workers — нужен keypair), бэкап БД (после M1 Postgres), CI — включить Actions в Settings, Squads multisig, upgrade authority.

---

## Что осталось / что нельзя проверить автоматически

| Категория | Что | Почему нельзя автоматом | Срок |
|-----------|-----|-------------------------|------|
| **Безопасность** | Внешний аудит (OtterSec/Sec3) | Агент ≠ аудитор | до mainnet |
| **Инфра** | Multisig + таймлок на `withdraw_*` | Требует Squads UI + ключи | M0 |
| **Экономика** | Замер sell_rate/retention на реальных 20–50 игроках | Модель — допущение | 2–3 нед бета |
| **Scale** | `getProgramAccounts` при >50k полей | Нужен индексер + load test | M1 |
| **SKR** | Mainnet-mint SKR или `skr_mint` в `GameConfig` | Требует токен-деплоя | M1 |
| **Compression** | ZK-compressed поля (300×) | Требует Merkle tree + Bubblegum CPI | M2 |
| **Тесты** | `batch_harvest`/`close_field`/duplicate field proof в `anchor test` | Нужен валидатор | Stage 2 |

---

## Экономический вердикт (цифры)

- **Потоки:** краны — только `harvest` (+ разовый 550 квест-пул), стоки — поле 100/250/500 + налог 6/нед×level×type + ремонт 15×level×type + апгрейд 100×level×type + комиссия 9–12% (60% burn).
- **Баланс (12 мес, steady state, churn 15%):**
  - 10 игроков: burn/mint 0.44, supply 0.10M, кап не режет.
  - 1k: 0.44, 10.2M, кап не режет.
  - 10k: 0.60, 52.7M, **режет**.
  - 100k: 1.73, 0.52M, **режет (голод)**.
- **Вывод:** модель — **pay-to-enter** (пресейл 0.25 SOL / 1053 SKR), без гиперроста цена модели →0 (как Axie без buyback). Казна (≤125 SOL + до 13M POTATO при 100k) — резерв для buyback, но механизма нет — нужен cron.

---

## Риски перед запуском (по критичности)

| Критичность | Риск | Митигация |
|-------------|------|-----------|
| **Blocker** | Один authority-ключ → drain казны | Squads 2/3 + таймлок |
| **Blocker** | Публичный RPC 429 при >100 игроков | Платный RPC (Helius) |
| **Important** | Кап 750k не масштабируется → голод при 50k+ | Динамика капа (field_count) до mainnet |
| **Important** | Бэкенд — single point roll_epoch | Uptime-алерт + payer баланс ≥0.1 SOL + cron 10 мин |
| **Important** | SKR только devnet | Mainnet mint или параметризовать |
| **Nice-to-have** | Progressive fee обходится дроблением | Order book v2 (M2) |

---

## Чек-лист «Тёплый прод» (что закрыто в этой ветке)

- [x] `verify_fields` duplicate-proof
- [x] `register_referrer` 5→50 POTATO
- [x] `LUNAR_TABLE` фронтенд = чейну
- [x] `SKR_MINT` экспорт + `TEST_SKR_MINT` alias
- [x] `batch_harvest` + `close_field` (дешёвая чеканка)
- [x] `CORS_ORIGIN` fail-fast, security headers, `/health`+`/ready`
- [x] `epochRoller` метрики + `ComputeBudget` + `simulateTransaction`
- [x] `GameContext` batch/close
- [x] Аудит-доки + этот отчёт
- [ ] Включить GitHub Actions (Settings → Actions → General) и прогнать `ci.yml`
- [ ] Прогнать `cargo test` + `anchor test` + `tsc` + `vite build` (требует solana 4.2.2, anchor 0.31.2, Node 22)
- [ ] Задеплоить бэкенд (Dockerfile + `PAYER_KEYPAIR_JSON` low-priv)

---

> **Дисклеймер:** код-ревью агентом — не замена профессиональному аудиту. Перед выводом реальных денег закажите внешний аудит (Neodyme/OtterSec/Sec3, $15–30k).

*Ветка: `arena/01a0bff0-ares1`, коммит: патчи 20.09.2026.*
