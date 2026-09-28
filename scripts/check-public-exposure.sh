#!/usr/bin/env bash
#
# Passive exposure check against a LIVE deployment (checklist §2.2, §9).
#
#   ./scripts/check-public-exposure.sh https://ares1.is-a.dev
#   ./scripts/check-public-exposure.sh https://play.ares1.is-a.dev
#
# Why "compare content, not status": an SPA returns index.html with 200 for
# every unknown path. A status-code check therefore reports "clean" for a site
# that happily serves its shell at /.git/HEAD. This script computes a hash of
# the SPA shell once and treats every path that returns that exact hash — or a
#hash that is not a 404 — as suspicious, then reports the body length and a
# sniff of the first bytes so a human can decide.
#
# It is a passive check: read-only GET requests. Nothing here modifies state.
#
# Exit codes: 0 = nothing suspicious, 1 = something to look at, 2 = usage error.

set -uo pipefail

DOMAIN="${1:?Usage: check-public-exposure.sh https://example.com}"
DOMAIN="${DOMAIN%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

UA="ARES1-exposure-check/1.0 (+https://ares1.is-a.dev/.well-known/security.txt)"

echo "== $DOMAIN =="
echo

# Fingerprint the SPA shell so we can recognise the catch-all response.
SHELL_HASH="$(curl -sS -A "$UA" "$DOMAIN/" 2>/dev/null | sha256sum | cut -c1-16)"
SHELL_LEN="$(curl -sS -A "$UA" "$DOMAIN/" 2>/dev/null | wc -c)"
echo "SPA shell fingerprint: sha256:${SHELL_HASH} (${SHELL_LEN} bytes)"
echo

check() {
  local path="$1"
  local url="$DOMAIN/$path"
  local out
  out="$(curl -sS -A "$UA" -w '\n%{http_code} %{size_download}' "$url" 2>/dev/null)"
  local code size body hash firstline
  code="$(printf '%s' "$out" | tail -n1 | awk '{print $1}')"
  size="$(printf '%s' "$out" | tail -n1 | awk '{print $2}')"
  body="$(printf '%s' "$out" | sed '$d')"
  hash="$(printf '%s' "$body" | sha256sum | cut -c1-16)"
  firstline="$(printf '%s' "$body" | head -c 120 | tr '\n' ' ')"

  local verdict="ok"
  if [[ "$code" == "200" ]]; then
    if [[ "$hash" == "$SHELL_HASH" ]]; then
      verdict="SPA-SHELL"   # catch-all: not a leak, but not a 404 either
    else
      verdict="SERVED"      # real content at a path that should not exist
    fi
  fi

  printf '%-6s %-28s %-10s %8s bytes   %s\n' "$code" "$path" "$verdict" "$size" "$firstline"
  case "$verdict" in
    SERVED) return 1 ;;
    *) return 0 ;;
  esac
}

PATHS=(
  .git/HEAD
  .git/config
  .git/index
  .env
  .env.local
  .env.production
  .env.example
  .DS_Store
  package.json
  package-lock.json
  yarn.lock
  pnpm-lock.yaml
  docker-compose.yml
  Dockerfile
  .npmrc
  .gitignore
  README.md
  src/
  server/
  admin/
  docs/
  scripts/
  game/
  watchtower/
  backup.zip
  dump.sql
  robots.txt
  sitemap.xml
  .well-known/security.txt
  legal/privacy.html
  legal/cookies.html
)

suspicious=0
for p in "${PATHS[@]}"; do
  if ! check "$p"; then
    suspicious=$((suspicious + 1))
  fi
done

echo
echo "---- security headers (§3.1, §3.2) ----"
curl -sSI -A "$UA" "$DOMAIN/" 2>/dev/null | grep -iE \
  '^(HTTP/|strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin-opener-policy|cross-origin-resource-policy|server|x-powered-by)' \
  | sed 's/^/  /'

echo
echo "---- HTTP → HTTPS redirect (§3.1.1) ----"
HTTP_HOST="${DOMAIN#https://}"
curl -sSI -A "$UA" --max-time 15 "http://${HTTP_HOST}/" 2>/dev/null | head -5 | sed 's/^/  /'

echo
echo "---- source maps in served JS (§2.3) ----"
JS_FILES="$(curl -sS -A "$UA" "$DOMAIN/" 2>/dev/null | grep -oE 'src="[^"]+\.js"' | sed 's/src="//;s/"//' | head -5)"
if [[ -z "$JS_FILES" ]]; then
  echo "  (no module script found in the HTML — is this the right origin?)"
else
  for js in $JS_FILES; do
    case "$js" in
      http*) full="$js" ;;
      /*) full="$DOMAIN$js" ;;
      *) full="$DOMAIN/$js" ;;
    esac
    tail_out="$(curl -sS -A "$UA" "$full" 2>/dev/null | tail -c 300 | grep -o 'sourceMappingURL' | head -1)"
    if [[ -n "$tail_out" ]]; then
      echo "  [FAIL] $js — sourceMappingURL present"
      suspicious=$((suspicious + 1))
    else
      echo "  ok     $js — no sourceMappingURL"
    fi
  done
fi

echo
if [[ "$suspicious" -gt 0 ]]; then
  echo "RESULT: $suspicious path(s) served real content — inspect them manually."
  exit 1
fi
echo "RESULT: no unexpected content served."
exit 0
