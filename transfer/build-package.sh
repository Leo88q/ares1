#!/usr/bin/env bash
# build-package.sh — собирает передаваемый архив handoff-пакета ARES-1 для Games Watchtower
# из ТЕКУЩЕГО состояния репозитория (git HEAD), без ручных копий.
#
# Запуск из корня репозитория ares1:
#   bash transfer/build-package.sh
#
# Результат: transfer/ARES1-WATCHTOWER-HANDOFF-<дата>.tar.gz
# В архив попадают только документы/контракты/fixtures; SHA коммита подставляется
# автоматически в README и в скрипт установки. Секретов в пакете нет.

set -eu

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TRANSFER_DIR="$REPO_ROOT/transfer"
PKG_SRC="$TRANSFER_DIR/package"
DATE=$(date +%Y-%m-%d)
OUT="$TRANSFER_DIR/ARES1-WATCHTOWER-HANDOFF-$DATE.tar.gz"

cd "$REPO_ROOT"
SRC_COMMIT=$(git rev-parse HEAD)
SRC_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 1) Обязательные материалы (генерируются кодом — должны существовать).
REQUIRED="WATCHTOWER_HANDOFF.md
watchtower/integration-manifest.json
watchtower/address-registry.json
watchtower/events/event-catalog.json
watchtower/events/runtime-evidence.json
watchtower/events/ares1-idl.json
watchtower/events/ares1-event-map.json
watchtower/events/event-types.json
watchtower/events/schema.json
watchtower/README.md
watchtower/config.example.env"
for f in $REQUIRED; do
  [ -f "$f" ] || { echo "FATAL: отсутствует обязательный файл $f" >&2; exit 1; }
done
[ -d watchtower/events/fixtures/real-devnet ] || { echo "FATAL: нет fixtures/real-devnet" >&2; exit 1; }

# 2) Никаких секретов: прогоняем собственный сканер, если он есть.
if [ -f scripts/secret-scan.mjs ]; then
  node scripts/secret-scan.mjs >/dev/null || { echo "FATAL: secret-scan нашёл находки — пакет не собираем" >&2; exit 1; }
  echo "secret-scan: чисто"
fi

# 3) Сборка во временном каталоге.
WORK=$(mktemp -d 2>/dev/null || mktemp -d -t ares1pkg)
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/ares1-watchtower-handoff"
mkdir -p "$STAGE/payload/watchtower/events"

cp "$PKG_SRC/README.md" "$PKG_SRC/apply-ares1-handoff.sh" "$STAGE/"
sed -e "s/__SRC_COMMIT__/$SRC_COMMIT/g" -e "s#__SRC_BRANCH__#$SRC_BRANCH#g" \
  -i.bak "$STAGE/README.md" "$STAGE/apply-ares1-handoff.sh"
rm -f "$STAGE"/*.bak
chmod +x "$STAGE/apply-ares1-handoff.sh"

cp WATCHTOWER_HANDOFF.md "$STAGE/payload/"
( cd watchtower && tar -cf - \
    README.md integration-manifest.json address-registry.json config.example.env \
    events/ares1-idl.json events/ares1-event-map.json events/event-catalog.json \
    events/event-types.json events/runtime-evidence.json events/schema.json \
    events/fixtures ) | ( cd "$STAGE/payload/watchtower" && tar -xf - )

# 4) Упаковка + контроль.
tar -czf "$OUT" -C "$WORK" ares1-watchtower-handoff

FILES=$(tar -tzf "$OUT" | grep -c -v '/$')
if grep -rq "__SRC_" "$STAGE"; then echo "FATAL: в пакете остались незаполненные плейсхолдеры" >&2; exit 1; fi

echo
echo "Собрано: $OUT"
echo "  коммит : $SRC_COMMIT"
echo "  ветка  : $SRC_BRANCH"
echo "  файлов : $FILES"
echo "  sha256 : $(sha256sum "$OUT" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$OUT" | cut -d' ' -f1)"
