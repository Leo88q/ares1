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

Запуск (в CI, после `anchor test`):
    python3 scripts/cu-profile.py --log /tmp/anchor-test.log --annotate
    python3 scripts/cu-profile.py --log /tmp/anchor-test.log --json

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


def note(title: str, payload: dict) -> None:
    print(f"::notice title={title}::{escape(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))}")


def parse(log_path: Path, program_id: str | None) -> dict:
    text = ANSI.sub("", log_path.read_text(encoding="utf-8", errors="replace"))
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
            "instruction": name,
            "calls": len(values),
            "cuMin": min(values),
            "cuMedian": int(statistics.median(values)),
            "cuMax": max(values),
            "budgetMin": min(budgets[name]),
        })
    rows.sort(key=lambda r: r["cuMedian"], reverse=True)
    measured = bool(rows)
    payload = {
        "measured": measured,
        "log": str(log_path),
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
    parser.add_argument("--log", required=True)
    parser.add_argument("--program-id", default=None, help="считать CU только этой программы (CPI отсекаются)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--annotate", action="store_true")
    args = parser.parse_args()

    log_path = Path(args.log)
    if not log_path.exists():
        note("ares-cu", {"measured": False, "reason": f"лог {log_path} не найден"})
        print(f"лог {log_path} не найден", file=sys.stderr)
        return 1

    payload = parse(log_path, args.program_id)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    elif args.annotate:
        note("ares-cu", payload)
        if payload["measured"]:
            for row in payload["top"]:
                print(f"{row['instruction']:<28} median {row['cuMedian']:>7} CU (max {row['cuMax']})")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
