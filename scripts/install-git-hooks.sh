#!/usr/bin/env bash
# Install the repository's git hooks (production-deploy checklist §1.3.6).
#
# Hooks live in .githooks/ so they are reviewed like any other code. They are
# not active until this script is run once per clone:
#
#   ./scripts/install-git-hooks.sh
#
# The script sets core.hooksPath=.githooks for THIS clone only (no global
# change) and refuses to overwrite a hooksPath that points somewhere else,
# so an existing hook setup (husky, pre-commit framework) is never silently
# replaced.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

current="$(git config --local --get core.hooksPath || true)"
if [[ -n "$current" && "$current" != ".githooks" ]]; then
  echo "core.hooksPath is already set to '$current' — leaving it untouched." >&2
  echo "To use the repository hooks instead: git config --local core.hooksPath .githooks" >&2
  exit 0
fi

git config --local core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "Git hooks installed from .githooks/ (core.hooksPath=.githooks)."
echo "Active hooks: $(ls .githooks | tr '\n' ' ')"
echo
echo "Verify the gate works:"
echo "  printf 'api_key = \"AAAAAAAAAAAAAAAAAAAA\"\\n' > /tmp/leak-demo.txt"
echo "  git add -f /tmp/leak-demo.txt 2>/dev/null || true   # use a file inside the repo"
echo "  git add <file> && git commit -m test   # must be rejected"
