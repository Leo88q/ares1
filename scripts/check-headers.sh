#!/usr/bin/env bash
#
# Header and TLS sanity check for a live deployment (checklist §3.1, §3.2, §9).
#
#   ./scripts/check-headers.sh https://ares1.is-a.dev
#
# This is the part of the checklist you can verify from outside without
# touching the host. It does not replace SSL Labs or securityheaders.com — it
# is the fast pre-flight you run after every deploy.
#
# Exit codes: 0 = all required headers present, 1 = at least one missing.

set -uo pipefail

DOMAIN="${1:?Usage: check-headers.sh https://example.com}"
DOMAIN="${DOMAIN%/}"
UA="ARES1-header-check/1.0"

echo "== $DOMAIN =="
echo

HEADERS="$(curl -sSI -A "$UA" --max-time 20 "$DOMAIN/" 2>/dev/null)"

# Lowercase names, one per line, "name: value" -> "name value"
norm() {
  printf '%s' "$HEADERS" | tr -d '\r' | awk -F': ' '/^[A-Za-z-]+:/ {print tolower($1)}'
}

present() {
  norm | grep -qx "$1"
}

value_of() {
  printf '%s' "$HEADERS" | tr -d '\r' | awk -F': ' -v n="$1" 'tolower($1)==n {print substr($0, index($0,": ")+2)}' | head -1
}

required=(
  strict-transport-security
  content-security-policy
  x-content-type-options
  referrer-policy
  x-frame-options
  permissions-policy
)

optional=(
  cross-origin-opener-policy
  cross-origin-resource-policy
)

missing=0
for h in "${required[@]}"; do
  if present "$h"; then
    printf '  [OK]   %s: %s\n' "$h" "$(value_of "$h" | cut -c1-90)"
  else
    printf '  [MISS] %s\n' "$h"
    missing=$((missing + 1))
  fi
done

for h in "${optional[@]}"; do
  if present "$h"; then
    printf '  [ok]   %s: %s\n' "$h" "$(value_of "$h" | cut -c1-60)"
  else
    printf '  [--]   %s (recommended)\n' "$h"
  fi
done

echo
echo "-- assertions --"

csp="$(value_of content-security-policy)"
if [[ -n "$csp" ]]; then
  if printf '%s' "$csp" | grep -q "script-src[^;]*'unsafe-inline'"; then
    echo "  [FAIL] script-src allows 'unsafe-inline' — inline markup can execute"
    missing=$((missing + 1))
  else
    echo "  [OK]   script-src has no 'unsafe-inline'"
  fi
  if printf '%s' "$csp" | grep -q "script-src[^;]*'unsafe-eval'"; then
    echo "  [FAIL] script-src allows 'unsafe-eval'"
    missing=$((missing + 1))
  else
    echo "  [OK]   script-src has no 'unsafe-eval'"
  fi
  if printf '%s' "$csp" | grep -q "frame-ancestors 'none'"; then
    echo "  [OK]   frame-ancestors 'none' (clickjacking protection on signing screens)"
  else
    echo "  [WARN] frame-ancestors is not 'none'"
  fi
  if printf '%s' "$csp" | grep -q "object-src 'none'"; then
    echo "  [OK]   object-src 'none'"
  else
    echo "  [WARN] object-src is not 'none'"
  fi
fi

hsts="$(value_of strict-transport-security)"
if [[ -n "$hsts" ]]; then
  age="$(printf '%s' "$hsts" | grep -oE 'max-age=[0-9]+' | cut -d= -f2)"
  if [[ -n "$age" && "$age" -ge 31536000 ]]; then
    echo "  [OK]   HSTS max-age >= 1 year ($age)"
  else
    echo "  [WARN] HSTS max-age is below 1 year ($age)"
  fi
fi

# Version-banner headers (§3.2.3).
for h in server x-powered-by; do
  v="$(value_of "$h")"
  if [[ -n "$v" ]]; then
    if printf '%s' "$v" | grep -qE '[0-9]+\.[0-9]+'; then
      echo "  [WARN] $h exposes a version: $v"
    else
      echo "  [ok]   $h: $v (no version)"
    fi
  else
    echo "  [ok]   $h absent"
  fi
done

echo
echo "-- HTTP -> HTTPS (§3.1.1) --"
HTTP_HOST="${DOMAIN#https://}"
curl -sSI -A "$UA" --max-time 15 "http://${HTTP_HOST}/" 2>/dev/null | head -3 | sed 's/^/  /'

echo
echo "-- TLS (§3.1.3) --"
if command -v openssl >/dev/null 2>&1; then
  printf '  '
  echo | openssl s_client -connect "${HTTP_HOST}:443" -servername "$HTTP_HOST" 2>/dev/null \
    | grep -E '^(New|Protocol|Cipher)' | head -3 | tr '\n' ' ' | sed 's/^/  /'
  echo
else
  echo "  (openssl not installed)"
fi

echo
if [[ "$missing" -gt 0 ]]; then
  echo "RESULT: $missing required header check(s) failed."
  exit 1
fi
echo "RESULT: all required headers present."
