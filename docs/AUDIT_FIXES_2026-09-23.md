# AUDIT_FIXES — ares1, 2026-09-23

Карта исправлений по находкам аудита `PROMPT_AUDIT_FULL_STACK_V2.md` (R1
`Leo88q/ares1`, вердикт исходного аудита: no-go, 23 находки, порядок
F-01…F-23). Строка таблицы = статус; детали — разделы ниже. Исходный отчёт
`AUDIT_ares1_2026-09-23.md`/`.json` в репозиторий не коммитится (по регламенту
§2.4 промпта).

> **Реконструкция.** Файлы исходного отчёта уничтожены средой (вне зоны
> персистентности рабочей области) до начала фазы исправлений. Часть формулировок
> F-04, F-07, F-09, F-15, F-16, F-19, F-20, F-21, F-23 восстановлена
> повторным прицельным аудитом по указателям сессии и доменам промпта (см.
> пометку «реконструкция» в соответствующих разделах). F-01, F-02, F-03, F-05,
> F-06, F-08, F-10, F-11, F-13, F-14, F-17, F-22 опираются на сохранённые
> указатели сессии без дополнительной интерпретации.

## Карта находок

| ID | Статус | Изменение | Коммит |
|---|---|---|---|
| F-01 | ✅ fixed | CPI-guard для платного RNG (`assert_no_cpi_grind`, ошибка 6041) + host-тест | 187fe25 |
| F-02 | ✅ fixed | Two-step withdrawal (timelock, ATA-назначение), guardian pause-only + `update_guardian`, `migrate_admin_state` 97→145, GameConfig 228→260 во всём стеке | 187fe25 |
| F-03 | ✅ fixed | Лендинг: ложное «совпадает с живым devnet» → паритет только с кодом; закупочный текст SKR-only; ролл тира отнесён к SKR-рельсу (SOL-рельс buyer-chosen, в UI не подключён) | cf8d141 |
| F-04 | ✅ fixed (реконструкция) | Цена-телеметрия и платёжные формулировки лендинга без SOL-UI (App.tsx `0.25 SOL · …` → `1 053 SKR · …`; roadmap/QA «платежи SOL/SKR» → SKR; FAQ «альтернатива SOL» удалена) — все 6 локалей | cf8d141 |
| F-05 | ✅ fixed | Пресейл-секция: «20 % → buyback & burn» → истина кода «20 % → казна команды» (on-chain buyback отсутствует) | cf8d141 |
| F-06 | ✅ fixed | Рефералка: −1 % уходит **продавцу** (из комиссии), реферер +0.5 %; налог штрафа −15 % → **−50 %** (константа кода); эмиссия: урожаи + квесты + ½ налога маркета в казну («100 % игрокам» удалено) | cf8d141 |
| F-07 | 📋 operational | Хаб: `reports/ares1-audit.json` пустой (`files_scanned: 0`) — runbook ниже | этот документ |
| F-08 | ✅ fixed | `economy/simulate.py`: цена-«беглец» 3.3e+18 в committed-отчёте помечается «модель разошлась» (артефакт допущения, не прогноз); отчёт регенерирован | cf8d141 |
| F-09 | ✅ fixed | `docs/ECONOMY.md` §9: перечень эмитентов (урожай ~95–98 % > 40 % — отдельно), квесты = transfer, grant ≤10 % квота; пороги «спящей» прогрессивности (353.6M/+1 п.п.; realistic 52.75M → 2.022 %) | cf8d141 |
| F-10 | ✅ fixed | Backend: внешние алерты `ALERT_WEBHOOK_URL` — лестница 3/9/27 по провалам `roll_epoch` + fatal-баланс при старте; юнит-тесты 4/4 (сеть мокается) | cf8d141 |
| F-11 | ✅ fixed / residual задокументирован | Сырые результаты `npm audit`: watchtower **0**; landing **9 (3 high)** — все в транзитивном @solana-стеке, нефиксируемы без breaking downgrade (upstream: bigint-buffer — без патча, stream-json/uuid — ждут новой линии web3.js 1.x; версии >1.99.0 в 1.x нет); game `yarn audit` — TLS-эндпоинт недоступен из песочницы → **unverifiable локально** + advisory-шаг в CI (`continue-on-error`) | cf8d141 |
| F-12 | ✅ fixed | Этот файл: `docs/AUDIT_FIXES_2026-09-23.md` с картой F-01…F-23 | этот документ |
| F-13 | ✅ fixed | `simulate.py --check` (инварианты: 7 масштабов, формула налога, 9 закреплённых констант, пометка расхождения) + `yarn test:economy` в `ci-local.sh` → в CI | cf8d141 |
| F-14 | ✅ fixed | CSP в `landing/netlify.toml` (default-src self; script self; fonts google; connect = configured devnet RPC; frame-ancestors none) + существующие XFO/nosniff/referrer/permissions сохранены; TOML валиден | этот коммит |
| F-15 | ✅ fixed | Backend: `tests/security.test.ts` (4/4) + alert (4/4) = 8/8; landing: `tests/i18n-parity.test.mjs` (6 локалей × 366 ключей + t()-литералы) = 2/2; всё в `ci-local.sh` (backend test + landing npm ci/test/build) → в CI автоматически | этот коммит |
| F-16 | ✅ fixed (+ баг найден) | **Найден и исправлен баг:** landing `decodeConfig` читал текущий (260/228-байт) конфиг как legacy-156 (нет skr/reward, неверные смещения maxSupply/paused, нет guardian) → live-счётчики лендинга могли быть искажены; переписан в полный паритет web (+ `decodeEpoch` legacy-41 guard, + `adminState` PDA). Новый `tests/offchain/layoutParity.test.ts`: web×backend×landing на фикстурах 156/164/228/260 + PDA-паритет; общий `fixtures.ts`; offchain 69/69 | этот коммит |
| F-17 | ✅ fixed | `PresalePurchase.sol_amount` → нейтральный `amount`; watcher/IDL/фикстуры/карта событий синхронизированы (sha `bee20b8f…`) | 187fe25 |
| F-18 | ✅ fixed (advisory) | `cargo fmt --check` + `cargo clippy -D warnings` в program-job как `continue-on-error` шаги («flip to hard gates after first green run»); YAML валиден; локально не прогонялось (нет rust-тулчейна) → runbook ниже | этот коммит |
| F-19 | ✅ fixed / исторический residual | Реконструкция: в текущем дереве литералов ключей **нет** (в т.ч. в трёх «флагнутых» — читают `id.json`); ужесточено: три скрипта → `ANCHOR_WALLET` env/файл. Исторический exposure: runbook ниже, история не переписывается | этот коммит |
| F-20 | ✅ fixed | `HEALTHCHECK` в `apps/backend/Dockerfile` → `GET /live` на `${PORT:-8080}` (сверено с `env.ts`/`EXPOSE 8080`/`index.ts`); семантика endpoint-ов — в `docs/OPERATIONS.md` | этот коммит |
| F-21 | ✅ fixed | 11 файлов → `game/scripts/devnet-legacy/` + README; импорты/Anchor.toml исправлены (module-relative); устаревшие layout-комментарии обновлены; пути в `game/README.md`, `docs/AUDIT.md`, `docs/MIGRATIONS.md`; синтаксис всех 11 файлов проверен; `apps/web` чист | этот коммит |
| F-22 | ✅ fixed | `API.md`: 43/12/30/47, GameConfig 260 (+legacy), AdminState 145, legacy 156/164/228, строки `propose/cancel_withdrawal`/`update_guardian`/`migrate_admin_state`, таймлок-абзац, guardian в `set_paused`, buyback-формулировка; `MIGRATIONS.md`: 156/164/228→260 + AdminState 97→145; `AUDIT.md`: N2/N6/B3/кастодиальная строка. Dated-отчёты не тронуты | этот коммит |
| F-23 | ✅ fixed / частично human-decision | `ECONOMY.md` §10: ARPU/ARPPU/LTV/концентрация/retention — формулы+источники, все `нет данных`, CAC = requires human decision; `SECURITY.md`: reporting через GitHub private advisories (почта — human decision); landing privacy/terms — human decision | этот коммит |

