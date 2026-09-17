# 🥔 Solana Potato

On-chain фарм-игра на Solana с реальной экономикой: поля, урожай $POTATO, P2P-маркетплейс за SOL, PWA-дApp для Solana dApp Store.

Монорепо: Anchor-программа · React/Vite dApp (PWA) · Express-бэкенд эпох и конфига · релиз в Solana dApp Store.

> Это игра, а не инвестиционный продукт. Перед mainnet обязателен внешний аудит (см. [docs/AUDIT.md](docs/AUDIT.md)).

## Структура

```
programs/solana_potato/     Anchor 0.30.1 программа (Rust) — 19 инструкций, 6 типов аккаунтов
apps/web/                   PWA / dApp (React 18 + Vite 5 + wallet-adapter) — целим в Solana dApp Store
apps/backend/               Сервис эпох и конфига: держит authority-ключ, роллит эпохи, отдаёт on-chain config
tests/                      Интеграционные тесты anchor test (ts-mocha)
scripts/                    deploy-local/devnet/mainnet, init-onchain, build-apk
economy/                    simulate.py — годовая симуляция экономики; model.csv — старая ручная модель
docs/                       AUDIT · ECONOMY · API · USER_GUIDE · MARKETING · ROADMAP · dapp-store-release
libs/                       sentinel, solana-tx-guard — отдельные репозитории (gitlinks), не часть сборки
```

Документы: [Аудит безопасности](docs/AUDIT.md) · [Экономика и симуляция](docs/ECONOMY.md) · [API программы и бэкенда](docs/API.md) · [Руководство игрока](docs/USER_GUIDE.md) · [Маркетинг](docs/MARKETING.md) · [Roadmap на 6 месяцев](docs/ROADMAP.md).

## Как это работает

* **GameConfig** (PDA `["config"]`) — mint authority токена $POTATO. Минт возможен только через `harvest` (урожай) и `grant_reward` (квесты, только backend), в пределах дневного капа эпохи (≤ 250 000 🥔) и max supply (1 млрд).
* **Поля** трёх типов (100 / 250 / 500 🥔) накапливают урожай до 48 часов; налог раз в 7 дней, износ, удобрения, 50 уровней. Все траты **сжигаются**.
* **Маркетплейс**: escrow-ордера 🥔 за SOL, TTL 24 ч, комиссия 3–12 % (60 % сжигается, 40 % в казну), запрет self-trade, кулдаун 3 ч после отмены.
* **Эпохи** по 24 ч ротируются кем угодно (`roll_epoch`), бэкенд делает это кроном.
* **Награды** за квесты — он-чейн пул (550 POTATO в GameConfig); путь выдачи (claim) включается в следующем релизе. Рефералка — on-chain (−1 % комиссии приглашённому, +0.5 % рефереру за каждую сделку; идентичность — кошелёк).

Формулы, баланс и результаты симуляции — в [docs/ECONOMY.md](docs/ECONOMY.md).

## Требования

| Инструмент | Версия | Примечание |
|---|---|---|
| Rust | stable ≥ 1.79 | host-юниттесты |
| Solana CLI (Agave) | **4.2.x** (platform-tools ≥ v1.5) | `Cargo.lock` v4; 1.18.x не соберёт |
| Anchor | **0.30.1** через avm | `Anchor.toml [toolchain]` пинит `solana_version = "4.2.2"` — иначе avm подменит тулчейн на 1.18 |
| Rust nightly для IDL | `nightly-2025-03-01` | Anchor 0.30.1 строит IDL каналом `nightly`; nightly новее апреля 2025 не имеет `proc_macro::SourceFile`. Установите датированный nightly и слинкуйте его как `nightly` (`ln -sfn ~/.rustup/toolchains/nightly-2025-03-01-* ~/.rustup/toolchains/nightly-<host>`). `proc-macro2` запинен в `Cargo.lock` на 1.0.94 по той же причине |
| Node | 20+ и yarn 1.22 (corepack) | workspaces: web, backend |
| Python | 3.10+ | только для `economy/simulate.py` |

## Быстрый старт

```bash
yarn install                       # все workspaces
cargo test -p solana_potato --lib  # 13 юниттестов чистых функций
anchor build                       # target/deploy/solana_potato.so + target/idl/solana_potato.json
anchor test                        # локальный валидатор + tests/solana_potato.ts (~2 мин, есть ожидание 61 с)
cp target/idl/solana_potato.json apps/web/src/idl.json   # после изменения программы
yarn typecheck                     # web + backend
yarn build:web                     # apps/web/dist
python3 economy/simulate.py        # отчёт по экономике в markdown
```

### Деплой и инициализация

```bash
bash scripts/deploy-devnet.sh      # anchor build + keys sync + deploy (upgrade authority — ваш кошелёк)
ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com \
PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf yarn init-onchain
```

