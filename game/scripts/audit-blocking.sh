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

blocking = {}
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
    data = row.get('data', {})
    advisory = data.get('advisory', {})
    severity = advisory.get('severity', '').lower()
    if severity not in ('high', 'critical'):
        continue
    # Yarn Classic nests affected versions/paths inside advisory.findings and
    # reports one auditAdvisory event per resolution. Accept the old top-level
    # shape too, so the gate remains robust across registry response variants.
    findings = advisory.get('findings') or data.get('findings') or []
    resolution_path = (data.get('resolution') or {}).get('path')
    if not findings:
        findings = [{"version": "?", "paths": [resolution_path] if resolution_path else []}]
    for finding in findings:
        version = finding.get('version', '?')
        paths = finding.get('paths') or []
        if resolution_path and resolution_path not in paths:
            paths = [resolution_path, *paths]
        key = (
            severity.upper(),
            advisory.get('module_name') or '?',
            version,
            advisory.get('title') or '?',
            advisory.get('url') or '?',
        )
        affected_paths = blocking.setdefault(key, [])
        for path in paths:
            if path not in affected_paths and len(affected_paths) < 10:
                affected_paths.append(path)

# Yarn emits one row per vulnerable resolution. Group the shared advisory by
# module/version and keep a bounded set of representative dependency paths.

def workflow_escape(value):
    return value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')

for (severity, module, version, title, url), paths in sorted(blocking.items()):
    where = f' via {" ; ".join(paths[:3])}' if paths else ''
    line = f'{severity}: {module}@{version}{where} — {title} ({url})'
    print(f'  {line}')
    # Make the precise package, advisory title, and dependency path visible as
    # check annotations; workflow logs may be unavailable to operators behind
    # restricted artifact-storage egress.
    print(f'::error title=High or critical dependency advisory::{workflow_escape(line)}')
print('Fix, pin or explicitly review every high/critical transitive dependency before merging.')
PY
  exit 1
fi

echo "audit-blocking: no high/critical advisories (yarn exit mask $code — bits 8/16 clear); moderate/lower stay advisory"
