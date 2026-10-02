#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Critical-only dependency gate for the game workspace (audit finding F-09).
#
# WHY THIS SCRIPT EXISTS INSTEAD OF `yarn audit --level critical`
#   Yarn Classic's exit code is a severity BITMASK of every finding:
#     1 = info, 2 = low, 4 = moderate, 8 = high, 16 = critical
#   and `--level` filters only the printed table — it does NOT change the exit
#   code (yarnpkg/yarn#7260, #7386, and the CLI docs). So a "critical" gate
#   written as `yarn audit --level critical` fails on moderates and lows, and a
#   real critical is indistinguishable from noise. This was verified on CI run
#   37019422258 by the job exiting with code 30 = 2|4|8|16 while the policy says
#   only criticals may block.
#
# POLICY
#   critical → blocking; high/moderate/low stay advisory (visible in the log,
#   they have no non-breaking fix in the @solana transitive stack yet).
#
# EXIT CODES
#   0 = no critical advisories
#   1 = at least one critical advisory (do not merge until fixed or pinned)
#   2 = the audit could not be executed (network/registry) — fail closed, so a
#       broken scanner can never look like a clean scan. One retry absorbs the
#       usual registry hiccup.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

ATTEMPTS=2
attempt=0
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

while :; do
  attempt=$((attempt + 1))
  set +e
  yarn audit --groups dependencies --json >"$OUT" 2>/dev/null
  code=$?
  set -e
  # auditSummary is printed whenever the registry answered, regardless of what
  # was found, so its presence distinguishes "findings" from "no answer".
  if grep -q '"type":"auditSummary"' "$OUT"; then
    break
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error title=Dependency audit unavailable::yarn audit produced no summary (exit $code) — the registry audit endpoint did not answer. Last output:" >&2
    tail -c 1500 "$OUT" >&2
    exit 2
  fi
  echo "audit-critical: no summary on attempt $attempt (exit $code), retrying…" >&2
  # Sleep is overridable so the guard tests can exercise the retry path instantly.
  sleep "${AUDIT_CRITICAL_RETRY_SLEEP:-5}"
done

if (( code & 16 )); then
  echo "::error title=Critical dependency advisory::yarn audit reported at least one CRITICAL advisory (exit mask $code)"
  python3 - "$OUT" <<'PY'
import json
import sys

criticals = []
for raw in open(sys.argv[1], encoding='utf8', errors='replace'):
    raw = raw.strip()
    if not raw.startswith('{'):
        continue
    try:
        row = json.loads(raw)
    except ValueError:
        continue
    if row.get('type') != 'auditAdvisory':
        continue
    advisory = row.get('data', {}).get('advisory', {})
    if advisory.get('severity') != 'critical':
        continue
    findings = row.get('data', {}).get('findings') or [{}]
    version = findings[0].get('version', '?')
    paths = findings[0].get('paths') or []
    where = f' via {" <- ".join(paths[:3])}' if paths else ''
    criticals.append(
        f"{advisory.get('module_name')}@{version}{where} — {advisory.get('title')} ({advisory.get('url')})"
    )

for line in criticals:
    print(f'  CRITICAL: {line}')
print('Pin or upgrade the affected transitive dependency (resolutions in game/package.json) before merging.')
PY
  exit 1
fi

echo "audit-critical: no critical advisories (yarn exit mask $code — bit 16 clear); high/moderate stay advisory"
