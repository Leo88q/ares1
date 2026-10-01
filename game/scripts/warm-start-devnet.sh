#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  ARES-1 «тёплый старт» on devnet — одна команда
#
#   CONFIRM_RECLAIM=1 — отдельный inventory/reclaim-only режим ДО Step 1;
#      он не запускает Anchor/build/IDL и не меняет рабочее дерево.
#   1. anchor keys sync + anchor build (+ синхронизация IDL) — SOL не тратит,
#      но размер `.so` нужен расчёту, поэтому сборка идёт ПЕРВОЙ в обычном режиме;
#   2. показывает confirmed-инвентарь authority-owned буферов и ПЕРВЫМ делом
#      предлагает reclaim до airdrop (это отдельная ликвидность, не экономия NEED);
#      закрытие — только по точным сумме/адресам, повторной сверке и TTY-подтверждению;
#   3. считает NEED_TOTAL калькулятором scripts/deploy-budget.mjs: ставка rent
#      читается из RPC, размер — из собранного `.so`, залог = ставка × (45 + max_len)
#      + ставка × 36 (loader-v3), плюс комиссии, SETUP_ONCHAIN и резерв;
#   4. доливает SOL деплоеру (airdrop с ретраями), пока баланс < NEED_TOTAL,
#      только если authority-owned buffers отсутствуют; при их наличии сначала
#      останавливается для ручной проверки/reclaim, а reclaim возвращает уже потраченный залог;
#   5. деплой с ЯВНЫМ --max-len: первый деплой (нет программы) или апгрейд
#      (FORCE_DEPLOY=1 при существующей программе); при обрыве продолжает на
#      том же буфере, не тратя залог заново;
#   6. migrate-v2 — только если был апгрейд И PRESERVE_STATE=1;
#   7. патчит .env / Anchor.toml под program id; init-onchain (идемпотентный).
#
#  Использование:
#    DRY_RUN=1 ./scripts/warm-start-devnet.sh   # посчитать и напечатать, НИЧЕГО не отправлять
#    ./scripts/warm-start-devnet.sh             # реальный деплой
#
#  Переменные окружения (опционально):
#    ADMIN_KEYPAIR     путь к ключу деплоера            (по умолчанию ~/.config/solana/id.json)
#    RPC_URL           RPC для ВСЕХ вызовов             (по умолчанию публичный devnet)
#    DRY_RUN=1         ничего не отправлять: считать, печатать и остановиться
#    PRINT_NEED=1      синоним DRY_RUN (явно напечатать NEED и выйти)
#    CONFIRM_RECLAIM=1 отдельный reclaim-only запуск до сборки; закрывает только показанные буферы после проверки
#    CONFIRM_RECLAIM_GENESIS=<hash> cluster genesis из свежего read-only снимка
#    CONFIRM_RECLAIM_SUM=<lamports> точная сумма из confirmed-инвентаря
#    CONFIRM_RECLAIM_ADDRESSES=<addr1,addr2,...> точный отсортированный список из инвентаря
#                      затем нужен интерактивный TTY и точная фраза CLOSE-BUFFERS <genesis> <authority> <sum> <addresses>
#    FORCE_DEPLOY=1    апгрейд, даже если программа уже задеплоена
#    BUFFER_KEYPAIR    путь к ключу буфера для ПРОДОЛЖЕНИЯ прерванного деплоя:
#                      CLI 4.2.2 не читает seed-фразу из stdin (`solana-keygen recover`
#                      спрашивает её только с TTY), поэтому фразу CLI печатает, а
#                      восстановить её сам скрипт не может — см. подсказку в конце
#                      неудачной попытки (фраза сохраняется в target/deploy/)
#    PRESERVE_STATE=1  после апгрейда выполнить migrate-v2 (старые аккаунты → v2 layout)
#    GROWTH_HEADROOM_BYTES=N  запас к --max-len сверх размера `.so` (по умолчанию 0)
#    RESERVE_SOL, FEE_SAFETY_PCT, PRIORITY_MICROLAMPORTS — см. scripts/deploy-budget.mjs
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
PRESERVE_STATE="${PRESERVE_STATE:-0}"
DRY_RUN="${DRY_RUN:-0}"
PRINT_NEED="${PRINT_NEED:-0}"
CONFIRM_RECLAIM="${CONFIRM_RECLAIM:-0}"
CONFIRM_RECLAIM_GENESIS="${CONFIRM_RECLAIM_GENESIS:-}"
CONFIRM_RECLAIM_SUM="${CONFIRM_RECLAIM_SUM:-}"
CONFIRM_RECLAIM_ADDRESSES="${CONFIRM_RECLAIM_ADDRESSES:-}"
FORCE_DEPLOY="${FORCE_DEPLOY:-}"
BUFFER_KEYPAIR="${BUFFER_KEYPAIR:-}"
GROWTH_HEADROOM_BYTES="${GROWTH_HEADROOM_BYTES:-0}"
BUFFER_GENESIS_HASH=""
KEYPAIR_FILE=target/deploy/solana_potato-keypair.json
if [ "$PRINT_NEED" = "1" ]; then DRY_RUN=1; fi

