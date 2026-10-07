#!/usr/bin/env bash
#
# Pre-beta verification of the DEPLOYED hosts (landing + game) and the devnet
# program. Run from a machine WITH egress to Cloudflare Pages and devnet RPC —
# the repository sandbox has no egress to those hosts, which is why this is a
# script and not a CI job.
#
#   ./scripts/verify-beta-deploy.sh
#   LANDING=https://... GAME=https://... PROGRAM_ID=... ./scripts/verify-beta-deploy.sh
#
# Checks (checklist W-04/W-12, RFC §4.4, MARKETING §6 anti-scam):
#   1. Security headers on both hosts (scripts/check-headers.sh).
#   2. Public exposure on both hosts (scripts/check-public-exposure.sh).
#   3. Presale API through the landing Pages Function:
#        GET <landing>/api/presale/runs/<run>
#     503 presale_api_not_configured = PRESALE_API_ORIGIN not set in the Pages
#     project; 200 with JSON = form can work.
#   4. The deployed game bundle references the official program ID
#     (anti-phishing: address in materials must equal chainConfig, MARKETING §6).
#   5. Program alive on devnet: genesis hash + executable account (finalized).
#
# Exit codes: 0 = all PASS, 1 = at least one FAIL, 2 = usage/network error.

set -uo pipefail

LANDING="${LANDING:-https://ares1-7e1.pages.dev}"
GAME="${GAME:-https://ares1-play.pages.dev}"
PROGRAM_ID="${PROGRAM_ID:-DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf}"
PRESALE_RUN="${PRESALE_RUN:-wave1}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"

cd "$(dirname "$0")/.."

FAIL=0
WARN=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=1; }
note() { printf '  INFO  %s\n' "$1"; }
warn() { printf '  WARN  %s\n' "$1"; WARN=$((WARN + 1)); }
step() { printf '\n== %s ==\n' "$1"; }

rpc() {
  curl -sS --max-time 20 -H 'Content-Type: application/json' -X POST "$RPC_URL" -d "$1" 2>/dev/null
}

# ── 1. Security headers ─────────────────────────────────────────────────────
step "1. Security headers (check-headers.sh)"
for u in "$LANDING" "$GAME"; do
  if ./scripts/check-headers.sh "$u" > /tmp/ares1-headers.out 2>&1; then
    ok "headers: $u"
  else
    bad "headers: $u — детали:"
    sed 's/^/        /' /tmp/ares1-headers.out | tail -12
  fi
done

# ── 2. Public exposure ──────────────────────────────────────────────────────
step "2. Public exposure (check-public-exposure.sh)"
for u in "$LANDING" "$GAME"; do
  rc=0
  ./scripts/check-public-exposure.sh "$u" > /tmp/ares1-exposure.out 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "exposure: $u"
  elif [ "$rc" -eq 2 ]; then
    bad "exposure: $u — usage/network error"
  else
    bad "exposure: $u — что-то выглядит подозрительно:"
    sed 's/^/        /' /tmp/ares1-exposure.out | tail -15
  fi
done

# ── 3. Presale API through the landing Pages Function ──────────────────────
step "3. Presale API: $LANDING/api/presale/runs/$PRESALE_RUN"
BODY="$(curl -sS --max-time 20 -o /tmp/ares1-presale.out -w '%{http_code}' "$LANDING/api/presale/runs/$PRESALE_RUN" 2>/tmp/ares1-presale.err || echo 000)"
if [ "$BODY" = "200" ] && head -c 1 /tmp/ares1-presale.out | grep -q '{'; then
  ok "presale API: 200 JSON (форма Фазы 1 работает, если тираж открыт)"
  head -c 300 /tmp/ares1-presale.out | sed 's/^/        /'
  echo
elif [ "$BODY" = "503" ] && grep -q 'presale_api_not_configured' /tmp/ares1-presale.out 2>/dev/null; then
  bad "presale API: 503 presale_api_not_configured — в Pages-проекте лендинга не задана переменная PRESALE_API_ORIGIN"
else
  bad "presale API: HTTP $BODY — неожиданный ответ (бэкенд недоступен или Function сломана):"
  sed 's/^/        /' /tmp/ares1-presale.out 2>/dev/null | head -5
  sed 's/^/        /' /tmp/ares1-presale.err 2>/dev/null | head -3
fi
note "в игре Phase1Notice читает BACKEND_URL напрямую (счётчик необязателен) — проверьте CORS_ORIGIN бэкенда, если игра ходит в него"

# ── 4. Official program ID in the deployed game bundle ─────────────────────
step "4. Program ID в развёрнутом бандле игры: $GAME"
INDEX="$(curl -sS --max-time 20 "$GAME/" 2>/dev/null || true)"
ASSETS="$(printf '%s' "$INDEX" | grep -oE '/assets/[^"]+\.js' | sort -u)"
if [ -z "$ASSETS" ]; then
  bad "не удалось найти JS-ассеты в index.html (хост отдаёт не игру?)"
else
  FOUND=""
  while read -r a; do
    [ -n "$a" ] || continue
    if curl -sS --max-time 30 "$GAME$a" 2>/dev/null | grep -q "$PROGRAM_ID"; then
      FOUND="$a"
      break
    fi
  done <<EOF
$ASSETS
EOF
  if [ -n "$FOUND" ]; then
    ok "программный ID найден в $FOUND (совпадает с chainConfig)"
  else
    bad "официальный PROGRAM_ID $PROGRAM_ID НЕ найден ни в одном JS-ассете — либо деплой старый, либо клиент смотрит на другой адрес (анти-скам: сверьте!)"
  fi
fi

# ── 5. Program alive on devnet ─────────────────────────────────────────────
step "5. Программа жива на devnet ($RPC_URL)"
GENESIS="$(rpc '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
if [ "$GENESIS" = "$DEVNET_GENESIS" ]; then
  ok "genesis hash = devnet"
else
  bad "RPC не devnet (genesis ${GENESIS:-<нет ответа>}) — проверьте RPC_URL"
fi
ACC="$(rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$PROGRAM_ID\",{\"commitment\":\"finalized\",\"encoding\":\"base64\"}]}" | sed -n 's/.*"executable":\(true\|false\).*/\1/p')"
if [ "$ACC" = "true" ]; then
  ok "программа $PROGRAM_ID существует и executable (finalized)"
elif [ "$ACC" = "false" ]; then
  bad "аккаунт существует, но НЕ executable"
else
  bad "программа $PROGRAM_ID не найдена на devnet (RPC-ошибка или аккаунт исчез)"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n== Итог ==\n'
if [ "$FAIL" -eq 0 ]; then
  if [ "$WARN" -gt 0 ]; then
    printf 'READY WITH WARNINGS: 0 FAIL, %s WARN\n' "$WARN"
  else
    printf 'READY: все проверки прошли\n'
  fi
else
  printf 'NOT READY: есть FAIL (см. выше)\n'
fi
exit "$FAIL"
