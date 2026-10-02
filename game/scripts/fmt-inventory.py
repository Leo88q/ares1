"""Bounded `cargo fmt --check` diff as check annotations.

Same reason as scripts/clippy-inventory.py: the job log archive cannot be
downloaded from API-only review environments, and ci-run.sh keeps only the last
~20 lines of a failing command, so a formatting debt of several hunks shows up
as one truncated tail. This publishes the whole diff, split into chunks that
fit GitHub's per-step annotation limit (ten notices, 4096 characters each).

Public build metadata only: file paths and source lines, nothing else.

Acceptance gate (F-22): `--max-hunks=N` turns this from a report into an
enforcement step. The rustfmt version is pinned by rust-toolchain.toml, so the
hunk count is deterministic for a given tree; a count above the recorded debt
means new unformatted code landed and the step fails. A count below N is good
(the debt shrank). Omit the flag to keep the old always-green report mode.
"""
import re
import sys

MAX_NOTICES = 9
MAX_CHARS = 3800


def max_hunks_from_argv():
    for arg in sys.argv[1:]:
        if arg.startswith('--max-hunks='):
            return int(arg.split('=', 1)[1])
        if arg == '--max-hunks':
            sys.stderr.write('usage: fmt-inventory.py --max-hunks=N < fmt-diff\n')
            raise SystemExit(2)
    return None


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
    max_hunks = max_hunks_from_argv()
    text = sys.stdin.read()
    if not text.strip():
        print('::notice title=fmt inventory::clean: cargo fmt reports no diff')
        if max_hunks:
            print(
                f'::notice title=fmt debt::cargo fmt is clean, but the baseline in ci.yml '
                f'is still {max_hunks}. Lower it to 0 so the debt cannot come back unnoticed.'
            )
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
    if max_hunks is not None and len(hunks) > max_hunks:
        print(
            f'::error title=fmt debt grew::cargo fmt reports {len(hunks)} hunks, '
            f'baseline is {max_hunks}. New unformatted code landed: run '
            '`cargo fmt --all` on the touched files (or lower the debt on purpose).'
        )
        sys.exit(1)


if __name__ == '__main__':
    main()