command -v solana >/dev/null 2>&1 || { echo "✖ solana CLI не найден. Установка: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""; exit 1; }
command -v node   >/dev/null 2>&1 || { echo "✖ node не найден — нужен для расчёта scripts/deploy-budget.mjs"; exit 1; }
command -v jq     >/dev/null 2>&1 || { echo "✖ jq не найден — нужен для разбора JSON расчёта (brew install jq / apt install jq)"; exit 1; }
[ -f "$ADMIN_KEYPAIR" ] || { echo "✖ Ключ деплоера не найден: $ADMIN_KEYPAIR (создай: solana-keygen new)"; exit 1; }

ADMIN=$(solana address --keypair "$ADMIN_KEYPAIR")
export ADMIN_KEYPAIR_PATH="$ADMIN_KEYPAIR"

echo "════════ ARES-1 warm start (devnet) ════════"
echo "Deployer: $ADMIN"
echo "RPC:      $RPC_URL"
if [ "$DRY_RUN" = "1" ]; then
  echo "РЕЖИМ DRY_RUN: ничего не отправляется (только расчёт и печать)."
fi

# Лампорты → SOL строкой, без float-арифметики (R4).
lamports_to_sol() {
  local l="$1" sign="" whole frac
  case "$l" in -*) sign="-"; l="${l#-}";; esac
  whole=$((l / 1000000000)); frac=$(printf '%09d' $((l % 1000000000)))
  printf '%s%s.%s' "$sign" "$whole" "$frac"
}

# Read one confirmed CLI snapshot; Node uses BigInt so the exact lamport sum
# and the address list used for confirmation cannot be rounded by JSON tooling.
fetch_buffer_inventory() {
  local genesis raw normalized
  if ! genesis="$(solana genesis-hash --url "$RPC_URL" 2>&1)"; then
    echo "✖ Не удалось определить genesis hash RPC; закрытие/airdrop остановлены:" >&2
    printf '%s\n' "$genesis" >&2
    return 1
  fi
  if [ -n "$BUFFER_GENESIS_HASH" ] && [ "$genesis" != "$BUFFER_GENESIS_HASH" ]; then
    echo "✖ RPC genesis hash изменился между проверками; закрытие/airdrop остановлены." >&2
    return 1
  fi
  if ! raw="$(solana program show --buffers --keypair "$ADMIN_KEYPAIR" --lamports --url "$RPC_URL" --commitment confirmed --output json 2>&1)"; then
    echo "✖ Не удалось получить confirmed-инвентарь буферов; закрытие/airdrop остановлены:" >&2
    printf '%s\n' "$raw" >&2
    return 1
  fi
  if ! normalized="$(node scripts/buffer-inventory.mjs "$ADMIN" <<<"$raw")"; then
    echo "✖ Инвентарь буферов неполон или не принадлежит $ADMIN; закрытие/airdrop остановлены." >&2
    return 1
  fi
  BUFFER_GENESIS_HASH="$genesis"
  BUFFER_INVENTORY_JSON="$normalized"
  BUFFERS_SUM="$(jq -r '.sumLamports' <<<"$BUFFER_INVENTORY_JSON")"
  BUFFERS_SUM_SOL="$(jq -r '.sumSol' <<<"$BUFFER_INVENTORY_JSON")"
  BUFFERS_ADDRESSES="$(jq -r '.addresses' <<<"$BUFFER_INVENTORY_JSON")"
  BUFFERS_COUNT="$(jq -r '.buffers | length' <<<"$BUFFER_INVENTORY_JSON")"
}