`init-onchain` создаёт mint (6 decimals, без freeze authority), передаёт mint authority PDA `config`, вызывает `initialize` + `init_epoch`. Скрипт идемпотентен. `initialize` отклонит mint с чужим authority, другим числом decimals или freeze authority.

Текущий devnet: программа `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf` (развёрнута 14.09.2026 через `scripts/warm-start-devnet.sh`), upgrade authority `HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9` (ключ вне git). Инициализация: GameConfig PDA `9FDhkBwmcNx3gh8hSgShpiAVXHW9cZBnv4t1xyHGU39q`, $POTATO mint `HFEL9rBqmYwYDsZNxuV2ZonfS7adbjENUc3CdgbaiYxv` (6 decimals, без freeze authority, authority = config PDA), пресейл cap 500 / 0.25 SOL / 1053 SKR. Старый devnet-стейт программы `48D2…` (GameConfig `2W5Lxv…`) не мигрирован и abandoned — инструмент `apps/web/migrate-devnet.mjs` относится только к нему.

### Фронтенд

```bash
cd apps/web && cp .env.example .env    # VITE_SOLANA_CLUSTER, VITE_RPC_URL, VITE_PROGRAM_ID, VITE_BACKEND_URL
yarn dev                                # http://localhost:5173
yarn build                              # dist/ → любой статический HTTPS-хостинг
```

Публичный RPC отдаёт 429 уже при десятках игроков — используйте Helius/Triton/QuickNode. Фронт делает один опрос на провайдер (20–30 с), ставит паузу в скрытой вкладке и делает backoff при 429.

### Бэкенд

```bash
cd apps/backend && cp .env.example .env   # RPC_URL, PROGRAM_ID, PAYER_KEYPAIR_JSON (не authority!), CORS_ORIGIN
mkdir -p keys && cp <admin-keypair.json> keys/
yarn build && yarn start                  # или docker compose up -d backend
curl localhost:8080/health
```

Эндпоинты и правила — [docs/API.md](docs/API.md).

### Solana dApp Store

[docs/dapp-store-release.md](docs/dapp-store-release.md) — PWA → TWA через Bubblewrap и сабмит на publish.solanamobile.com.

## CI

`.github/workflows/ci.yml`: `cargo test` → `anchor build` → проверка, что `apps/web/src/idl.json` совпадает с IDL сборки → `anchor test`; отдельно `tsc` + `vite build` для web и `tsc` для backend.

**Локальный CI** (когда GitHub Actions недоступен/не оплачен) — та же последовательность команд на своей машине:

```bash
cd game
./scripts/ci-local.sh                # всё: unit + anchor build + IDL + validator + web + backend
./scripts/ci-local.sh --skip-chain   # только web + backend (быстро)
./scripts/ci-local.sh --skip-validator  # без локального валидатора
```

Версии, как в CI: solana-cli `4.2.2`, anchor `0.31.2`, rustc `1.97.1`, Node `22`.

## Безопасность — коротко

* Все токен-аккаунты и mint проверяются (`token::mint`, `token::authority`, `has_one = potato_mint`); PDA с сохранёнными bump.
* Двухшаговая передача authority; пауза блокирует минт и траты, но не возвраты.
* Ключ authority живёт только на сервере; клиент не может вызвать `grant_reward`.
* Открытые пункты до mainnet: мультисиг для authority, таймлок на `withdraw_treasury`, внешний аудит — [docs/AUDIT.md §5](docs/AUDIT.md).

## Проверено (04.09.2026)

| Проверка | Результат |
|---|---|
| `cargo test -p solana_potato --lib` | 13 passed |
| `anchor build` (Agave 4.2.2, platform-tools v1.54, Anchor 0.30.1) | ок: `.so` 489 400 байт, без предупреждений о стеке; IDL совпадает со старым по всем 19 инструкциям (добавлены только события и ошибки 6022–6029) |
| `anchor test` (локальный валидатор 4.2.2) | **28 passing** (1 мин) |
| Compute units (макс. по логам валидатора) | fill_order 80 172 · create_sell_order 42 748 · create_field 15 966 · harvest 13 361 · остальные < 22 000 |
| `tsc --noEmit` web / backend | 0 ошибок |
| `vite build` | ок, ~290 KB gzip, 4 lazy-экрана + 5 vendor-чанков |
| `python3 economy/simulate.py` | ок |
| Redeploy devnet (`solana program extend` + `deploy`) | ок, слот 493194605, tx `29V5xNzs3MqQHjJS7tGyfFCz5cPaeLNmQMgWuGZPeHzXHD63cj5WoTaeeuG7WpWJ4Vyeeubg4MxmHsas5jMPGaCj` |

## Лицензия

Не указана — добавьте перед публичным релизом.
