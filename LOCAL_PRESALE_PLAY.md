# Ручной прогон: пресейл + игра на devnet (локально, macOS)

Проверяем Фазу 1 руками: бэкенд ↗ лендинг с формой ↗ реальный перевод в devnet ↗
выдача пакета ↗ игра. Порт бэкенда — **8081** (8080 на машине занят).

Стенд: Postgres уже поднят (`docker compose up -d postgres`), миграции применены,
логины `ares1_backend` / `ares1_dash` созданы.

## 1. Ключ payer'а (НИЗКОпривилегированный, НЕ authority)

Бэкенд refuses payer = authority/reward_signer при старте (`assertDedicatedPayer`),
поэтому нужен отдельный devnet-кошелёк.

```bash
cd ~/LeoGamesStudio/ares1/game
cat > .local-gen-key.mts <<'EOF'
import { Keypair } from '@solana/web3.js';
import { writeFileSync } from 'node:fs';
const kp = Keypair.generate();
writeFileSync('apps/backend/keys/devnet-payer.json', JSON.stringify(Array.from(kp.secretKey)));
console.log('pubkey:', kp.publicKey.toBase58());
console.log('inline:', JSON.stringify(Array.from(kp.secretKey)));
EOF
yarn tsx .local-gen-key.mts && rm .local-gen-key.mts
```

Адрес из вывода — пополнить на **0.05–0.1 SOL** через `https://faucet.solana.com`
(devnet). Это тестовые деньги.

## 2. `apps/backend/.env` (файл локальный, в .gitignore)

```bash
cat > apps/backend/.env <<'ENV'
PORT=8081
RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf
# inline-JSON массива из 64 чисел (строка из шага 1) — файл не нужен вовсе
PAYER_KEYPAIR_JSON=[12,34,...,64-е число]
PAYER_MAX_LAMPORTS=50000000
CORS_ORIGIN=http://localhost:5173,http://localhost:5175
# Прокси нет: иначе X-Forwarded-For подделывается и лимитер/аудит врут
TRUST_PROXY=false
GAME_OPS_DATABASE_URL=postgres://ares1_backend:local-writer-dev-2026@127.0.0.1:5432/ares1
GAME_OPS_DB_ROLE=game_ops_writer
ADMIN_API_TOKEN=<придумай ≥32 символов>
EPOCH_ROLL_CRON=*/10 * * * *
ENV
```

## 3. Три процесса (три терминала)

```bash
# 1) бэкенд
cd ~/LeoGamesStudio/ares1/game && yarn dev:backend

# 2) лендинг с формой пресейла — прокси /api идёт на 8081
cd ~/LeoGamesStudio/ares1/landing && PRESALE_API_ORIGIN=http://127.0.0.1:8081 npm run dev

# 3) игра
cd ~/LeoGamesStudio/ares1/game && echo 'VITE_BACKEND_URL=http://localhost:8081' > apps/web/.env.local
cd ~/LeoGamesStudio/ares1/game && yarn dev:web
```

Проверки, что всё живо:

```bash
curl -s localhost:8081/live            # {"ok":true}
curl -s localhost:8081/health | head   # payerSol ≈ 0.05–0.1, programId, epoch
```

Адреса: лендинг **http://localhost:5173**, игра **http://localhost:5175**.

## 4. Открыть тираж (0.001 SOL за пак «4 Луга» = 1000 🥔)

```bash
cd ~/LeoGamesStudio/ares1/game
export GAME_OPS_DATABASE_URL='postgres://ares1_backend:local-writer-dev-2026@127.0.0.1:5432/ares1'
export ADMIN_API_TOKEN='<тот же, что в .env>'
PRESALE_RUN_ID=wave1 PRESALE_PACK_ID=meadow-4 PRESALE_CURRENCY=sol \
PRESALE_PRICE_UNITS=1000000 PRESALE_CAP=50 PRESALE_RESERVE_MINUTES=30 \
PRESALE_TREASURY=<твой devnet-кошелёк казначейства, 32–44 символа> \
  yarn presale:open-run
```

Цена — тестовая: 1 000 000 лампортов = 0.001 SOL. Пыль (номер заказа) добавляется
к цене: переводить нужно **ровно `payUnits`**, а не `price_units`.

## 5. Покупка руками

Открыть **http://localhost:5173**, дойти до формы пресейла:

1. кошелёк (devnet) → **Зарезервировать**;
2. форма покажет точную сумму и кошелёк-получатель;
3. перевести ровно эту сумму из Phantom (Testnet Mode) и вставить подпись;
4. статус заказа: `reserved → payment_seen → paid`.

Что смотреть: счётчик мест в баннере тиража (`GET /api/presale/runs/wave1`),
уникальность номера заказа, что email и кошелёк в публичном статусе **не**
светятся (`GET /api/presale/runs/wave1/orders/1` отдаёт только валюту).

```bash
curl -s -H "Authorization: Bearer $ADMIN_API_TOKEN" localhost:8081/api/presale/admin/pending
curl -s -XPOST -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  localhost:8081/api/presale/admin/orders/<id>/verify     # сверяет перевод по цепи
```

## 6. Выдача: где заканчивается автоматика

`POST /api/presale/admin/orders/<id>/deliver` **не отправляет транзакцию** — он
создаёт интент выдачи (`grant_reward_once`, PDA `[b"reward", ata, nonce]`, nonce =
id заказа, то есть повторная выдача того же заказа невозможна ончейн).

Отправить её некому: воркера-подписанта в бэкенде **нет** (`buildGrantRewardOnceIx`
не имеет ни одного вызывающего места). Право подписи — только у authority или
reward_signer, а бэкенд принципиально не держит эти ключи. Значит, последний шаг —
ручной, ключом authority/reward_signer; это осознанный human-in-the-loop, а не
недоделка.

После ончейн-подтверждения:

```bash
curl -s -XPOST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"signature":"<подпись>"}' localhost:8081/api/gameops/intents/<intentId>/submitted
curl -s -XPOST -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  localhost:8081/api/gameops/intents/<intentId>/confirmed
curl -s -XPOST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"intentId":<intentId>}' localhost:8081/api/presale/admin/orders/<id>/delivered
```

## 7. Играем

На кошельке 1000 🥔 → в игре (5175) покупаем поля и проходим по кнопкам:
сбор урожая, налог, ремонт, удобрение, улучшение, рынок, нашивки, журнал.

## Уборка

```bash
docker compose down        # Postgres остановить, данные останутся
docker compose down -v     # и данные тоже
rm -f apps/web/.env.local  # вернуть игру на публичные devnet-значения
```