print_buffer_inventory() {
  echo "    RPC genesis hash: $BUFFER_GENESIS_HASH"
  if [ "$BUFFERS_COUNT" = "0" ]; then
    echo "    authority-owned buffers: none (confirmed)"
    return
  fi
  echo "    confirmed authority-owned buffers ($BUFFERS_COUNT):"
  jq -r '.buffers[] | "      \(.address) — \(.lamports) lamports"' <<<"$BUFFER_INVENTORY_JSON"
  echo "    точная сумма: $BUFFERS_SUM lamports ($BUFFERS_SUM_SOL SOL)"
  echo "    отсортированный список для подтверждения: $BUFFERS_ADDRESSES"
}

# `solana program show` currently labels this field exactly `ProgramData Address`.
# Capture first so grep cannot close the CLI's stdout early under `pipefail`.
is_program_deployed() {
  local program_id="${1:-}"
  local output

  [ -n "$program_id" ] || return 1
  output="$(solana program show "$program_id" --keypair "$ADMIN_KEYPAIR" --url "$RPC_URL" 2>&1)" || return 1
  grep -q "ProgramData Address" <<<"$output"
}

# CONFIRM_RECLAIM is a reclaim-only mode. Keep it before every Anchor/build/IDL
# operation: the mode must not create a program keypair or rewrite the worktree.
reclaim_buffers_only() {
  echo "==> reclaim-only (confirmed inventory; before build)..."
  if ! fetch_buffer_inventory; then return 1; fi
  print_buffer_inventory

  if [ "$DRY_RUN" = "1" ]; then
    echo "    DRY_RUN: close не выполняется. После ручной сверки отдельный повтор требует:"
    echo "      CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0"
    echo "    и интерактивную точную фразу: CLOSE-BUFFERS $BUFFER_GENESIS_HASH $ADMIN $BUFFERS_SUM $BUFFERS_ADDRESSES"
    echo "    build/funding/deploy не входят в reclaim-only запуск."
    return 0
  fi

  if [ "$BUFFERS_COUNT" = "0" ]; then
    echo "    Буферов для close нет; транзакция не отправлялась."
    echo "    Этот reclaim-only запуск завершён до build/funding/deploy."
    return 0
  fi
  if [ "$CONFIRM_RECLAIM_GENESIS" != "$BUFFER_GENESIS_HASH" ] || [ "$CONFIRM_RECLAIM_SUM" != "$BUFFERS_SUM" ] || [ "$CONFIRM_RECLAIM_ADDRESSES" != "$BUFFERS_ADDRESSES" ]; then
    echo "✖ Подтверждение не совпало со свежим confirmed-инвентарём; close не выполнялся."
    echo "  После ручной проверки повторите с:"
    echo "    CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0"
    return 1
  fi
  if [ ! -t 0 ]; then
    echo "✖ Для отдельного финального подтверждения нужен интерактивный TTY; close не выполнялся." >&2
    return 1
  fi

  EXPECTED_RECLAIM_CONFIRMATION="CLOSE-BUFFERS $BUFFER_GENESIS_HASH $ADMIN $BUFFERS_SUM $BUFFERS_ADDRESSES"
  echo "    Сверьте confirmed-инвентарь выше. Будут закрыты только эти адреса:"
  echo "      authority: $ADMIN"
  echo "      lamports:  $BUFFERS_SUM"
  echo "      addresses: $BUFFERS_ADDRESSES"
  printf 'Для продолжения введите точно: %s\n' "$EXPECTED_RECLAIM_CONFIRMATION"
  if ! read -r -p ' > ' RECLAIM_CONFIRMATION; then
    echo "✖ Не получено интерактивное подтверждение; close не выполнялся." >&2
    return 1
  fi
  if [ "$RECLAIM_CONFIRMATION" != "$EXPECTED_RECLAIM_CONFIRMATION" ]; then
    echo "✖ Точная фраза не совпала; close не выполнялся." >&2
    return 1
  fi

  INVENTORY_BEFORE_CLOSE="$BUFFER_INVENTORY_JSON"
  GENESIS_BEFORE_CLOSE="$BUFFER_GENESIS_HASH"
  if ! fetch_buffer_inventory; then return 1; fi
  if [ "$BUFFER_GENESIS_HASH" != "$GENESIS_BEFORE_CLOSE" ] || [ "$BUFFER_INVENTORY_JSON" != "$INVENTORY_BEFORE_CLOSE" ]; then
    echo "✖ Инвентарь изменился после подтверждения; close остановлен. Новый снимок:" >&2
    print_buffer_inventory
    return 1
  fi

  while IFS= read -r BUFFER_ADDRESS; do
    [ -n "$BUFFER_ADDRESS" ] || continue
    echo "    закрываю подтверждённый buffer: $BUFFER_ADDRESS"
    if ! solana program close "$BUFFER_ADDRESS" --keypair "$ADMIN_KEYPAIR" --url "$RPC_URL" --commitment confirmed; then
      echo "✖ Не удалось закрыть подтверждённый buffer $BUFFER_ADDRESS; дальнейший reclaim остановлен." >&2
      return 1
    fi
  done < <(jq -r '.buffers[].address' <<<"$BUFFER_INVENTORY_JSON")

  if ! fetch_buffer_inventory; then return 1; fi
  print_buffer_inventory
  if [ "$BUFFERS_COUNT" != "0" ]; then
    echo "✖ После close остались authority-owned buffers; проверьте новый inventory вручную." >&2
    return 1
  fi
  echo "    все адреса из подтверждённого списка закрыты; остаточный инвентарь пуст."
  echo "    Этот запуск завершён после reclaim; build/funding/airdrop/deploy требуют отдельного запуска."
}

