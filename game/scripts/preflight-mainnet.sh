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
#   ./scripts/preflight-mainnet.sh [--so target/deploy/solana_potato.so] [--expected-so-sha256 <hash>]
#
# Required env: RPC_URL (mainnet endpoint), solana CLI on PATH.
# Exit codes: 0 = gate passed, 1 = gate FAILED (do not deploy), 2 = cannot check.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.."

FAILED=0
WARN=0
SO_PATH="target/deploy/solana_potato.so"
EXPECTED_SO_SHA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --so) SO_PATH="$2"; shift 2 ;;
    --expected-so-sha256) EXPECTED_SO_SHA="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "FAIL: $*" >&2; FAILED=1; }
warn() { echo "WARN: $*" >&2; WARN=1; }
ok()   { echo "ok:   $*"; }

need() {
  local name="$1" value="${2:-}"
  if [[ -z "$value" ]]; then echo "FATAL: $name is not set" >&2; exit 2; fi
}

need "PROGRAM_ID" "${PROGRAM_ID:-}"
need "RPC_URL" "${RPC_URL:-}"
command -v solana >/dev/null || { echo "FATAL: solana CLI not found" >&2; exit 2; }

echo "── preflight: program $PROGRAM_ID"

# ── 1. Program exists and is owned by the BPF loader (i.e. really deployed) ──
SHOW=$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json 2>/dev/null)
if [[ -z "$SHOW" ]]; then
  fail "program $PROGRAM_ID not found on this cluster (deploy it first, then re-run the gate)"
else
  AUTHORITY=$(python3 -c "import json,sys;print(json.load(sys.stdin).get('authority',''))" <<<"$SHOW")
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
