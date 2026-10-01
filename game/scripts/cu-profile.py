#!/usr/bin/env python3
"""cu-profile — сколько compute units (CU) стоит каждая инструкция.

Зачем (Этап 2): размер `.so` и CU — две стороны одного кода. Профиль отвечает
на вопросы: какие инструкции самые дорогие (кандидаты на переписывание), и не
упирается ли какая-нибудь из них в бюджет 200 000 CU. Цифры берутся не из
оценок, а из лога `anchor test` на localnet: runtime печатает
`Program <id> consumed N of M compute units` после каждой инструкции Anchor
(`Program log: Instruction: <Name>`).

Классификация CU-строк: считаются только строки НАШЕЙ программы
(`--program-id`), потому что CPI в SPL Token тоже печатает `consumed`.

Источник в CI: `anchor test` стримит логи программы через `solana logs` в
`.anchor/program-logs/<program-id>.<lib>.log` (см. `stream_logs` в
`cli/src/lib.rs` Anchor 0.31.2), а не в свой stdout — эти файлы и читаются.

Запуск (в CI, после `anchor test`):
    python3 scripts/cu-profile.py --log .anchor/program-logs/*.log --annotate
    python3 scripts/cu-profile.py --log <лог> --log <ещё лог> --json

Если в логе нет CU-строк (например, Anchor их не стримит), аннотация выходит
с `measured: false` и диагностикой — молчаливого «нуля» не бывает.
"""

import argparse
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
INSTRUCTION = re.compile(r"Program log: Instruction:\s*([A-Za-z0-9_]+)")
CONSUMED = re.compile(r"Program (\S+) consumed (\d+) of (\d+) compute units")


def escape(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


# Аннотация GitHub обрезается на ~4 КБ: списки уходят несколькими частями
# (`ares-cu`, `ares-cu-2`, ...) с полями itemsFrom/itemsTotal, чтобы читатель
# мог склеить их без потерь.
ANNOTATION_LIMIT = 3800


def emit(title: str, payload: dict) -> None:
    print(f"::notice title={title}::{escape(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))}")


def note(title: str, payload: dict, split_key: str | None = None) -> None:
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(text) <= ANNOTATION_LIMIT or not split_key:
        emit(title, payload)
        return
    items = payload[split_key]
    base = {k: v for k, v in payload.items() if k != split_key}
    start = 0
    part = 1
    while start < len(items):
        take = len(items) - start
        while take > 1:
            candidate = dict(base)
            candidate[split_key] = items[start:start + take]
            candidate["itemsFrom"] = start
            candidate["itemsTotal"] = len(items)
            candidate["part"] = part
            if len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))) <= ANNOTATION_LIMIT:
                break
            take -= 1
        chunk = dict(base)
        chunk[split_key] = items[start:start + take]
        chunk["itemsFrom"] = start
        chunk["itemsTotal"] = len(items)
        chunk["part"] = part
        emit(title if part == 1 else f"{title}-{part}", chunk)
        start += take
        part += 1


def parse(log_paths: list[Path], program_id: str | None) -> dict:
    text = "\n".join(
        ANSI.sub("", path.read_text(encoding="utf-8", errors="replace")) for path in log_paths
    )
    per_instruction: dict[str, list[int]] = defaultdict(list)
    budgets: dict[str, list[int]] = defaultdict(list)
    last_instruction = None
    instruction_lines = 0
    consumed_lines = 0
    foreign_consumed = 0
    for line in text.splitlines():
        found = INSTRUCTION.search(line)
        if found:
            last_instruction = found.group(1)
            instruction_lines += 1
            continue
        found = CONSUMED.search(line)
        if not found:
            continue
        consumed_lines += 1
        pid, consumed, budget = found.group(1), int(found.group(2)), int(found.group(3))
        if program_id and pid != program_id:
            foreign_consumed += 1
            continue
        name = last_instruction or "<без Instruction:>"
        per_instruction[name].append(consumed)
        budgets[name].append(budget)

    rows = []
    for name, values in per_instruction.items():
        rows.append({
            "i": name,
            "n": len(values),
            "min": min(values),
            "med": int(statistics.median(values)),
            "max": max(values),
            "bud": min(budgets[name]),
        })
    rows.sort(key=lambda r: r["med"], reverse=True)
    measured = bool(rows)
    payload = {
        "measured": measured,
        "logs": [str(p) for p in log_paths],
        "programId": program_id,
        "instructionsSeen": len({INSTRUCTION.search(l).group(1) for l in text.splitlines() if INSTRUCTION.search(l)}),
        "instructionLogLines": instruction_lines,
        "consumedLines": consumed_lines,
        "foreignConsumedLines": foreign_consumed,
        "instructions": rows,
        "top": rows[:10],
        "note": "CU из лога localnet (anchor test); для каждой инструкции — min/median/max по вызовам",
    }
    if not measured:
        payload["reason"] = (
            "в логе нет строк `Program <наш id> consumed N of M compute units`; "
            "диагностика — инструкций в логе: %d, CU-строк: %d" % (instruction_lines, consumed_lines)
        )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, action="append", help="путь к логу (можно несколько раз)")
    parser.add_argument("--program-id", default=None, help="считать CU только этой программы (CPI отсекаются)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--annotate", action="store_true")
    args = parser.parse_args()

    log_paths = [Path(p) for p in args.log]
    missing = [str(p) for p in log_paths if not p.exists()]
    if missing:
        note("ares-cu", {"measured": False, "reason": f"логи не найдены: {', '.join(missing)}"})
        print(f"логи не найдены: {', '.join(missing)}", file=sys.stderr)
        return 1

    payload = parse(log_paths, args.program_id)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    elif args.annotate:
        note("ares-cu", payload, split_key="instructions")
        if payload["measured"]:
            for row in payload["top"]:
                print(f"{row['i']:<28} median {row['med']:>7} CU (max {row['max']})")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
