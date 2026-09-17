#!/usr/bin/env bash
# Локальный CI — точная копия .github/workflows/ci.yml для запуска на своей
# машине (пока GitHub Actions недоступен/не оплачен).
#
#   ./scripts/ci-local.sh                 # всё: chain (unit+build+idl+validator) + web + backend
#   ./scripts/ci-local.sh --skip-chain    # только web + backend (быстро, без rust/solana)
#   ./scripts/ci-local.sh --skip-validator  # без anchor test на локальном валидаторе
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_CHAIN=0
SKIP_VALIDATOR=0
for a in "$@"; do
  case "$a" in
    --skip-chain) SKIP_CHAIN=1 ;;
    --skip-validator) SKIP_VALIDATOR=1 ;;
    *) echo "неизвестный флаг: $a"; exit 2 ;;
  esac
done

SOLANA_VERSION="4.2.2"
ANCHOR_VERSION="0.31.2"
RUST_VERSION="1.97.1"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

step "0/5 Пререквизиты"
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 не найден. Установка: $2"
    return 1
  fi
  ok "$1: $($1 --version 2>/dev/null | head -1 || true)"
}
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 22 ] || { fail "нужен Node >= 22 (у вас: $(node --version 2>/dev/null || echo нет))"; exit 1; }
ok "node $(node --version)"
need yarn "npm i -g yarn"
need git ""
if [ "$SKIP_CHAIN" -eq 0 ]; then
  need cargo "https://rustup.rs (rustup-init)"
  RUSTC=$(rustc --version | awk '{print $2}')
  if [ "$RUSTC" = "$RUST_VERSION" ]; then ok "rustc запинчен под CI ($RUSTC)"; else warn "rustc $RUSTC, CI пинит $RUST_VERSION — сборка SBF может отличаться (rustup install $RUST_VERSION && rustup default $RUST_VERSION)"; fi
  need solana "sh -c \"\$(curl -sSf https://release.anza.xyz/v${SOLANA_VERSION}/install)\" && source ~/.local/share/solana/install/active_release/bin/env"
  SVER=$(solana --version 2>/dev/null | awk '{print $2}')
  [ "$SVER" = "$SOLANA_VERSION" ] && ok "solana $SVER = CI" || warn "solana $SVER, CI пинит $SOLANA_VERSION (release.anza.xyz/v${SOLANA_VERSION})"
  if ! command -v anchor >/dev/null 2>&1; then
    fail "anchor не найден. Установка: cargo install avm && avm install $ANCHOR_VERSION && avm use $ANCHOR_VERSION"
    exit 1
  fi
  ok "anchor: $(anchor --version 2>/dev/null | head -1)"
fi

step "1/5 yarn install (frozen)"
yarn install --frozen-lockfile --network-timeout 100000
ok "зависимости установлены, lockfile согласован"

if [ "$SKIP_CHAIN" -eq 0 ]; then
  step "2/5 cargo test (unit, host)"
  cargo test -p solana_potato --lib
  ok "unit-тесты программы"

  step "3/5 anchor build"
  anchor build
  ok "программа собрана (target/deploy/solana_potato.so)"

  step "3.5 IDL актуален"
  cp target/idl/solana_potato.json apps/web/src/idl.json
  if git diff --exit-code --quiet -- apps/web/src/idl.json 2>/dev/null; then
    ok "apps/web/src/idl.json совпадает со сборкой"
  else
    fail "apps/web/src/idl.json устарел — закоммитьте обновлённый файл:"
    git diff -- apps/web/src/idl.json | head -40
    exit 1
  fi

  if [ "$SKIP_VALIDATOR" -eq 0 ]; then
    step "4/5 anchor test (локальный валидатор)"
    [ -f "$HOME/.config/solana/id.json" ] || solana-keygen new --no-bip39-passphrase --silent --outfile "$HOME/.config/solana/id.json"
    anchor test --skip-build
    ok "интеграционные тесты на локальном валидаторе"
  else
    warn "anchor test пропущен (--skip-validator)"
  fi
fi

step "5/5 web: tsc + build"
yarn workspace web exec tsc --noEmit
ok "web typecheck"
VITE_SOLANA_CLUSTER=devnet \
VITE_RPC_URL=https://api.devnet.solana.com \
VITE_PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf \
VITE_BACKEND_URL="" \
yarn workspace web build
ok "web собран в apps/web/dist (деплой: npx wrangler pages deploy apps/web/dist)"

step "5.5 backend: typecheck"
yarn workspace backend typecheck
ok "backend typecheck"

printf '\n\033[32m%s\033[0m\n' "✅ ЛОКАЛЬНЫЙ CI ПРОШЁЛ — всё, что проверял GitHub Actions, зелёное на этой машине."
