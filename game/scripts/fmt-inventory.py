"""Bounded `cargo fmt --check` diff as check annotations.

Same reason as scripts/clippy-inventory.py: the job log archive cannot be
downloaded from API-only review environments, and ci-run.sh keeps only the last
~20 lines of a failing command, so a formatting debt of several hunks shows up
as one truncated tail. This publishes the whole diff, split into chunks that
fit GitHub's per-step annotation limit (ten notices, 4096 characters each).

Public build metadata only: file paths and source lines, nothing else.
"""
import re
import sys

MAX_NOTICES = 9
MAX_CHARS = 3800


def escape(text):
    return text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def split_hunks(text):
    """`cargo fmt --check` prints `Diff in <path>:<line>:` before each hunk."""
    parts = re.split(r'(?m)^(?=Diff in )', text)
    return [p for p in parts if p.startswith('Diff in ')] or (
        [text] if text.strip() else []
    )


def chunk(hunks):
    pages, current = [], ''
    for hunk in hunks:
        candidate = f'{current}{hunk}' if current else hunk
        if len(candidate) > MAX_CHARS:
            if current:
                pages.append(current)
            current = hunk[:MAX_CHARS]
        else:
            current = candidate
    if current:
        pages.append(current)
    return pages[:MAX_NOTICES]


def main():
    text = sys.stdin.read()
    if not text.strip():
        print('::notice title=fmt inventory::clean: cargo fmt reports no diff')
        return
    hunks = split_hunks(text)
    counts = {}
    for hunk in hunks:
        match = re.match(r'Diff in ([^:]+):', hunk)
        if match:
            name = match.group(1).split('/')[-1]
            counts[name] = counts.get(name, 0) + 1
    summary = f'{len(hunks)} hunks: ' + '; '.join(
        f'{name} x{count}' for name, count in sorted(counts.items(), key=lambda kv: -kv[1])
    )
    print('::notice title=fmt inventory::' + escape(summary))
    for index, page in enumerate(chunk(hunks), start=1):
        print(f'::notice title=fmt diff {index}::' + escape(page))


if __name__ == '__main__':
    main()
