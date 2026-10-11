#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run from any directory. Compose project/ports/DB are isolated per cluster.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GAME_DIR="$REPO_ROOT/game"
PROJECT="${COMPOSE_PROJECT_NAME:-ares1-devnet}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-}"
REMOTE_ROOT="${R2_BACKUP_REMOTE:?Set R2_BACKUP_REMOTE to an rclone R2 remote/path (no credentials)}"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v rclone >/dev/null || { echo "rclone is required" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required to encrypt backups before upload" >&2; exit 1; }
RECIPIENT_FILE="${BACKUP_AGE_RECIPIENT_FILE:?Set BACKUP_AGE_RECIPIENT_FILE to a file containing the cold-storage age recipient}"
[[ -r "$RECIPIENT_FILE" ]] || { echo "age recipient file is not readable" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="${PROJECT}-${stamp}.dump.age"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
backup_file="$tmpdir/$backup_name"
manifest_file="$tmpdir/$backup_name.sha256"

cd "$GAME_DIR"
compose_args=(-p "$PROJECT")
if [[ -n "$COMPOSE_ENV_FILE" ]]; then
  [[ -r "$COMPOSE_ENV_FILE" ]] || { echo "Compose env file is not readable" >&2; exit 1; }
  compose_args+=(--env-file "$COMPOSE_ENV_FILE")
fi
container="$(docker compose "${compose_args[@]}" ps -q postgres)"
if [[ -z "$container" ]]; then
  echo "Postgres container is not running for Compose project $PROJECT" >&2
  exit 1
fi

docker compose "${compose_args[@]}" exec -T postgres \
  pg_dump --username=postgres --dbname=ares1 --format=custom --compress=6 \
  | age --encrypt --recipients-file "$RECIPIENT_FILE" --output "$backup_file"
if [[ ! -s "$backup_file" ]]; then
  echo "pg_dump produced an empty backup; refusing upload" >&2
  exit 1
fi

checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
printf '%s  %s\n' "$checksum" "$backup_name" > "$manifest_file"
remote_path="${REMOTE_ROOT%/}/$PROJECT"
rclone copyto "$backup_file" "$remote_path/$backup_name"
rclone copyto "$manifest_file" "$remote_path/$backup_name.sha256"
printf 'Backup uploaded: %s/%s (sha256=%s)\n' "$remote_path" "$backup_name" "$checksum"
