#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  ARES-1 «тёплый старт» on devnet — одна команда
#
#   1. доливает SOL деплоеру (airdrop с ретраями)
#   2. anchor build
#   3. деплой:
#        - есть target/deploy/solana_potato-keypair.json → UPGRADE существующей
#          программы (тот же program id, состояние сохраняется → запустить
#          `npm run migrate-v2` СРАЗУ после, см. шаг 3.1);
#        - нет кеystore → НОВЫЙ program id, чистое состояние
#   4. патчит .env / Anchor.toml под новый program id
#   5. init-onchain (идемпотентный): mint, config, epoch, presale,
#      treasury_sol, quest-казна (550 🥔), SKR-ATA
#   6. сводка для копирования
#
#  Использование:
#    ./scripts/warm-start-devnet.sh
#
# Переменные окружения (опционально):
#    ADMIN_KEYPAIR  путь к ключу деплоера   (по умолчанию ~/.config/solana/id.json)
#    RPC_URL        RPC для деплоя и init-onchain (свой, например Helius;
#                   по умолчанию публичный https://api.devnet.solana.com)
#    BUFFER_KEYPAIR путь к ключу буфера неудачного деплоя (12 слов из его вывода
#                   → solana-keygen recover -o файл) — продолжить деплой на том же
#                   буфере, не тратя новые ~3.4 SOL
#    PRESERVE_STATE 1 = после upgrade выполнить migrate-v2 (старые аккаунты → v2 layout)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
PRESERVE_STATE="${PRESERVE_STATE:-0}"
KEYPAIR_FILE=target/deploy/solana_potato-keypair.json

