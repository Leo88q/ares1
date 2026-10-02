#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Preflight gate for a mainnet-beta deployment.
#
# Security checklist items 44 (upgrade authority), 45 (reproducible build),
# 63 (multisig threshold), 64 (separation of duties), 68 (layout migration).
# Everything that a human would otherwise have to remember — machine-checked.
#
# Usage:
#   PROGRAM_ID=<id> \
#   MAINNET_AUTHORITY=<squads-multisig-address> \
#   MAINNET_TREASURY=<treasury-owner-address> \
#   MAINNET_PAYER=<backend-hot-wallet-address> \
#   POTATO_MINT=<mint> \
#   ./scripts/preflight-mainnet.sh [--so target/deploy/solana_potato.so] [--expected-so-sha256 <hash>] [--allow-first-deploy] [--strict]
#
# --allow-first-deploy: skip the on-chain authority checks when the program does
# not exist on the cluster yet (the very first deploy). The post-deploy pass MUST
# be run without it, so the Squads authority is still verified before the game
# opens. Used by game/scripts/deploy-mainnet.sh.
#
# Required env: RPC_URL (mainnet endpoint), solana CLI on PATH.
# Exit codes: 0 = gate passed, 1 = gate FAILED (do not deploy), 2 = cannot check.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2 # 2 = cannot check (документированный exit-код скрипта)

FAILED=0
WARN=0
SO_PATH="target/deploy/solana_potato.so"
EXPECTED_SO_SHA=""
ALLOW_FIRST_DEPLOY=0
STRICT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --so) SO_PATH="$2"; shift 2 ;;
    --expected-so-sha256) EXPECTED_SO_SHA="$2"; shift 2 ;;
    --allow-first-deploy) ALLOW_FIRST_DEPLOY=1; shift ;;
    --strict) STRICT=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "FAIL: $*" >&2; FAILED=1; }
warn() {
  echo "WARN: $*" >&2
  WARN=1
  if [[ "$STRICT" == "1" ]]; then FAILED=1; fi
}
ok()   { echo "ok:   $*"; }

need() {
  local name="$1" value="${2:-}"
  if [[ -z "$value" ]]; then echo "FATAL: $name is not set" >&2; exit 2; fi
}

need "PROGRAM_ID" "${PROGRAM_ID:-}"
need "RPC_URL" "${RPC_URL:-}"
command -v solana >/dev/null || { echo "FATAL: solana CLI not found" >&2; exit 2; }

echo "── preflight: program $PROGRAM_ID"

# ── 1. Program existence must be distinguished from RPC/CLI failure ──────────
if SHOW=$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json 2>&1); then
  if [[ -z "$SHOW" ]]; then
    echo "FATAL: solana program show returned no data for $PROGRAM_ID" >&2
    exit 2
  fi
  if ! AUTHORITY=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('authority',''))" <<<"$SHOW"); then
    echo "FATAL: could not parse program state for $PROGRAM_ID" >&2
    exit 2
  fi
  ok "program found; upgrade authority = ${AUTHORITY:-<none>}"

  # ── 2. Item 44/63: upgrade authority must be a multisig, not a deployer key ──
  if [[ -z "$AUTHORITY" || "$AUTHORITY" == "none" ]]; then
    warn "no upgrade authority (immutable) — acceptable only if that is the intent"
  elif [[ -n "${MAINNET_AUTHORITY:-}" ]]; then
    if [[ "$AUTHORITY" == "$MAINNET_AUTHORITY" ]]; then
      ok "upgrade authority is the expected multisig $MAINNET_AUTHORITY"
    else
      fail "upgrade authority $AUTHORITY != expected multisig $MAINNET_AUTHORITY (item 44/63: Squads, threshold >= 3-of-N)"
    fi
  else
    fail "MAINNET_AUTHORITY is not set — cannot verify that the upgrade authority is a multisig (item 44)"
  fi

  # ── 3. Item 64: authority must not be the hot wallet or the treasury owner ──
  if [[ -n "${MAINNET_PAYER:-}" && "$AUTHORITY" == "$MAINNET_PAYER" ]]; then
    fail "upgrade authority == backend hot wallet (item 64: separation of duties)"
  fi
  if [[ -n "${MAINNET_TREASURY:-}" && "$AUTHORITY" == "$MAINNET_TREASURY" ]]; then
    fail "upgrade authority == treasury owner (item 64: separation of duties)"
  fi