## F-07 — хаб `Leo88q/Games-watchtower` (operational, runbook)

**Констатация.** В хабе `reports/ares1-audit.json` содержит
`{"findings": [], "files_scanned": 0, ...}`, на это же ссылается
`docs/ECOSYSTEM_MINIMUM_REQUIREMENTS.md` («реальный аудит (сейчас
files_scanned: 0)»). Фактически в игровом репозитории существует
неразметочный инвентарь `reports/ares1-audit.json` (21 токен
`init_if_needed`, тест CI `audit-init-if-needed.test.mjs` сверяет его с
`lib.rs`). Пустой хаб-файл — устаревшее/неверное свидетельство.

**Почему не починено в этом репо.** Хаб — отдельный репозиторий; по §1/§2
промпта эта сессия аудиторa — read-only по отношению к нему, изменения хаба
делает уполномоченная сессия/оператор.

**Runbook (hub PR):**
1. Сессия хаба: скопировать актуальные `reports/ares1-audit.json` +
   `reports/ares1-audit.md` из `Leo88q/ares1` в `Leo88q/Games-watchtower`
   (или заменить на ссылку на артефакт релиза).
2. Пересчитать сводные числа, зависящие от ares1-входа
   (`reports/DETAILED_6_GAMES.md`, `docs/ECOSYSTEM_MAXIMUM_TARGET.md`,
   `docs/ECOSYSTEM_MINIMUM_REQUIREMENTS.md` — строка `files_scanned: 0`).
