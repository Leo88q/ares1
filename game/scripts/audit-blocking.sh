#!/usr/bin/env bash
# High/critical dependency gate for the game workspace.
#
# Yarn Classic's exit code is a severity bitmask of every finding:
#   1 = info, 2 = low, 4 = moderate, 8 = high, 16 = critical.
# `--level` filters only the printed table; it does not change the exit code.
# This script blocks on bits 8 or 16 and leaves lower severities advisory.
# The auditSummary record distinguishes a registry response with findings from
# a failed/unavailable audit endpoint; an unavailable scanner fails closed.
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
  if grep -q '"type":"auditSummary"' "$OUT"; then
    break
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error title=Dependency audit unavailable::yarn audit produced no summary (exit $code) — the registry audit endpoint did not answer. Last output:" >&2
    tail -c 1500 "$OUT" >&2
    exit 2
  fi
  echo "audit-blocking: no summary on attempt $attempt (exit $code), retrying…" >&2
  sleep "${AUDIT_BLOCKING_RETRY_SLEEP:-5}"
done

if (( code & 24 )); then
  echo "::error title=High or critical dependency advisory::yarn audit reported a HIGH/CRITICAL advisory (exit mask $code)"
  python3 - "$OUT" <<'PY'
import json
import sys

blocking = []
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
    severity = advisory.get('severity', '').lower()
    if severity not in ('high', 'critical'):
        continue
    findings = row.get('data', {}).get('findings') or [{}]
    version = findings[0].get('version', '?')
    paths = findings[0].get('paths') or []
    where = f' via {" <- ".join(paths[:3])}' if paths else ''
    blocking.append(
        f"{severity.upper()}: {advisory.get('module_name')}@{version}{where} — "
        f"{advisory.get('title')} ({advisory.get('url')})"
    )

for line in blocking:
    print(f'  {line}')
print('Fix, pin or explicitly review every high/critical transitive dependency before merging.')
PY
  exit 1
fi

echo "audit-blocking: no high/critical advisories (yarn exit mask $code — bits 8/16 clear); moderate/lower stay advisory"
