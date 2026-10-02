#!/usr/bin/env python3
"""size-experiments — измерительные варианты размера `.so` (не для мержа).

Задача (ревью отчёта): до вопросов человеку Q3/Q4 получить ЦИФРЫ, сколько
стоит тот или иной срез, и выразить их в SOL при текущей ставке rent.
Правила измерения (R8): цифра — это измерение, а не оценка; каждая аннотация
содержит `soBytes` и дельту к контрольному варианту `z`.

Варианты:
    z                 контроль: `anchor build` с CARGO_PROFILE_RELEASE_OPT_LEVEL=z;
    no-idl            то же + `anchor build --no-idl` (проверка влияния idl-build);
    no-m              вырезаны инструкции группы M (migrate_*) и migrations;
                      верхняя оценка, ABI не сохраняется;
    no-grant          вырезан оставшийся `grant_reward_once` (legacy `grant_reward`
                      уже удалена в исходнике; ABI не сохраняется);
    no-buy-field-sol  вырезан только `buy_field_sol` (кандидат Q4);
    arch-v3           `cargo build-sbf --arch v3`, смена платформы на SBPF v3.

Все варианты с удалением instruction меняют ABI и предназначены только для CI-
измерения, не для продуктового кода или мержа.

Порядок в CI (job `size-experiments`, только workflow_dispatch):
    1) python3 scripts/size-experiments.py --apply <вариант>
    2) python3 scripts/size-experiments.py --build <вариант>
    3) python3 scripts/size-experiments.py --metrics <вариант>

`--apply` всегда восстанавливает исходники из git, поэтому варианты не
накладываются друг на друга; `--metrics` переиспользует ci-metrics.py (тот же
формат аннотации `ares-so-*`) и добавляет разбивку символов нестрипнутого ELF.

`--audit` (Этап 2) — доказательная база для «доказанно лишнего кода»: разбор
задеплоенного ELF (target/deploy/*.so) — сходимость размера файла с суммой
заголовков и секций, энтропия и gzip-сжатие каждой секции, отсутствие
таблицы символов и отладочных секций, а также содержимое `.rodata` (строки
и маркеры panic/путей). Аннотация `ares-elf-audit`.
"""

import argparse
import json
import math
import os
import re
import struct
import subprocess
import sys
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LIB = Path("programs/solana_potato/src/lib.rs")
SO = Path("target/deploy/solana_potato.so")
# Нестрипнутый ELF сборки build-sbf (в target/deploy лежит strip-копия): путь
# зависит от версии CLI и --arch, поэтому ищем самый крупный файл в target.
ELF_PATTERNS = ["target/**/solana_potato.so", "target/**/solana_potato-*.so"]

VARIANTS = {
    "z": {"drop_fns": [], "drop_mod": None, "build": "anchor", "anchor_args": [], "note": "контроль (anchor build, opt-level z)"},
    "sbf": {"drop_fns": [], "drop_mod": None, "build": "cargo", "anchor_args": [], "note": "контроль прямой сборки (cargo build-sbf, без IDL)"},
    "no-idl": {"drop_fns": [], "drop_mod": None, "build": "anchor", "anchor_args": ["--no-idl"], "note": "без генерации IDL"},
    "no-m": {
        "drop_fns": [
            "migrate_presale_authority",
            "migrate_config",
            "migrate_field",
            "migrate_epoch",
            "migrate_admin_state",
        ],
        "drop_mod": "mod migrations;",
        "build": "anchor",
        "anchor_args": [],
        "note": "без группы M (ABI не сохраняется — только измерение)",
    },
    "no-grant": {
        "drop_fns": ["grant_reward_once"],
        "drop_mod": None,
        "build": "anchor",
        "anchor_args": [],
        "note": "без grant_reward_once (legacy grant_reward уже удалена; ABI не сохраняется — только измерение)",
    },
    "no-buy-field-sol": {
        "drop_fns": ["buy_field_sol"],
        "drop_mod": None,
        "build": "anchor",
        "anchor_args": [],
        "note": "без buy_field_sol (ABI не сохраняется — только измерение Q4)",
    },
    "arch-v3": {"drop_fns": [], "drop_mod": None, "build": "cargo", "anchor_args": ["--arch", "v3"], "note": "cargo build-sbf --arch v3 (гипотеза: минус .rel.dyn)"},
}


