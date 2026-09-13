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
#  Переменные окружения (опционально):
#    ADMIN_KEYPAIR  путь к ключу деплоера   (по умолчанию ~/.config/solana/id.json)
#    RPC_URL        RPC для init-onchain    (по умолчанию https://api.devnet.solana.com)
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
[ -f "$ADMIN_KEYPAIR" ] || { echo "✖ Ключ деплоера не найден: $ADMIN_KEYPAIR (создай: solana-keygen new)"; exit 1; }
[ -f "$ADMIN_KEYPAIR" ] || exit 1

ADMIN=$(solana address -keypair "$ADMIN_KEYPAIR")
export ADMIN_KEYPAIR_PATH="$ADMIN_KEYPAIR"

echo "════════ ARES-1 warm start (devnet) ════════"
echo "Deployer: $ADMIN"

# ── 1) Funding ──
echo "==> 1/6 Funding deployer..."
LAMPORTS=$(solana balance --lamports "$ADMIN" --url devnet)
if [ "$LAMPORTS" -lt 1000000000 ]; then
  for i in 1 2 3; do
    if solana airdrop 2 "$ADMIN" --url devnet >/dev/null 2>&1; then
      echo "    airdrop ok (+2 SOL)"
      break
    fi
    echo "    airdrop failed (rate limit?), retry $i/3 через 30s..."
    [ "$i" = 3 ] && { echo "✖ Airdrop недоступен — положи SOL вручную и повтори."; exit 1; }
    sleep 30
  done
fi
LAMPORTS=$(solana balance --lamports "$ADMIN" --url devnet)
echo "    balance: $((LAMPORTS / 1000000000)).$((LAMPORTS % 1000000000 / 100000000)) SOL"

# ── 2) Build ──
echo "==> 2/6 anchor build..."
anchor build
# держим закоммиченный IDL синхронным (errors.ts фронта читает его)
cp target/idl/solana_potato.json apps/web/src/idl.json
echo "    idl synced → apps/web/src/idl.json"

# ── 3) Deploy ──
echo "==> 3/6 Deploying to devnet..."
solana config set --url devnet --keypair "$ADMIN_KEYPAIR" >/dev/null
UPGRADE=0
if [ -f "$KEYPAIR_FILE" ]; then
  UPGRADE=1
  echo "    keystore найден → UPGRADE существующей программы"
fi
anchor deploy --provider.cluster devnet
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
