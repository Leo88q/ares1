# Локальный прогон на Mac — пошагово

Проверяем ветку `arena/a85a7154-ares1` (PR #61): правки под хостинг бэкенда
(inline-keypair + advisory-lock) и весь остальной стенд репозитория.
Этапы идут по возрастанию: A и B обязательны, C и D — по желанию (нужен Docker Desktop).

## Диагностика (уже сделана ✅)

macOS 26.6.1 arm64 · Node v22.22.3 · Yarn 1.22.22 · Docker 29.8.0 + Compose v5.5.1 ·
Python 3.14.7 · git 2.55.0 — всё совпадает с требованиями (`ci-local.sh` проверяет
именно Node 22.22.3 и Yarn 1.22.22; `test:economy` использует только stdlib Python,
3.14 подойдёт). Ничего доустанавливать не нужно.

## A. Переключить клон на ветку PR

Клон уже есть — `~/LeoGamesStudio/ares1`:

```bash
cd ~/LeoGamesStudio/ares1
git status --short --branch     # ждём «чисто», без списка изменённых файлов
git fetch origin --prune
git switch arena/a85a7154-ares1 || git switch -c arena/a85a7154-ares1 origin/arena/a85a7154-ares1
git log --oneline -2            # ждём первым: db32a6d feat(backend): деплой без файловых секретов…
```

Опционально — паритет с CI (pre-commit сканер секретов, ставится на этот клон):

```bash
./scripts/install-git-hooks.sh
```

## B. Установка + быстрый прогон (2–4 мин) — это и проверяет наши правки

```bash
cd ~/LeoGamesStudio/ares1/game
yarn install --frozen-lockfile --non-interactive
(cd ../landing && npm ci --no-audit --no-fund)     # обязателен ДО тестов: test:offchain
yarn typecheck
yarn workspace backend test 2>&1 | tail -25
yarn test:guards 2>&1 | tail -12
yarn test:offchain 2>&1 | tail -12
yarn test:db:unit 2>&1 | tail -12
yarn check:unicode
```

| команда | ожидаем |
| --- | --- |
| `typecheck` | без ошибок (web + backend) |
| `backend test` | **80 / 80** (из них 15 новых — про keypair и замок) |
| `test:guards` | **52 / 52** |
| `test:offchain` | **101 / 101** |
| `test:db:unit` | ок |
| `check:unicode` | «Невидимых символов нет» |

## C. Postgres + полный прогон «как в CI»

```bash
cd ~/LeoGamesStudio/ares1/game
# game/.env локальный (в .gitignore). Если файл уже есть — не перезаписывай, покажи его.
printf 'GAME_OPS_POSTGRES_PASSWORD=localdev\nMIGRATION_DATABASE_URL=postgres://postgres:localdev@postgres:5432/ares1\n' > .env
docker compose up -d postgres && sleep 5 && docker compose ps   # postgres … (healthy)

MIGRATOR='postgres://postgres:localdev@127.0.0.1:5432/ares1'
yarn db:migrate --url="$MIGRATOR"
GAME_OPS_WRITER_PASSWORD=local-writer-dev-2026 GAME_OPS_READER_PASSWORD=local-reader-dev-2026 \
  yarn db:roles --url="$MIGRATOR" --writer-login=ares1_backend --reader-login=ares1_dash
yarn db:verify --url="$MIGRATOR"        # приёмка слоя: 17/17 ok (счётчик растёт с данными)
```

Затем — весь CI-набор + полный DB-стенд одной командой (10–20 мин: сборки, bench 2000 строк):

```bash
GAME_OPS_TEST_URL="$MIGRATOR" GAME_OPS_TEST_ROLE=game_ops_writer \
  ./scripts/ci-local.sh --skip-chain
```

`--skip-chain` пропускает только Anchor/Solana-часть (её отдельная установка — Solana CLI
4.2.2 + Anchor 0.31.2; в CI на этом коммите она уже зелёная). Внутри ci-local с заданным
`GAME_OPS_TEST_URL` пройдут: миграции → интеграционные 32 → мутации **7/7** → `db:verify` → bench.

Число проверок `db:verify` зависит от данных: на пустом стенде 17 (мутационные пробы
пропущены — нечего мутировать), после `db:bench` добавляются пробы по журналу, аудиту и
интентам. Пароли ролей — минимум 20 символов, это гейт в `db-roles.ts`; значения выше
понадобятся снова в `.env` бэкенда, поэтому они фиксированные, а не случайные.

Порт 5432 занят другим Postgres? Добавь в `game/.env` `GAME_OPS_POSTGRES_PORT=55432`
и поменяй порт в `MIGRATOR`.

## D. Доказательства обеих правок (пока Postgres поднят)

### D1. Inline-keypair — без сети и денег

```bash
cd ~/LeoGamesStudio/ares1/game
cat > .local-check-inline-key.mts <<'EOF'
import { Keypair } from '@solana/web3.js';
import { loadPayerSecretKey, parsePayerSecretKey } from './apps/backend/src/payerKey.ts';

const kp = Keypair.generate();
const inline = JSON.stringify(Array.from(kp.secretKey));
const bytes = loadPayerSecretKey(inline, () => { throw new Error('readFile must not be called'); });
console.log('1) inline-JSON принят :', Keypair.fromSecretKey(bytes).publicKey.toBase58() === kp.publicKey.toBase58());
try {
  parsePayerSecretKey('[1,2,3]');
  console.log('2) битое значение     : НЕ отклонено (баг!)');
} catch (e) {
  const msg = (e as Error).message;
  console.log('2) битое значение     : отклонено —', /64/.test(msg) ? 'сообщение про 64 элемента' : msg);
}
EOF
yarn tsx .local-check-inline-key.mts && rm .local-check-inline-key.mts
```

Ждём: `1) inline-JSON принят : true` и `2) битое значение : отклонено — сообщение про 64 элемента`.

### D2. Advisory-lock на живом Postgres (два терминала)

Ключ `418531078961` = `0x6172657331` (ASCII «ares1») — ровно `EPOCH_ROLLER_LOCK_KEY`.

Терминал A:
```bash
cd ~/LeoGamesStudio/ares1/game && docker compose exec postgres psql -U postgres -d ares1
# внутри: SELECT pg_try_advisory_lock(418531078961);   → t  (замок наш)
```
Терминал B (пока A открыт):
```bash
cd ~/LeoGamesStudio/ares1/game && docker compose exec postgres psql -U postgres -d ares1 \
  -c "SELECT pg_try_advisory_lock(418531078961);"        # → f  (занято другим соединением)
```
Закрыть A (`\q`), повторить команду из B → снова `t` (замок освободился вместе с сессией).

## Грабли на macOS

| Симптом | Что делать |
| --- | --- |
| `Use Node 22.22.3` в `ci-local.sh` | brew дал другую 22.x → `fnm install 22.22.3 && fnm use 22.22.3` |
| `Use Yarn 1.22.22` | `npm i -g yarn@1.22.22` |
| `test:offchain` падает на импортах | не установлен `landing/node_modules` → `(cd ../landing && npm ci)` |
| `db:roles` → «Пароль роли короче 20 символов» | гейт длины в `db-roles.ts`; берите ≥20 символов |
| `docker compose` → «env file …/apps/backend/.env not found» | для одного `postgres` безвредно; для полного стека создайте файл из `apps/backend/.env.example` |
| `postgres` не healthy | занят 5432 → `GAME_OPS_POSTGRES_PORT=55432` в `game/.env` |
| `yarn install` долго на Apple Silicon | нормально (нативные сборки), ~1 мин на M-серии |

## Что дальше (после D)

- бэкенд целиком (нужен свежий devnet-кошелёк с ≥0.01 SOL, отдельный от authority);
- `docker compose up -d --build` — полный стек с миграциями и healthcheck (упражняет Dockerfile);
- локальный UI: лендинг на 5173 (проксирует `/api` на `127.0.0.1:8080`), игра на 5175.
