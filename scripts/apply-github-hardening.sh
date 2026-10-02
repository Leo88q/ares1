#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GitHub perimeter hardening (audit finding F-02, 2026-10-02).
#
# WHY THIS IS A SCRIPT AND NOT A WORKFLOW STEP
#   Repository settings require admin rights. The audit sandbox / CI token gets
#   HTTP 403 on `PATCH /repos/...` ("Resource not accessible by integration"),
#   so these switches cannot be verified or flipped from inside the repository —
#   a human with admin access must run this ONCE per repository.
#
# WHAT IT DOES (all idempotent; safe to re-run)
#   1. Secret scanning + push protection + Dependabot security updates: ON.
#   2. Branch protection for `main`: PR + 1 review + CODEOWNERS, required status
#      checks, no force-push, no branch deletion, admins included.
#
# USAGE
#   gh auth login                     # an account with admin on the repository
#   ./scripts/apply-github-hardening.sh                 # defaults to Leo88q/ares1
#   REPO=owner/name ./scripts/apply-github-hardening.sh
#
# Exit codes: 0 = applied, 1 = at least one call failed (details printed).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO="${REPO:-Leo88q/ares1}"
FAILED=0

say() { printf '%s\n' "$*"; }
step() { printf '\n── %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; FAILED=1; }

command -v gh >/dev/null || { echo "gh (GitHub CLI) is required" >&2; exit 1; }

step "1/3 Secret scanning, push protection, Dependabot alerts"
if gh api -X PATCH "repos/$REPO" \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
  -f 'security_and_analysis[dependabot_security_updates][status]=enabled' >/dev/null; then
  say "ok: security_and_analysis updated"
else
  fail "could not patch security_and_analysis (need admin on $REPO)"
fi

step "2/3 Dependabot alerts (separate endpoint, may be disabled org-wide)"
if gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null 2>&1; then
  say "ok: vulnerability alerts enabled"
else
  fail "could not enable vulnerability alerts (admin or org policy)"
fi

step "3/3 Branch protection for main"
# Required checks are the CI job names as they appear in the Checks tab. Keep
# this list in sync with .github/workflows/ci.yml + security.yml; a wrong name
# makes the branch block forever (GitHub waits for a check that never appears).
# ВНИМАНИЕ: это ровно те имена job'ов, которые появляются в Checks на PR.
# Список снят с самих workflow (ci.yml, security.yml, watchtower.yml) через
# YAML-парсер 2026-10-02; при переименовании job'а его нужно обновить здесь,
# иначе GitHub будет ждать проверку, которая никогда не появится, и ветка
# навсегда останется «pending».
CHECKS=(
  "Web + backend (typecheck, tests, build)"
  "game_ops DB (migrations, privileges, mutations, load)"
  "Anchor program (build + unit + integration tests)"
  "Landing (typecheck, i18n parity, build)"
  "Build output gate (no secrets, maps or CDN in dist/)"
  "Backend container build"
  "Shell scripts (shellcheck, errors and warnings)"
  "gitleaks"
  "Secret scan, dependency-free (checklist §1.1)"
  "Deploy readiness (checklist §2, §7)"
  "readonly-exporter"
)
args=(
  -X PUT "repos/$REPO/branches/main/protection"
  -F "required_status_checks[strict]=true"
  -F "enforce_admins[enabled]=true"
  -F "required_pull_request_reviews[required_approving_review_count]=1"
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true"
  -F "required_pull_request_reviews[require_code_owner_reviews]=true"
  -F "required_conversation_resolution[enabled]=true"
  -F "allow_force_pushes[enabled]=false"
  -F "allow_deletions[enabled]=false"
  -F "restrictions="
)
for c in "${CHECKS[@]}"; do
  args+=(-F "required_status_checks[contexts][]=$c")
done

if gh api "${args[@]}" >/dev/null; then
  say "ok: main is protected (PR + 1 review + CODEOWNERS + checks, no force-push)"
else
  fail "could not set branch protection (need admin on $REPO)"
fi

step "Verify"
gh api "repos/$REPO" --jq '{visibility, default_branch}' || true
gh api "repos/$REPO/branches/main" --jq '.protected' || true

if [[ "$FAILED" -ne 0 ]]; then
  echo "" >&2
  echo "Some settings could not be applied from this account. They are a HUMAN gate:" >&2
  echo "  • Secret scanning + push protection + Dependabot alerts" >&2
  echo "  • Branch protection for main (PR review, CODEOWNERS, required checks)" >&2
  echo "Do them in the repository Settings UI (Code security / Branches) if the API refuses." >&2
  exit 1
fi
echo ""
echo "GitHub perimeter hardening applied. Record the date + who ran it in the audit log."
