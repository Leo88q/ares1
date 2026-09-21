#!/usr/bin/env bash
# tree: tracked + new, non-ignored files only (includes uncommitted edits).
# history: all fetched refs, with fully redacted findings. Private local env/key
# files and downloaded CI artifacts require a separate explicit `gitleaks dir`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
case "${1:-tree}" in
  tree)
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    while IFS= read -r -d '' file; do
      [[ -f "$file" && ! -L "$file" ]] || continue
      mkdir -p "$TMP/$(dirname "$file")"
      cp -- "$file" "$TMP/$file"
    done < <(git ls-files -z --cached --others --exclude-standard)
    gitleaks dir "$TMP" --config "$PWD/.gitleaks.toml" --redact=100 --no-banner
    ;;
  history)
    [[ "$(git rev-parse --is-shallow-repository)" == false ]] || { echo 'Fetch complete history first' >&2; exit 1; }
    gitleaks git . --config .gitleaks.toml --log-opts='--all' --redact=100 --no-banner
    ;;
  *) echo 'Usage: scan-secrets.sh tree|history' >&2; exit 2 ;;
esac
