#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="main"
PROGRAM_ID="DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf"
RPC_URL="https://api.devnet.solana.com"

fail() {
  echo ""
  echo "❌ Ошибка: $*" >&2
  exit 1
}

step() {
  echo ""
  echo "━━━ $* ━━━"
}

cd "$ROOT_DIR"

command -v git >/dev/null || fail "Не найден git"
command -v yarn >/dev/null || fail "Не найден yarn"
command -v anchor >/dev/null || fail "Не найден Anchor CLI"
command -v solana >/dev/null || fail "Не найден Solana CLI"

step "Проверка ветки и обновление проекта"

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] || \
  fail "Ожидалась ветка $BRANCH, сейчас: $CURRENT_BRANCH"

git diff --quiet || \
  fail "Есть незакоммиченные изменения. Сначала сохрани или убери их."

git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

step "Проверка инструментов"

printf "Node: "
node --version

printf "Yarn: "
yarn --version

printf "Rust: "
rustc --version

printf "Anchor: "
anchor --version

printf "Solana: "
solana --version

step "Проверка Devnet-кошелька"

solana config set --url devnet >/dev/null

[[ -f "$HOME/.config/solana/id.json" ]] || \
  fail "Нет кошелька ~/.config/solana/id.json"

solana address
solana balance

step "Полный CI: тесты, сборка, validator и IDL"

cd "$ROOT_DIR/game"
./scripts/ci-local.sh

step "Deploy контракта в Solana Devnet"

./scripts/deploy-devnet.sh

step "Инициализация on-chain состояния"

ADMIN_KEYPAIR_PATH="$HOME/.config/solana/id.json" \
RPC_URL="$RPC_URL" \
PROGRAM_ID="$PROGRAM_ID" \
yarn init-onchain

step "Финальная проверка"

solana program show "$PROGRAM_ID" --url "$RPC_URL"

echo ""
echo "✅ Готово."
echo "Контракт задеплоен в Solana Devnet."
echo "Program ID: $PROGRAM_ID"
echo "RPC: $RPC_URL"