def escape(value: str) -> str:
    """Экранирование значения для workflow-команды GitHub."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def note(title: str, payload: dict) -> None:
    print(f"::notice title={title}::{escape(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))}")


def error(title: str, message: str) -> None:
    print(f"::error title={title}::{escape(message[:900])}")


def run(cmd, **kwargs):
    return subprocess.run(cmd, cwd=REPO, text=True, capture_output=True, **kwargs)


def git_restore() -> None:
    """Чистое состояние lib.rs: эксперименты не накладываются друг на друга."""
    run(["git", "checkout", "--", str(LIB)])


def drop_function(source: str, name: str) -> tuple[str, bool]:
    """Вырезает функцию `pub fn <name>(…)` вместе с телом (закрывающая `    }`).

    Функции в lib.rs объявлены внутри `impl` с отступом 4, закрывающая скобка
    функции — строка ровно `    }`. Внутри тела скобки имеют больший отступ,
    поэтому поиск первой такой строки после сигнатуры — граница функции.
    """
    marker = f"pub fn {name}("
    start = source.find(marker)
    if start < 0:
        return source, False
    line_start = source.rfind("\n", 0, start) + 1
    end = source.find("\n    }\n", start)
    if end < 0:
        return source, False
    return source[:line_start] + source[end + len("\n    }\n") :], True


def apply_variant(variant: str, dry_run: bool = False) -> None:
    spec = VARIANTS[variant]
    path = REPO / LIB
    if not dry_run:
        git_restore()
    source = path.read_text(encoding="utf-8")
    dropped, missing = [], []
    for name in spec["drop_fns"]:
        source, ok = drop_function(source, name)
        (dropped if ok else missing).append(name)
    if spec["drop_mod"]:
        pattern = re.compile(rf"^{re.escape(spec['drop_mod'])}\n", re.MULTILINE)
        if pattern.search(source):
            source = pattern.sub("", source, count=1)
            dropped.append(spec["drop_mod"])
        else:
            missing.append(spec["drop_mod"])
    if missing:
        error("ares-exp-apply", f"{variant}: не найдено для удаления: {', '.join(missing)}")
        sys.exit(1)
    # Баланс фигурных скобок: грубая проверка, что файл не разрезан пополам.
    if source.count("{") != source.count("}"):
        error("ares-exp-apply", f"{variant}: после вырезания нарушен баланс скобок")
        sys.exit(1)
    if not dry_run:
        path.write_text(source, encoding="utf-8")
    note("ares-exp-apply", {"variant": variant, "removed": dropped, "dryRun": dry_run, "note": spec["note"]})


def build_variant(variant: str) -> None:
    spec = VARIANTS[variant]
    env = dict(os.environ)
    env["CARGO_PROFILE_RELEASE_OPT_LEVEL"] = "z"
    # Проверка lock-файла — как в build-program.sh: сборка не должна менять Cargo.lock (R9).
    lock = (REPO / "Cargo.lock").read_bytes()
    if spec["build"] == "anchor":
        cmd = ["anchor", "build", *spec["anchor_args"]]
        result = subprocess.run(cmd, cwd=REPO, text=True, capture_output=True, env=env)
    else:
        # Прямая сборка Solana CLI (без anchor): используется как контроль для
        # --arch v3 и вариант без idl-build. `anchor build --arch` в 0.31.2
        # переключает на build-bpf (ProgramArch::{Bpf,Sbf}) — это НЕ SBPF-версия.
        cmd = ["cargo", "build-sbf", *spec["anchor_args"]]
        result = subprocess.run(cmd, cwd=REPO, text=True, capture_output=True, env=env)
    changed = (REPO / "Cargo.lock").read_bytes() != lock
    if result.returncode != 0:
        error("ares-exp-build", f"{variant}: {' '.join(cmd)} упал (код {result.returncode}): {result.stderr[-500:]}")
        sys.exit(1)
    if changed:
        error("ares-exp-build", f"{variant}: Cargo.lock изменился — измерение недействительно")
        sys.exit(1)
    note("ares-exp-build", {"variant": variant, "cmd": " ".join(cmd), "optLevel": "z", "lockUnchanged": True})


def find_elf() -> Path | None:
    """Самый крупный ELF в target — нестрипнутая сборка (strip-копия меньше)."""
    candidates = []
    for pattern in ELF_PATTERNS:
        candidates.extend(REPO.glob(pattern))
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_size)


def symbols_note(variant: str) -> None:
    """Разбивка `.text` по символам нестрипнутого ELF (топ-15 + суммы по префиксам)."""
    elf = find_elf()
    if elf is None:
        note("ares-symbols", {"variant": variant, "measured": False, "reason": "нестрипнутый ELF не найден"})
        return
    nm = subprocess.run(
        ["bash", "-lc", "command -v llvm-nm || find ~/.cache/solana ~/.local/share/solana -name 'llvm-nm*' -type f 2>/dev/null | head -1"],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    nm_path = nm.stdout.strip().splitlines()[-1] if nm.stdout.strip() else ""
    if not nm_path:
        note("ares-symbols", {"variant": variant, "measured": False, "reason": "llvm-nm не найден"})
        return
    out = subprocess.run([nm_path, "--size-sort", "-C", "--print-size", str(elf)], cwd=REPO, text=True, capture_output=True)
    entries = []
    for line in out.stdout.splitlines():
        parts = line.split(" ", 2)
        if len(parts) == 3 and re.fullmatch(r"[0-9a-f]+", parts[1]):
            entries.append((int(parts[1], 16), parts[2]))
    top = [{"bytes": size, "symbol": name[:120]} for size, name in entries[-15:][::-1]]
    total = sum(size for size, _ in entries)
    payload = {"variant": variant, "elf": str(elf.relative_to(REPO)), "elfBytes": elf.stat().st_size, "symbols": len(entries), "totalBytes": total, "top": top}
    note("ares-symbols", payload)



# --- Этап 2: аудит ELF (секции, энтропия, строки, доказательство strip) ------

PRINTABLE = re.compile(rb"[\x20-\x7e]{4,}")
SUSPICIOUS_MARKERS = ("panicked at", ".rs:", "/rustc/", "src/", "unwrap", "RUST_BACKTRACE")


def entropy(data: bytes) -> float:
    """Энтропия Шеннона в битах/байт (0 — константы, 8 — случайные данные)."""
    if not data:
        return 0.0
    counts = [0] * 256
    for byte in data:
        counts[byte] += 1
    total = len(data)
    return -sum((c / total) * math.log2(c / total) for c in counts if c)


def gzip_ratio(data: bytes) -> float:
    if not data:
        return 0.0
    return round(len(zlib.compress(data, 9)) / len(data), 4)


def parse_elf(path: Path) -> dict:
    """ELF64-LE: заголовок, таблицы, секции. Возвращает только факты о файле."""
    raw = path.read_bytes()
    if raw[:4] != b"\x7fELF" or raw[4] != 2 or raw[5] != 1:
        raise ValueError("не ELF64 little-endian")
    e_phoff, = struct.unpack_from("<Q", raw, 0x20)
    e_shoff, = struct.unpack_from("<Q", raw, 0x28)
    e_phentsize, e_phnum = struct.unpack_from("<HH", raw, 0x36)
    e_shentsize, e_shnum, e_shstrndx = struct.unpack_from("<HHH", raw, 0x3A)

    def read_sh(index: int) -> dict:
        base = e_shoff + index * e_shentsize
        (name, sh_type, flags, addr, offset, size, link, info, align, entsize) = struct.unpack_from(
            "<IIQQQQIIQQ", raw, base
        )
        return {"nameOffset": name, "type": sh_type, "flags": flags, "addr": addr, "offset": offset, "size": size,
                "link": link, "info": info, "align": align, "entsize": entsize}

    shstr = read_sh(e_shstrndx)
    names = raw[shstr["offset"]: shstr["offset"] + shstr["size"]]

    def name_of(offset: int) -> str:
        end = names.find(b"\x00", offset)
        return names[offset:end if end >= 0 else None].decode("utf-8", "replace")

    sections = []
    for index in range(e_shnum):
        sh = read_sh(index)
        name = name_of(sh["nameOffset"]) or f"<{index}>"
        on_disk = 0 if sh["type"] == 8 else sh["size"]  # SHT_NOBITS (.bss) не занимает файл
        data = raw[sh["offset"]: sh["offset"] + on_disk] if on_disk else b""
        sections.append({
            "name": name, "type": sh["type"], "bytes": sh["size"], "onDisk": on_disk, "offset": sh["offset"],
            "entropy": round(entropy(data), 3) if data else 0.0,
            "gzipRatio": gzip_ratio(data),
        })

    rodata = next((s for s in sections if s["name"] == ".rodata"), None)
    strings = []
    markers = {}
    if rodata and rodata["bytes"]:
        blob = raw[rodata["offset"]: rodata["offset"] + rodata["bytes"]]
        found = PRINTABLE.findall(blob)
        strings = [s.decode("ascii", "replace") for s in found]
        for marker in SUSPICIOUS_MARKERS:
            markers[marker] = sum(1 for s in strings if marker in s)

    section_bytes = sum(s["onDisk"] for s in sections)
    headers = 64 + e_phnum * e_phentsize + e_shnum * e_shentsize
    return {
        "bytes": len(raw),
        "headers": {"elfHeader": 64, "phnum": e_phnum, "phentsize": e_phentsize, "shnum": e_shnum,
                    "shentsize": e_shentsize, "headerBytes": headers},
        "sumCheck": {"sectionsOnDisk": section_bytes, "headers": headers, "total": section_bytes + headers,
                     "fileBytes": len(raw), "matches": section_bytes + headers == len(raw)},
        "sections": [s for s in sections if s["bytes"]],
        "symtab": {
            "symtab": any(s["name"] == ".symtab" for s in sections),
            "strtab": any(s["name"] == ".strtab" for s in sections),
            "debugSections": [s["name"] for s in sections if s["name"].startswith(".debug")],
            "dynsymBytes": next((s["bytes"] for s in sections if s["name"] == ".dynsym"), 0),
        },
        "rodata": {
            "bytes": rodata["bytes"] if rodata else 0,
            "strings": len(strings),
            "stringBytes": sum(len(s) for s in strings),
            "markers": markers,
            "top": [{"bytes": len(s), "text": s[:70]} for s in sorted(strings, key=len, reverse=True)[:10]],
        },
    }


def audit_so() -> None:
    """Аудит задеплоенного `.so` (strip-копия) — что именно попадает в залог."""
    if not SO.exists():
        error("ares-elf-audit", f"{SO} не найден — аудит не выполнен")
        sys.exit(1)
    try:
        payload = parse_elf(SO)
    except Exception as exc:  # noqa: BLE001 — диагностика важнее типа
        error("ares-elf-audit", f"разбор ELF упал: {exc}")
        sys.exit(1)
    payload["so"] = str(SO)
    note("ares-elf-audit", payload)


def metrics_variant(variant: str) -> None:
    # Тот же формат, что у матрицы размеров: одна строка ares-so-<вариант>.
    result = subprocess.run(
        [sys.executable, "scripts/ci-metrics.py", "--variant", f"exp-{variant}", "--so", str(SO)],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        error("ares-exp-metrics", f"{variant}: ci-metrics.py упал (код {result.returncode})")
        sys.exit(1)
    symbols_note(variant)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--apply", metavar="ВАРИАНТ")
    group.add_argument("--build", metavar="ВАРИАНТ")
    group.add_argument("--metrics", metavar="ВАРИАНТ")
    group.add_argument("--audit", action="store_true", help="аудит задеплоенного ELF (секции, энтропия, строки)")
    group.add_argument("--list", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="для --apply: не трогать рабочую копию")
    args = parser.parse_args()

    if args.list:
        for name, spec in VARIANTS.items():
            print(f"{name}\t{spec['note']}")
        return 0
    if args.audit:
        audit_so()
        return 0
    variant = args.apply or args.build or args.metrics
    if variant not in VARIANTS:
        error("ares-exp", f"неизвестный вариант {variant}; есть: {', '.join(VARIANTS)}")
        return 1
    if args.apply:
        apply_variant(variant, dry_run=args.dry_run)
    elif args.build:
        build_variant(variant)
    else:
        metrics_variant(variant)
    return 0


if __name__ == "__main__":
    sys.exit(main())