3. Сверить адаптер `server/ingestion/game-adapters.js` (ares1-блок) с
   словарём событий после F-17: поле события `PresalePurchase.amount`
   (бывшее `sol_amount`) — убедиться, что маппинг не ссылается на старое имя.
4. Открыть PR в хаб; верификация = `npm test` хаба + ручная сверка чисел.

## F-11 — сырой вывод аудита зависимостей (2026-09-23)

```
watchtower: npm audit --omit=dev --audit-level=high  → found 0 vulnerabilities
landing:    npm audit --omit=dev --audit-level=high  → 9 vulnerabilities (6 moderate, 3 high)
            high: bigint-buffer (GHSA-3gc7-fjrx-p6mg, все версии, upstream-патча нет)
            moderate: stream-json (GHSA-528h…), uuid (GHSA-w5hq…) — транзитивно от
            @solana/web3.js@1.99.0 / jayson; `npm audit fix` предлагает только
            breaking-downgrade (web3.js@0.0.3 / spl-token@0.1.8) — НЕ применялся.
game (yarn): yarn audit --groups dependencies → TLS: endpoint недоступен из песочницы
            → unverifiable локально; advisory-шаг добавлен в CI (continue-on-error).
```

**Residual-risk решение:** транзитивные находки живут в браузерном бандле
декодера/провайдера RPC; апгрейд невозможен без breaking-миграции стека.
Принято: (а) зафиксировать фактический вывод (выше), (б) advisory-гейт в CI,
(в) runbook: при выходе web3.js 1.x с фиксом jayson-цепи или после миграции на
2.x — обновить и снять пометку; следить за патчем bigint-buffer.


## F-16 — найденный баг landing-декодера (реконструкция, детали)

До исправления `landing/utils/anchorClient.ts:decodeConfig` не имел ни проверки
размера, ни веток legacy/current: для 260-байтного devnet-конфига поля
`maxSupplyMicro/dailyMintCap/…/paused` читались со смещениями legacy-156
(мимо `skr_mint`/`reward_signer` 64 байт), `guardian` не читался вовсе.
Следствие: live-счётчики лендинга (supply/cap/paused) могли показывать
смещённые значения; `cfg.authority` (первое поле) совпадало, поэтому
транзакции не ломались. Исправление = побайтовый паритет с web/backend +
общий фикстурный тест `game/tests/offchain/layoutParity.test.ts`.

## F-19 — фактическое состояние (реконструкция)

- В рабочем дереве: **0 литералов** секретных ключей (grepp: `fromSecretKey`,
  32-int массивы, base58-88). Три «флагнутых» скрипта читали `id.json`;
  переведены на `ANCHOR_WALLET` env/файл.
- Исторические devnet-кошельки → runbook ниже (история не переписывается).

## F-18 — порядок ввода в эксплуатацию

1. Первый CI после push: advisory `cargo fmt`/`cargo clippy` отработают в
   журнале (continue-on-error → job зелёный).
2. Оба зелёные → убрать `continue-on-error` (строгий гейт).
3. Красные → починить в следующей серии (не блокирует этот push).

## Остаточные операционные пункты (из фазы исправлений, не находки)

- Push производится **один раз в конце серии** (решение оператора);
  Rust-тесты (`cargo test`) проверяются только CI после push.
- Приватные ключи, ранее зафиксированные в git-истории devnet-скриптов
  (F-19): значений в документе не приводится; **история не переписывается**
  (принятое решение) — до mainnet рекомендация репозитория-оператора:
  считать эти devnet-кошельки скомпрометированными, не переиспользовать,
  при необходимости — filter-repo только как внешняя рекомендация.
- Devnet-программа может отставать от HEAD: сверка = `check:contract` +
  `fetch-ci-idl.mjs` после каждого изменения `idl.json` + регенерация
  packaged IDL хаба (`watchtower/scripts/sync-idl.mjs`).
