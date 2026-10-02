#!/usr/bin/env bash
# Open — or reuse — the tracking issue for a failed monitoring check.
#
# Used by .github/workflows/monitoring.yml. Deliberately idempotent: a 15-minute
# DNS check must not create a new issue every quarter of an hour, so an existing
# open issue with the same title is left alone (no comment spam either).
#
# Env: GH_TOKEN (github.token), ALERT_TITLE, and the standard Actions variables
# used to link the failing run.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${ALERT_TITLE:?ALERT_TITLE is required}"

# Label is cosmetic: create it once, ignore "already exists".
gh label create monitoring-alert --color B02A05 --description "Automated monitoring failure" >/dev/null 2>&1 || true

existing="$(gh issue list \
  --state open \
  --label monitoring-alert \
  --limit 100 \
  --json number,title \
  --jq ".[] | select(.title == \"${ALERT_TITLE}\") | .number" | head -n1 || true)"

body="The scheduled monitoring check failed.
Run: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}
Commit: ${GITHUB_SHA:-unknown}
Fix the cause, then close this issue — the next successful run does not close it automatically on purpose."

if [[ -n "${existing}" ]]; then
  echo "Monitoring alert already tracked in issue #${existing}; not creating a duplicate."
  exit 0
fi

gh issue create --title "${ALERT_TITLE}" --label monitoring-alert --body "${body}"
echo "Created monitoring issue: ${ALERT_TITLE}"