command -v anchor >/dev/null 2>&1 || { echo "✖ anchor не найден. Установка: cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.30.1 && avm use 0.30.1"; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "✖ solana CLI не найден. Установка: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""; exit 1; }
command -v cargo  >/dev/null 2>&1 || { echo "✖ Rust (cargo) не найден — нужен для anchor build. Установка: https://rustup.rs"; echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }
[ -f "$ADMIN_KEYPAIR" ] || { echo "✖ Ключ деплоера не найден: $ADMIN_KEYPAIR (создай: solana-keygen new)"; exit 1; }
[ -f "$ADMIN_KEYPAIR" ] || exit 1

ADMIN=$(solana address --keypair "$ADMIN_KEYPAIR")
export ADMIN_KEYPAIR_PATH="$ADMIN_KEYPAIR"

echo "════════ ARES-1 warm start (devnet) ════════"
echo "Deployer: $ADMIN"

# ── 0) Пре-чек: программа уже задеплоена? (при пере-запуске — пропустим деплой) ──
ALREADY_DEPLOYED=0
PRE_ID=$(solana address --keypair "$KEYPAIR_FILE" 2>/dev/null || true)
if [ -n "$PRE_ID" ] && solana program show "$PRE_ID" --url "$RPC_URL" 2>&1 | grep -q "Program Data Address"; then
  ALREADY_DEPLOYED=1
fi

# ── 1) Funding ──
# Deploy новой программы стоит ~3.45 SOL (rent за program data) + init ~0.1 + fee.
# Если программа уже на devnet — для init-onchain хватает ~0.6 SOL.
if [ "$ALREADY_DEPLOYED" = "1" ] && [ -z "${FORCE_DEPLOY:-}" ]; then
  NEED_LAMPORTS=600000000
  echo "==> 1/6 Funding (программа уже задеплоена, нужно ≥ 0.6 SOL)..."
else
  NEED_LAMPORTS=4000000000
  echo "==> 1/6 Funding deployer (нужно ≥ 4 SOL)..."
fi
LAMPORTS=$(solana balance --lamports "$ADMIN" --url devnet | awk '{print $1}')
TRIES=0
while [ "$LAMPORTS" -lt "$NEED_LAMPORTS" ] && [ "$TRIES" -lt 4 ]; do
  TRIES=$((TRIES + 1))
  if solana airdrop 2 "$ADMIN" --url devnet >/dev/null 2>&1; then
    LAMPORTS=$(solana balance --lamports "$ADMIN" --url devnet | awk '{print $1}')
    echo "    airdrop ok, balance: $((LAMPORTS / 1000000000)).$((LAMPORTS % 1000000000 / 100000000)) SOL"
  else
    echo "    airdrop не прошёл (лимит faucet?), retry $TRIES/4 через 30s..."
    sleep 30
  fi
done
[ "$LAMPORTS" -ge "$NEED_LAMPORTS" ] || {
  echo "✖ Не набралось $((NEED_LAMPORTS / 1000000000)).$((NEED_LAMPORTS % 1000000000 / 100000000)) SOL (сейчас $((LAMPORTS / 1000000000)).$((LAMPORTS % 1000000000 / 100000000)))."
  echo "  Devnet-faucet имеет дневной лимит — докинь SOL вручную ($ADMIN) или повтори позже."
  echo "  Лайфхак: неудачные деплои оставляют 'буферы' с ~3.4 SOL. Варианты:"
  echo "    (a) продолжить деплой на буфере (новые SOL не тратятся):"
  echo "        solana-keygen recover -o ~/buffer1.json   (по одному вводить 12 слов из вывода деплоя)"
  echo "        BUFFER_KEYPAIR=~/buffer1.json RPC_URL=<твой rpc> ./scripts/warm-start-devnet.sh"
  echo "    (b) забрать лампорты себе:"
  echo "        solana program close <адрес буфера из вывода> --keypair ~/buffer1.json"
  exit 1
}
LAMPORTS=$(solana balance --lamports "$ADMIN" --url devnet | awk '{print $1}')
echo "    balance: $((LAMPORTS / 1000000000)).$((LAMPORTS % 1000000000 / 100000000)) SOL"

# ── 2) Build ──
echo "==> 2/6 anchor build..."
anchor build
# держим закоммиченный IDL синхронным (errors.ts фронта читает его)
cp target/idl/solana_potato.json apps/web/src/idl.json
echo "    idl synced → apps/web/src/idl.json"

# ── 3) Deploy ──
echo "==> 3/6 Deploying to devnet..."
UPGRADE=0
if [ -f "$KEYPAIR_FILE" ]; then
  UPGRADE=1
  echo "    keystore найден: если программа уже была задеплоена этим ключом — будет upgrade (состояние сохранится, migrate-v2 при PRESERVE_STATE=1); иначе — новый program id"
fi
# Не через `anchor deploy`: anchor 0.30 жёстко прокидывает solana CLI URL из
# своего cluster-маппинга (devnet → api.devnet.solana.com), а повторный --url
# старый solana CLI (1.18) отклоняет. Делаем то же, что anchor, напрямую —
# с одним --url (свой RPC, если задан).
#
# Devnet под нагрузкой: чанки записи в буфер часто не успевают в блок
# ("N write transactions failed"). Поэтому:
#   1) priority fee + ретраи (если версия CLI поддерживает);
#   2) авт-ретраи деплоя: 12 слов нового буфера парсятся из вывода, ключ
#      восстанавливается без интерактива (--stdin), следующий проход
#      продолжается на том же буфере (--buffer) — уже записанные чанки
#      CLI сам пропускает, новые ~3.4 SOL не тратятся.
[ -f "$KEYPAIR_FILE" ] || solana-keygen new -o "$KEYPAIR_FILE" --no-bip39-passphrase
DEPLOY_URL="${RPC_URL:-https://api.devnet.solana.com}"
# Флаги подбираем под версию CLI (v4.x переименовал --with-compute-unit-price
# в --compute-unit-price; там же появился --use-rpc — шлём write-транзакции
# через RPC, а не напрямую в TPU валидаторов: прямой TPU-путь из некоторых
# сетевых локаций unreliable (буфер создавался через RPC, а все writes падали).
SOL_DEPLOY_HELP="$(solana program deploy --help 2>&1)"
DEPLOY_EXTRA=""
if printf '%s' "$SOL_DEPLOY_HELP" | grep -q "compute-unit-price"; then
  if printf '%s' "$SOL_DEPLOY_HELP" | grep -q "with-compute-unit-price"; then
    DEPLOY_EXTRA="$DEPLOY_EXTRA --with-compute-unit-price 100000"
  else
    DEPLOY_EXTRA="$DEPLOY_EXTRA --compute-unit-price 100000"
  fi
fi
printf '%s' "$SOL_DEPLOY_HELP" | grep -q "max-sign-attempts" && DEPLOY_EXTRA="$DEPLOY_EXTRA --max-sign-attempts 60"
printf '%s' "$SOL_DEPLOY_HELP" | grep -q "use-rpc" && DEPLOY_EXTRA="$DEPLOY_EXTRA --use-rpc"
DEPLOY_BUFFER=""
if [ -n "${BUFFER_KEYPAIR:-}" ]; then
  DEPLOY_BUFFER="--buffer $BUFFER_KEYPAIR"
  echo "    Продолжаем деплой на существующем буфере: $BUFFER_KEYPAIR"
fi

deploy_once() {
  # shellcheck disable=SC2086
  solana program deploy \
    --url "$DEPLOY_URL" \
    --keypair "$ADMIN_KEYPAIR" \
    --program-id "$KEYPAIR_FILE" \
    $DEPLOY_EXTRA $DEPLOY_BUFFER \
    target/deploy/solana_potato.so
}

best_effort_fund() {
  local bal
  bal=$(solana balance --lamports "$ADMIN" --url devnet 2>/dev/null | awk '{print $1}') || return 0
  if [ -n "$bal" ] && [ "$bal" -lt 3500000000 ]; then
    echo "    Баланс низкий ($((bal / 1000000000)).$((bal % 1000000000 / 100000000)) SOL) — пробую airdrop..."
    solana airdrop 2 "$ADMIN" --url devnet >/dev/null 2>&1 || echo "    (airdrop не прошёл — лимит faucet'а; попробую всё равно)"
  fi
}

echo "    Deploy via RPC: $DEPLOY_URL"
ATTEMPT=0
MAX_ATTEMPTS=3
DEPLOYED=0
# Программа уже на devnet (пере-запуск скрипта) — не тратим время на деплой.
# Для принудительного (upgrade) — FORCE_DEPLOY=1.
if [ -z "${FORCE_DEPLOY:-}" ] && [ "$ALREADY_DEPLOYED" = "1" ] && [ -n "$PRE_ID" ]; then
  echo "    Программа уже задеплоена: $PRE_ID — пропускаю деплой (FORCE_DEPLOY=1 — принудительно)."
  DEPLOYED=1
fi
while [ "$DEPLOYED" != "1" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "==> Попытка деплоя $ATTEMPT/$MAX_ATTEMPTS..."
  best_effort_fund
  if DEPLOY_OUT=$(deploy_once 2>&1); then
    DEPLOYED=1
    break
  fi
  printf '%s\n' "$DEPLOY_OUT"
  WORDS=$(printf '%s\n' "$DEPLOY_OUT" | grep -E '^[a-z]+( [a-z]+){11}$' | head -1) || true
  BUFFER_FILE="target/deploy/.buffer-resume-$$.json"
  if [ -n "$WORDS" ] && printf '%s\n' $WORDS | solana-keygen recover --stdin -o "$BUFFER_FILE" >/dev/null 2>&1; then
    DEPLOY_BUFFER="--buffer $BUFFER_FILE"
    echo "    Ключ буфера сохранён ($BUFFER_FILE) — следующая попытка продолжит с того же места."
  else
    echo "✖ Деплой не прошёл, продолжить не на чем (буфер не создан или ключ не восстановился)."
    echo "  Через 1-2 часа (сеть свободнее) повтори команду заново."
    break
  fi
  sleep 5
done
[ "$DEPLOYED" = "1" ] || exit 1
PROGRAM_ID=$(solana address --keypair "$KEYPAIR_FILE")
echo "    program id: $PROGRAM_ID"

# ── 3.1) Migrate old accounts (только при upgrade с сохранением состояния) ──
if [ "$UPGRADE" = "1" ] && [ "$PRESERVE_STATE" = "1" ]; then
  echo "==> 3.1 Migrating v1 accounts to v2 layout (config/epoch/fields)..."
  RPC_URL="$RPC_URL" PROGRAM_ID="$PROGRAM_ID" npm run migrate-v2
else
  if [ "$UPGRADE" = "1" ]; then
    echo "    (PRESERVE_STATE=1 не задан — старые v1-аккаунты, если есть, останутся немигрированными)"
  fi
fi

# ── 4) Patch .env / Anchor.toml ──
echo "==> 4/6 Patching .env and Anchor.toml..."
patch_file() {
  local f="$1"
  if [ -f "$f" ]; then
    sed -i.bak "s/^VITE_PROGRAM_ID=.*/VITE_PROGRAM_ID=$PROGRAM_ID/" "$f" && rm -f "$f.bak"
    echo "    patched $f"
  fi
}
patch_file apps/web/.env.production
patch_file apps/web/.env
patch_file apps/web/.env.example
sed -i.bak "s|^solana_potato = \".*\"$|solana_potato = \"$PROGRAM_ID\"|" Anchor.toml && rm -f Anchor.toml.bak
echo "    patched Anchor.toml"

# ── 5) Init on-chain ──
echo "==> 5/6 init-onchain (idempotent)..."
if [ ! -d node_modules ]; then
  echo "    node_modules нет — ставлю зависимости (yarn install, ~2-5 мин)..."
  if command -v yarn >/dev/null 2>&1; then
    yarn install --frozen-lockfile || npm install
  else
    npm install
  fi
fi
RPC_URL="$RPC_URL" PROGRAM_ID="$PROGRAM_ID" npm run init-onchain

# ── 6) Summary ──
echo ""
echo "════════ Готово ════════"
echo "PROGRAM_ID:  $PROGRAM_ID"
echo "Explorer:    https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "Backend:     RPC_URL=$RPC_URL PROGRAM_ID=$PROGRAM_ID AUTHORITY_KEYPAIR_JSON=$ADMIN_KEYPAIR TELEGRAM_BOT_TOKEN=... npm run dev:backend"
echo "Frontend:    VITE_PROGRAM_ID=$PROGRAM_ID VITE_RPC_URL=$RPC_URL yarn dev:web"
echo ""
echo "Проверка: открой игру с кошельком — баланс GameConfig, presale и quest-казна должны быть видны."
echo ""
echo "⚠ ПЕРЕД МЕДЖЕМ PR закоммить патченые файлы, иначе Cloudflare Pages"
echo "  соберёт прод-фронт под СТАРЫМ program id:"
echo "    git add apps/web/.env.production apps/web/.env.example Anchor.toml apps/web/src/idl.json"
echo "    git commit -m 'chore: program id $(echo $PROGRAM_ID | cut -c1-8)…' && git push"