else
  SHOW_ERROR="$SHOW"
  if [[ "$SHOW_ERROR" =~ [Aa]ccount[Nn]ot[Ff]ound|[Aa]ccount[[:space:]]+[Nn]ot[[:space:]]+[Ff]ound ]]; then
    if [[ "$ALLOW_FIRST_DEPLOY" == "1" ]]; then
      ok "program is absent and first-deploy mode was explicitly requested"
    else
      fail "program $PROGRAM_ID is absent on this cluster (first deployment requires --allow-first-deploy)"
    fi
  else
    echo "FATAL: cannot determine whether program $PROGRAM_ID exists; refusing to treat an RPC/CLI failure as a first deploy. Raw RPC/CLI output is suppressed because it may contain credentials." >&2
    exit 2
  fi
fi

# ── 4. Item 45: reproducible build — the shipped .so must match a reviewed hash ──
if [[ -f "$SO_PATH" ]]; then
  ACTUAL_SHA=$(sha256sum "$SO_PATH" | awk '{print $1}')
  ok "build artifact $SO_PATH sha256=$ACTUAL_SHA"
  if [[ -n "$EXPECTED_SO_SHA" ]]; then
    if [[ "$ACTUAL_SHA" == "$EXPECTED_SO_SHA" ]]; then
      ok "artifact matches the reviewed build hash (reproducible build verified)"
    else
      fail "artifact sha256 $ACTUAL_SHA != expected $EXPECTED_SO_SHA (item 45: build is not reproducible)"
    fi
  else
    warn "no --expected-so-sha256 given: run 'anchor build' twice and compare, or use solana-verify (item 45)"
  fi
else
  warn "$SO_PATH not found — run 'anchor build' first (item 45)"
fi

# ── 5. Item 11/68: mint is still locked behind the config PDA, supply sane ──
if [[ -n "${POTATO_MINT:-}" ]]; then
  MINT=$(solana account "$POTATO_MINT" --url "$RPC_URL" --output json 2>/dev/null)
  if [[ -z "$MINT" ]]; then
    fail "POTATO mint $POTATO_MINT not found"
  else
    echo "note: verify manually that mint authority == config PDA, freeze authority == none, decimals == 6:"
    echo "      yarn tsx scripts/check-invariants.ts   (exit 1 = invariants violated)"
  fi
else
  warn "POTATO_MINT not set — mint invariants not checked here (run scripts/check-invariants.ts)"
fi

# ── 6. Item 68: migrations validated on a fork before the upgrade ──
if [[ -f "programs/solana_potato/src/migrations.rs" ]]; then
  ok "migration module present: every account layout must be migrated on a mainnet FORK before the upgrade (item 68)"
fi

# ── 7. Static gates that must be green before deploying ──
if command -v node >/dev/null; then
  node --test scripts/security-guards.test.mjs >/dev/null 2>&1 \
    && ok "security-guard tripwire green" \
    || fail "security-guard tripwire FAILED (node --test scripts/security-guards.test.mjs)"
fi

# ── 8. Reminder block: the human gates this script cannot check ──
cat <<'EOF'
──────── human gates (cannot be machine-checked, confirm in writing) ────────
  • Item 62/63: Squads vault with threshold >= 3-of-N; signers are different people/devices.
  • Item 64:    key rotation on offboarding; nobody can both propose and execute a withdrawal.
  • Item 65:    secrets in KMS/HSM; no keypair in CI, logs, chat or backups.
  • Item 67:    DNSSEC + hardware-key 2FA at the registrar; Certificate Transparency monitoring.
  • Item 52:    external audit + fuzzing campaign completed, findings closed or accepted.
  • Item 58:    closed beta 20-50 players done; emission model re-checked on real data.
  • Item 41:    reward rail (if enabled) uses a one-shot nonce PDA, not a bare backend signature.
EOF

if [[ "$FAILED" -ne 0 ]]; then
  echo "PREFLIGHT FAILED — do not deploy." >&2
  exit 1
fi
if [[ "$WARN" -ne 0 ]]; then
  echo "PREFLIGHT PASSED WITH WARNINGS — review each WARN before deploying." >&2
fi
echo "PREFLIGHT PASSED."
exit 0
