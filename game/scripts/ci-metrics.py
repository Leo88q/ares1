"""Метрики собранной программы в виде check-аннотаций (измерительный контур rent-audit).

Зачем: артефакты CI и логи джоб недоступны из API-only окружений (Приложение B.4),
единственный читаемый канал — аннотации check-run. Здесь — размер `.so`, sha256 и
секции ELF; цифры публичные (R11), ключей и секретов не касаемся.

Формат совпадает с game/scripts/publish-idl-annotation.py: одна строка
`::notice title=ares-so-<вариант>::{"bytes":…,…}`. Значение экранируется по
правилам GitHub workflow-команд (`%`, `\r`, `\n`).

Использование:
    python3 scripts/ci-metrics.py --variant base [--so target/deploy/solana_potato.so]
"""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

# Лимит GitHub на одну аннотацию — 4096 символов; держим запас (практика репозитория — 3500).
MAX_ANNOTATION = 3500
MAX_SECTIONS = 16


def escape(value: str) -> str:
    """Экранирование значения для `::notice title=…::<value>`."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def read_sections(so_path: Path) -> dict:
    """Размеры секций ELF через `readelf -S -W`. Недоступность readelf — не ошибка сборки."""
    try:
        out = subprocess.run(
            ["readelf", "-S", "-W", str(so_path)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:  # pragma: no cover - зависит от окружения
        print(f"::warning title=ares-so-readelf::readelf недоступен: {exc}")
        return {}
    sections = {}
    # Строка вида (readelf -S -W):
    #   [ 1] .text             PROGBITS        0000000000000000 0000e0 012345 00  AX  0   0 16
    # Имя секции может быть пустым (NULL-секция) — такие строки пропускаем.
    pattern = re.compile(
        r"^\s*\[\s*\d+\]\s+(?P<name>\S+)\s+(?P<type>\S+)\s+(?P<addr>[0-9a-f]+)\s+"
        r"(?P<off>[0-9a-f]+)\s+(?P<size>[0-9a-f]+)\s"
    )
    for line in out.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        sections[match.group("name")] = int(match.group("size"), 16)
    return sections


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--so", default="target/deploy/solana_potato.so")
    parser.add_argument("--variant", required=True, help="base | 3 | s | z | имя замеряемого профиля")
    args = parser.parse_args()

    so_path = Path(args.so)
    if not so_path.is_file():
        print(f"::error title=ares-so-{args.variant}::файл не найден: {so_path}")
        return 2
    data = so_path.read_bytes()
    sections = read_sections(so_path)
    # Крупнейшие секции первыми: важно видеть, что именно растёт/сжимается.
    ordered = dict(sorted(sections.items(), key=lambda kv: -kv[1]))
    # gzipBytes — независимая перекрёстная проверка: размер артефакта CI
    # (zip = gzip .so + gzip IDL) можно сверить с этой цифрой по API, не
    # скачивая артефакт (скачивание из песочницы недоступно, B.4).
    gzip_bytes = len(gzip.compress(data, compresslevel=9, mtime=0))
    payload = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
               "gzipBytes": gzip_bytes, "sections": ordered}
    message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    if len(message) > MAX_ANNOTATION:
        trimmed = dict(list(ordered.items())[:MAX_SECTIONS])
        payload["sections"] = trimmed
        payload["sectionsTruncated"] = len(ordered) - len(trimmed)
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    if len(message) > MAX_ANNOTATION:
        print(f"::error title=ares-so-{args.variant}::аннотация не влезает в лимит")
        return 2
    print(f"::notice title=ares-so-{args.variant}::" + escape(message))
    return 0


if __name__ == "__main__":
    sys.exit(main())