if [ "$CONFIRM_RECLAIM" = "1" ]; then
  reclaim_buffers_only
  exit 0
fi

# Anchor/cargo checks are deliberately deferred until after reclaim-only exits.
ANCHOR_VERSION="$(sed -n 's/^anchor_version *= *"\([^"]*\)".*/\1/p' Anchor.toml | head -1)"
[ -n "$ANCHOR_VERSION" ] || { echo "✖ Не нашёл anchor_version в Anchor.toml"; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "✖ anchor не найден. Установка: cargo install --git https://github.com/coral-xyz/anchor avm && avm install $ANCHOR_VERSION && avm use $ANCHOR_VERSION"; exit 1; }
INSTALLED_ANCHOR="$(anchor --version 2>/dev/null | awk '{print $2}')"
if [ "$INSTALLED_ANCHOR" != "$ANCHOR_VERSION" ]; then
  echo "✖ Anchor $INSTALLED_ANCHOR ≠ $ANCHOR_VERSION из Anchor.toml — сборка даст другой IDL."
  echo "  Исправь: avm install $ANCHOR_VERSION && avm use $ANCHOR_VERSION"
  exit 1
fi
command -v cargo  >/dev/null 2>&1 || { echo "✖ Rust (cargo) не найден — нужен для anchor build. Установка: https://rustup.rs"; echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }

# ── 1) Build: keypair программы → keys sync → anchor build → IDL ─────────────
# Сборка SOL не тратит, но расчёт обязан идти по РЕАЛЬНОМУ .so, а не по догадке.
echo "==> 1/7 build (anchor $ANCHOR_VERSION)..."
if [ ! -f "$KEYPAIR_FILE" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "    DRY_RUN: ключа программы нет — создание пропущено; считаю сценарий первого деплоя"
  else
    # Keypair программы должен существовать ДО сборки: `anchor keys sync`
    # прописывает program id в declare_id! — иначе программа не запустится
    # (DeclaredProgramIdMismatch, error 4100).
    solana-keygen new -o "$KEYPAIR_FILE" --no-bip39-passphrase
  fi
fi
PROGRAM_ID=$(solana address --keypair "$KEYPAIR_FILE" 2>/dev/null || true)
echo "    program id: ${PROGRAM_ID:-<будет создан>}"
anchor keys sync
anchor build
# держим закоммиченный IDL синхронным (errors.ts фронта читает его)
cp target/idl/solana_potato.json apps/web/src/idl.json
echo "    idl synced → apps/web/src/idl.json"

# ── 1.1) Уже задеплоена? (решает режим расчёта и «апгрейд или чистый деплой») ─
ALREADY_DEPLOYED=0
if [ -n "$PROGRAM_ID" ] && is_program_deployed "$PROGRAM_ID"; then
  ALREADY_DEPLOYED=1
fi
SKIP_DEPLOY=0
UPGRADE=0
if [ "$ALREADY_DEPLOYED" = "1" ] && [ -z "$FORCE_DEPLOY" ]; then
  SKIP_DEPLOY=1
  echo "    программа уже задеплоена — деплой пропускается (FORCE_DEPLOY=1 — принудительно)"
elif [ "$ALREADY_DEPLOYED" = "1" ]; then
  UPGRADE=1
  echo "    FORCE_DEPLOY=1 — будет апгрейд существующей программы"
else
  echo "    программы ещё нет — будет первый деплой"
fi

# ── 2) Застрявшие буферы: read-only inventory; reclaim — отдельное действие ──
# Буфер и есть залог: после неудачного деплоя он держит ~залог программы.
# Возврат НЕ уменьшает NEED_TOTAL (нужен полный залог заново), но увеличивает баланс.
echo "==> 2/7 authority-owned buffers (confirmed inventory)..."
if ! fetch_buffer_inventory; then exit 1; fi
print_buffer_inventory
if [ "$BUFFERS_COUNT" != "0" ]; then
  echo "    СНАЧАЛА вручную проверьте адреса и сумму; reclaim до airdrop рекомендуется."
  echo "    Это отдельная ликвидность, а не экономия NEED_TOTAL."
fi

if [ "$BUFFERS_COUNT" != "0" ]; then
  echo "    После ручной проверки и отдельного подтверждения можно выполнить reclaim так:"
  echo "      CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0"
fi

# ── 3) Расчёт NEED_TOTAL калькулятором (единственный источник правды о цене) ──
echo "==> 3/7 расчёт NEED (scripts/deploy-budget.mjs)..."
export GROWTH_HEADROOM_BYTES
BUDGET_MODE="auto"
if [ "$SKIP_DEPLOY" = "1" ]; then BUDGET_MODE="init-only"; fi
set +e
BUDGET_JSON="$(node scripts/deploy-budget.mjs --so target/deploy/solana_potato.so --rpc "$RPC_URL" --deployer "$ADMIN" --mode "$BUDGET_MODE" --json 2>/tmp/ares-deploy-budget.err)"
BUDGET_STATUS=$?
set -e
if [ "$BUDGET_STATUS" = "2" ] || [ -z "$BUDGET_JSON" ]; then
  echo "✖ Расчёт не удался (код $BUDGET_STATUS):"
  cat /tmp/ares-deploy-budget.err 2>/dev/null || true
  echo "$BUDGET_JSON"
  exit 2
fi

SO_LEN="$(jq -r '.soLen' <<<"$BUDGET_JSON")"
MAX_LEN=$((SO_LEN + GROWTH_HEADROOM_BYTES))
RATE="$(jq -r '.rate' <<<"$BUDGET_JSON")"
BUDGET_MODE_ACTUAL="$(jq -r '.mode' <<<"$BUDGET_JSON")"
NEED_TOTAL="$(jq -r '.needTotal' <<<"$BUDGET_JSON")"
NEED_BEFORE_RESERVE="$(jq -r '.needBeforeReserve' <<<"$BUDGET_JSON")"
SHORTFALL="$(jq -r '.shortfall' <<<"$BUDGET_JSON")"
BALANCE="$(jq -r '.balance' <<<"$BUDGET_JSON")"

echo "    режим:        $BUDGET_MODE_ACTUAL (ставка $RATE лампортов/байт)"
echo "    so_len:       $SO_LEN байт"
echo "    max_len:      $MAX_LEN байт (--max-len для деплоя; запас $GROWTH_HEADROOM_BYTES)"
echo "    NEED_TOTAL:   $NEED_TOTAL лампортов ($(lamports_to_sol "$NEED_TOTAL") SOL), из них резерв $(jq -r '.sol.reserve' <<<"$BUDGET_JSON") SOL"
echo "    баланс:       $BALANCE лампортов ($(lamports_to_sol "$BALANCE") SOL)"

# ── 4) Funding: только до NEED_TOTAL, и ни одной транзакции деплоя до этого ───
echo "==> 4/7 funding (цель: $NEED_TOTAL лампортов)..."
if [ "$DRY_RUN" = "1" ]; then
  if [ "$BALANCE" -lt "$NEED_TOTAL" ]; then
    MISSING=$((NEED_TOTAL - BALANCE))
    echo "    DRY_RUN: airdrop не выполняется; не хватает $MISSING лампортов ($(lamports_to_sol "$MISSING") SOL)."
    if [ -n "$BUFFERS_SUM" ] && [ "$BUFFERS_SUM" != "0" ]; then
      echo "    1) после ручной проверки/отдельного подтверждения вернуть буферы:"
      echo "       CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0"
      echo "       на кошелёк вернётся до $BUFFERS_SUM_SOL SOL — это уже потраченный залог;"
    fi
    echo "    2) затем airdrop: solana airdrop 2 \"$ADMIN\" --url \"$RPC_URL\""
  else
    echo "    баланса достаточно."
  fi
else
  if [ "$BALANCE" -lt "$NEED_TOTAL" ] && [ "$BUFFERS_COUNT" != "0" ]; then
    echo "✖ Airdrop остановлен: сначала вручную проверьте и reclaim-ните confirmed buffers."
    echo "  Точная сумма: $BUFFERS_SUM lamports ($BUFFERS_SUM_SOL SOL); адреса: $BUFFERS_ADDRESSES"
    echo "  Отдельный reclaim: CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0"
    echo "  После подтверждённого reclaim запустите warm-start отдельно; только тогда возможен airdrop."
    exit 1
  fi
  TRIES=0
  while [ "$BALANCE" -lt "$NEED_TOTAL" ] && [ "$TRIES" -lt 4 ]; do
    TRIES=$((TRIES + 1))
    if solana airdrop 2 "$ADMIN" --url "$RPC_URL" >/dev/null 2>&1; then
      BALANCE=$(solana balance --lamports "$ADMIN" --url "$RPC_URL" | awk '{print $1}')
      echo "    airdrop ok, баланс: $(lamports_to_sol "$BALANCE") SOL"
    else
      echo "    airdrop не прошёл (лимит faucet?), retry $TRIES/4 через 30s..."
      sleep 30
    fi
  done
  if [ "$BALANCE" -lt "$NEED_TOTAL" ]; then
    MISSING=$((NEED_TOTAL - BALANCE))
    echo "✖ Не хватает $MISSING лампортов ($(lamports_to_sol "$MISSING") SOL) до NEED_TOTAL."
    echo "  Транзакции деплоя НЕ отправлялись. Варианты (в порядке предпочтения):"
    echo "    (a) после ручной проверки вернуть залог буферов — это ликвидность:"
    echo "        CONFIRM_RECLAIM=1 CONFIRM_RECLAIM_GENESIS=$BUFFER_GENESIS_HASH CONFIRM_RECLAIM_SUM=$BUFFERS_SUM CONFIRM_RECLAIM_ADDRESSES='$BUFFERS_ADDRESSES' $0;"
    echo "    (b) докинуть SOL на $ADMIN (devnet-faucet имеет суточный лимит);"
    echo "    (c) уменьшить программу (opt-level, удаление мёртвого кода) — NEED_ пересчитается сам."
    exit 1
  fi
fi

# ── 5) Deploy (явный --max-len; ретраи и продолжение на буфере) ──────────────
echo "==> 5/7 deploy (--max-len $MAX_LEN)..."
# Не через `anchor deploy`: anchor жёстко прокидывает solana CLI URL из своего
# cluster-маппинга. Делаем то же напрямую — с одним --url (свой RPC).
DEPLOY_URL="$RPC_URL"
# Флаги подбираем под версию CLI (v4.x переименовал --with-compute-unit-price
# в --compute-unit-price; там же появился --use-rpc — шлём write-транзакции
# через RPC, а не напрямую в TPU валидаторов).
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
if [ -n "$BUFFER_KEYPAIR" ]; then
  [ -f "$BUFFER_KEYPAIR" ] || { echo "✖ Ключ буфера не найден: $BUFFER_KEYPAIR"; exit 1; }
  DEPLOY_BUFFER="--buffer $BUFFER_KEYPAIR"
  echo "    Продолжаем деплой на существующем буфере: $BUFFER_KEYPAIR"
fi

deploy_once() {
  # shellcheck disable=SC2086
  solana program deploy \
    --url "$DEPLOY_URL" \
    --keypair "$ADMIN_KEYPAIR" \
    --program-id "$KEYPAIR_FILE" \
    --max-len "$MAX_LEN" \
    $DEPLOY_EXTRA $DEPLOY_BUFFER \
    target/deploy/solana_potato.so
}

best_effort_fund() {
  local bal
  bal=$(solana balance --lamports "$ADMIN" --url "$RPC_URL" 2>/dev/null | awk '{print $1}') || return 0
  if [ -n "$bal" ] && [ "$bal" -lt "$NEED_TOTAL" ]; then
    echo "    Баланс ниже NEED_TOTAL ($(lamports_to_sol "$bal") SOL) — пробую airdrop..."
    solana airdrop 2 "$ADMIN" --url "$RPC_URL" >/dev/null 2>&1 || echo "    (airdrop не прошёл — лимит faucet'а; попробую всё равно)"
  fi
}

ATTEMPT=0
MAX_ATTEMPTS=3
DEPLOYED=0
if [ "$SKIP_DEPLOY" = "1" ]; then
  echo "    Программа уже задеплоена: $PROGRAM_ID — пропускаю деплой."
  DEPLOYED=1
elif [ "$DRY_RUN" = "1" ]; then
  echo "    DRY_RUN: деплой не выполняется. Боевая команда:"
  echo "      solana program deploy --url \"$RPC_URL\" --keypair \"$ADMIN_KEYPAIR\" --program-id \"$KEYPAIR_FILE\" --max-len $MAX_LEN$DEPLOY_EXTRA $DEPLOY_BUFFER target/deploy/solana_potato.so"
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
  printf '%s\n' "$DEPLOY_OUT" | grep -vE '^[a-z]+( [a-z]+){11}$' || true
  WORDS=$(printf '%s\n' "$DEPLOY_OUT" | grep -E '^[a-z]+( [a-z]+){11}$' | head -1) || true
  if [ -n "$WORDS" ]; then
    PHRASE_FILE="target/deploy/.buffer-resume-$$.phrase"
    ( umask 077; printf '%s\n' "$WORDS" > "$PHRASE_FILE" )
    echo "    CLI напечатал seed-фразу промежуточного буфера — она сохранена в $PHRASE_FILE"
    echo "    (секрет, не коммитить; target/ в .gitignore). Восстановить ключ можно только"
    echo "    интерактивно (фраза читается с TTY), затем повторить деплой с ним:"
    echo "      solana-keygen recover -o target/deploy/.buffer-resume-$$.json   # вставить фразу"
    echo "      BUFFER_KEYPAIR=target/deploy/.buffer-resume-$$.json $0"
    break
  elif [ -n "$DEPLOY_BUFFER" ]; then
    echo "    Повторяю на том же буфере ($BUFFER_KEYPAIR)."
  else
    echo "✖ Деплой не прошёл, seed-фразы в выводе нет — продолжить не на чем."
    break
  fi
  sleep 5
done
if [ "$DEPLOYED" != "1" ]; then
  echo "✖ Деплой не выполнен."
  exit 1
fi
PROGRAM_ID="$(solana address --keypair "$KEYPAIR_FILE")"
echo "    program id: $PROGRAM_ID"

# ── 5.1) Миграция старых аккаунтов — только после РЕАЛЬНОГО апгрейда ─────────
if [ "$UPGRADE" = "1" ] && [ "$PRESERVE_STATE" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "==> 5.1 DRY_RUN: migrate-v2 не запускается (миграция нужна только после реального апгрейда)."
  else
    echo "==> 5.1 Migrating v1 accounts to v2 layout (config/epoch/fields)..."
    RPC_URL="$RPC_URL" PROGRAM_ID="$PROGRAM_ID" npm run migrate-v2
  fi
elif [ "$UPGRADE" = "1" ]; then
  echo "    (UPGRADE, но PRESERVE_STATE != 1 — старые v1-аккаунты, если есть, останутся немигрированными)"
fi

# ── 6) Patch .env / Anchor.toml ──────────────────────────────────────────────
echo "==> 6/7 patching .env and Anchor.toml..."
patch_file() {
  local f="$1"
  if [ -f "$f" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "    DRY_RUN: пропускаю патч $f"
    else
      sed -i.bak "s/^VITE_PROGRAM_ID=.*/VITE_PROGRAM_ID=$PROGRAM_ID/" "$f" && rm -f "$f.bak"
      echo "    patched $f"
    fi
  fi
}
patch_file apps/web/.env.production
patch_file apps/web/.env
patch_file apps/web/.env.example
patch_file .env.local
patch_file .env
if [ "$DRY_RUN" = "1" ]; then
  echo "    DRY_RUN: пропускаю патч Anchor.toml"
else
  sed -i.bak "s|^solana_potato = \".*\"$|solana_potato = \"$PROGRAM_ID\"|" Anchor.toml && rm -f Anchor.toml.bak
  echo "    patched Anchor.toml"
fi

# ── 7) init-on-chain ─────────────────────────────────────────────────────────
echo "==> 7/7 init-onchain (idempotent)..."
if [ "$DRY_RUN" = "1" ]; then
  echo "    DRY_RUN: init-onchain не запускается (нужен SETUP_ONCHAIN=$(jq -r '.setupOnchain' <<<"$BUDGET_JSON") лампортов)."
else
  if [ ! -d node_modules ]; then
    echo "    node_modules нет — ставлю зависимости (yarn install, ~2-5 мин)..."
    if command -v yarn >/dev/null 2>&1; then
      yarn install --frozen-lockfile || npm install
    else
      npm install
    fi
  fi
  RPC_URL="$RPC_URL" PROGRAM_ID="$PROGRAM_ID" npm run init-onchain
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════ Готово ════════"
echo "PROGRAM_ID:  ${PROGRAM_ID:-<нет>}"
echo "NEED_TOTAL:  $NEED_TOTAL лампортов ($(lamports_to_sol "$NEED_TOTAL") SOL; до резерва $NEED_BEFORE_RESERVE)"
echo "SO_LEN:      $SO_LEN байт, --max-len $MAX_LEN"
if [ "$SHORTFALL" != "0" ] && [ "$SHORTFALL" != "null" ]; then
  echo "ВНИМАНИЕ: на момент расчёта не хватало $SHORTFALL лампортов"
fi
if [ "$DRY_RUN" = "1" ]; then
  echo "Это был DRY_RUN: ни одна транзакция не отправлена."
fi
if [ -n "${PROGRAM_ID:-}" ]; then
  echo "Explorer:    https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
fi
echo "Backend:     RPC_URL=$RPC_URL PROGRAM_ID=$PROGRAM_ID AUTHORITY_KEYPAIR_JSON=$ADMIN_KEYPAIR npm run dev:backend"
echo "Frontend:    VITE_PROGRAM_ID=$PROGRAM_ID VITE_RPC_URL=$RPC_URL yarn dev:web"
echo ""
echo "Проверка: открой игру с кошельком — баланс GameConfig, presale и quest-казна должны быть видны."
echo ""
echo "⚠ ПЕРЕД МЕДЖЕМ PR закоммить патченые файлы, иначе Cloudflare Pages"
echo "  соберёт прод-фронт под СТАРЫМ program id:"
echo "    git add apps/web/.env.production apps/web/.env.example Anchor.toml apps/web/src/idl.json"
echo "    git commit -m \"chore: program id ...\" && git push"
