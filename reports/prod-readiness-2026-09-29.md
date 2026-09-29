# ARES-1 — готовность к продакшен-деплою, проверка 29.09.2026

Ветка: `arena/01a0ecc6-ares1` · метод: прогон всех автоматических гейтов репозитория
в песочнице + проверка настроек GitHub через API. Сеть до `ares1.is-a.dev`,
до yarn-registry и до Rust/Solana-тулчейна из песочницы недоступна — что нельзя
было проверить, помечено явно.

## Вердикт

| Контур | Готов? |
|---|---|
| Клиент игры на **devnet** (Cloudflare Pages `ares1-play`) | **Да**, после фикса CI ниже |
| Лендинг на прод | **Да**, кроме юридических заглушек |
| Игра на **mainnet / реальные средства** | **Нет.** Gate не пройден, блокеры организационные |

Сам репозиторий это и декларирует: `reports/ares1-audit.md` — «audit gate — NOT PASSED»,
`game/docs/MAINNET_LAUNCH_GATE.md` — «mainnet не запущен, gate не пройден»,
README — «No real-funds/mainnet readiness is claimed».

## Что прошло (прогнано сейчас)

| Проверка | Результат |
|---|---|
| `tsc --noEmit` (game/web, landing, tsconfig.tools) | чисто |
| `vite build` game/web и landing | собираются |
| `tests/offchain` | 92/92 |
| `security-guards.test.mjs` (трипваер версий web3.js) | 32/32 |
| backend tests | 21/21 |
| `tests/db/gameops-unit` | пройдены |
| `economy/simulate.py --check` | OK (7 шкал, 9 пиннутых констант) |
| `check-contract.mjs` | 43 инструкции совпадают |
| `check-invisible-unicode` | чисто |
| i18n-паритет (лендинг + игра) | 3/3 и 3/3, русского в переводах нет |
| `secret-scan.mjs` (рабочее дерево) | 0 находок |
| `build-legal-pages.mjs --check` | не устарели |

## Блокеры

### 1. CI был красный на `main` ~16 часов — исправлено и проверено
Все джобы падали на `yarn install --frozen-lockfile`: корневой `game/package.json`
объявляет `"@solana-mobile/wallet-adapter-mobile": "^2.1.5"`, а запись в `yarn.lock`
перечисляла только `2.1.5` и `^2.2.0`. Спецификатор добавлен, разрешаемая версия не изменилась.
Прогон `CI #36561243186` на этой ветке — **все 6 джобов зелёные**, включая Anchor
(build + unit + integration, 8m21s), backend-контейнер и гейт артефактов сборки.
На `main` фикс ещё не влит.

### 2. Секреты и настройки репозитория (🔴, только человек)
- Ключ Helius RPC был закоммичен в историю публичного репозитория — **ротация обязательна**,
  переписывание истории её не заменяет. (`docs/PRODUCTION_DEPLOY_CHECKLIST.md` S-01)
- `private: false`, `branch main protected: false`, Dependabot alerts выключены —
  проверено сейчас через `gh api`. Защита ветки и secret scanning не включены.
- Историю проверить не удалось: клон shallow (`git fetch --unshallow` + `secret-scan-history.mjs`).

### 3. Юридические страницы не заполнены (🔴, человек + юрист)
26 заглушек `todo` осталось: `privacy.html` — 18, `terms.html` — 4, `dmca.html` — 2,
`third-party.html` — 2; плюс `[НАИМЕНОВАНИЕ ОПЕРАТОРА]` в футере лендинга.
Пресейл со случайным тиром + реферальные бонусы — вопрос квалификации актива, нужен юрист.

### 4. Mainnet-гейт (🔴)
Ничего из G-2…G-6 не подтверждено: upgrade authority не переведён на Squads ≥3-из-N
(`program-inventory.json`: `expectedUpgradeAuthority: null`, `deployedAt: null`),
воспроизводимость сборки не сверена, независимого аудита контракта нет
(`sentio`/`solguard`/`slam` в отчёте не запускались), watchtower devnet-верификация
падает с `INVALID_CONFIG`. `grant_reward` без nonce-PDA — эндпоинт наград открывать нельзя.

### 5. Не проверяемое из песочницы (перед деплоем сделать вручную)
- Заголовки и публичная экспозиция на живом хосте: `scripts/check-headers.sh`,
  `scripts/check-public-exposure.sh` — ни один заголовок ещё не подтверждён на проде.
- Настройки Cloudflare Pages (root dir, build, output) — выведены из netlify.toml, не наблюдались.
- Анкор-часть: Rust/Solana-тулчейна в песочнице нет, `cargo test` / `anchor build` не прогонялись.
- `check-release-artifacts.mjs` дал 3 FAIL по чанку `wallets-*.js` (fonts.googleapis.com,
  fonts.gstatic.com, `http://localhost`) — но это артефакт моей npm-установки:
  yarn-registry недоступен, npm разрешил дерево иначе и втянул `@reown/appkit-ui`.
  Перепроверено в CI после фикса lockfile: джоб «Build output gate (no secrets, maps or
  CDN in dist/)» — **зелёный**, то есть находки были ложными.

### 6. Известные принятые риски
`bigint-buffer` (GHSA-3gc7-fjrx-p6mg) без фикса; `style-src 'unsafe-inline'` в обеих CSP;
бандл лендинга 1.13 MB / 364 kB gzip одним чанком; клиентские зеркала экономики опубликованы.

## Минимальный порядок действий

1. Дождаться зелёного CI после фикса lockfile.
2. Ротировать ключ Helius; включить branch protection, secret scanning, Dependabot alerts.
3. Заполнить юридические страницы и данные оператора.
4. Деплой на devnet → прогнать `check-headers.sh` и `check-public-exposure.sh` по живым хостам.
5. Только после G-2…G-6 и внешнего аудита — разговор про mainnet.
