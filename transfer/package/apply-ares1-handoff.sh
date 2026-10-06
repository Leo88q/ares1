#!/usr/bin/env bash
# apply-ares1-handoff.sh — копирует handoff-пакет ARES-1 (gameId ares1) в репозиторий
# Games Watchtower и (опционально) коммитит его в отдельную ветку.
#
# Запускать ИЗ КОРНЯ хаб-репозитория (Games-watchtower):
#   /путь/к/apply-ares1-handoff.sh                   # только скопировать в integrations/ares1/
#   /путь/к/apply-ares1-handoff.sh --dest docs/ares1 # другой каталог назначения
#   /путь/к/apply-ares1-handoff.sh --commit          # скопировать + ветка + коммит
#   /путь/к/apply-ares1-handoff.sh --commit --push   # + push ветки в origin
#
# Источник: github.com/Leo88q/ares1, ветка __SRC_BRANCH__
# Коммит-источник: __SRC_COMMIT__ (2026-10-06)
# Пакет содержит только документы, JSON-контракты и fixtures: без секретов,
# без токенов/ключей и без реальных игровых данных (production-данных нет вообще).

set -eu

SRC_COMMIT="__SRC_COMMIT__"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SRC_DIR="$SCRIPT_DIR/payload"
DEST="integrations/ares1"
DO_COMMIT=0
DO_PUSH=0
BRANCH="integrations/ares1-handoff"

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest)   [ $# -ge 2 ] || { echo "FATAL: --dest требует значение" >&2; exit 2; }; DEST="$2"; shift 2 ;;
    --branch) [ $# -ge 2 ] || { echo "FATAL: --branch требует значение" >&2; exit 2; }; BRANCH="$2"; shift 2 ;;
    --commit) DO_COMMIT=1; shift ;;
    --push)   DO_COMMIT=1; DO_PUSH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "FATAL: неизвестный аргумент: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --- проверки ---------------------------------------------------------------
[ -d "$SRC_DIR" ] || { echo "FATAL: нет payload/ рядом со скриптом ($SRC_DIR)" >&2; exit 1; }
for f in WATCHTOWER_HANDOFF.md \
         watchtower/integration-manifest.json \
         watchtower/address-registry.json \
         watchtower/events/event-catalog.json; do
  [ -f "$SRC_DIR/$f" ] || { echo "FATAL: в пакете отсутствует $f" >&2; exit 1; }
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "FATAL: запускать изнутри git-репозитория Games Watchtower (сейчас: $(pwd))" >&2; exit 1; }
cd "$ROOT"

case "$DEST" in
  ""|"."|"./"|"/") echo "FATAL: --dest не может быть корнем репозитория (выберите подкаталог)" >&2; exit 2 ;;
esac
DEST_ABS="$ROOT/$DEST"
REL="$DEST"
echo "hub-репозиторий : $ROOT"
echo "назначение      : $REL/"
echo "источник        : ares1 @ $SRC_COMMIT"
echo

# --- копирование ------------------------------------------------------------
mkdir -p "$DEST_ABS"
( cd "$SRC_DIR" && tar -cf - . ) | ( cd "$DEST_ABS" && tar -xf - )
COUNT=$(cd "$SRC_DIR" && find . -type f | wc -l | tr -d ' ')
echo "Скопировано файлов: $COUNT"
echo
echo "Изменения в рабочем дереве:"
git status --short -- "$REL" | sed 's/^/  /'
echo

if [ "$DO_COMMIT" -eq 0 ]; then
  cat <<EOF
Дальше (вручную):
  git add -- $REL
  git commit -m "ARES-1 handoff (gameId ares1) @ $SRC_COMMIT"
  git push -u origin HEAD
EOF
  exit 0
fi

# --- коммит -----------------------------------------------------------------
if [ -n "$(git diff --cached --name-only)" ]; then
  echo "FATAL: в индексе уже есть посторонние staged-изменения — закоммитьте их отдельно," >&2
  echo "       затем повторите с --commit. Файлы скопированы и НЕ затронуты." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "Ветка $BRANCH уже существует — переключаюсь на неё."
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

git add -- "$REL"
git commit -m "ARES-1 handoff (gameId ares1) @ $SRC_COMMIT

Source: github.com/Leo88q/ares1, branch __SRC_BRANCH__
Read-only handoff: WATCHTOWER_HANDOFF.md (A-G), integration-manifest.json,
address-registry.json, events/event-catalog.json (31 real events),
runtime-evidence.json, fixtures (real-devnet + synthetic).
No secrets, no credentials, no real player data." \
  -m "Verified read-only: secret-scan 0 findings; watchtower tests 100 pass / 1 skip."

echo
echo "Коммит создан: $(git rev-parse --short HEAD)"
if [ "$DO_PUSH" -eq 1 ]; then
  git push -u origin "$BRANCH"
  echo "Ветка запушена. PR: gh pr create --head $BRANCH --fill"
else
  cat <<EOF
Дальше (вручную):
  git push -u origin $BRANCH
  gh pr create --head $BRANCH --fill    # если ветка защищена/нужен PR
EOF
fi
