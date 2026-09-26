"""Bounded clippy inventory as check annotations.

Why this exists: the lint gate (`cargo clippy -D warnings`) is advisory (F-18)
and the job log archive is not downloadable from API-only review environments
(see scripts/ci-run.sh, which publishes a redacted excerpt for the same reason).
That excerpt is capped and filtered, so a codebase with dozens of pre-existing
lints is effectively untriaged: the step is red and nobody can see what to fix.

This reads `cargo clippy --message-format=json` from stdin and prints at most
ten notices (GitHub's per-step annotation limit): a one-line summary plus the
most frequent lints with their `file:line` locations.

Public build metadata only: file paths and lint names, no source excerpts.
"""
import collections
import json
import sys

# GitHub allows ten annotations per step; keep one slot free.
MAX_NOTICES = 9
# Individual annotations are truncated at 4096 characters.
MAX_CHARS = 3800
MAX_LOCS_PER_LINT = 40


def collect(stream):
    counts = collections.Counter()
    locations = collections.defaultdict(list)
    for raw in stream:
        raw = raw.strip()
        if not raw.startswith('{'):
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if message.get('reason') != 'compiler-message':
            continue
        diagnostic = message.get('message') or {}
        code = (diagnostic.get('code') or {}).get('code') or ''
        if not code.startswith('clippy::'):
            continue
        lint = code.split('::', 1)[1]
        counts[lint] += 1
        spans = diagnostic.get('spans') or []
        primary = [s for s in spans if s.get('is_primary')] or spans
        if primary and len(locations[lint]) < MAX_LOCS_PER_LINT:
            span = primary[0]
            locations[lint].append(f"{span.get('file_name', '?')}:{span.get('line_start', 0)}")
    return counts, locations


def chunk(lines):
    """Pack `lines` into at most MAX_NOTICES payloads under MAX_CHARS each."""
    pages, current = [], ''
    for line in lines:
        candidate = f'{current}\n{line}' if current else line
        if len(candidate) > MAX_CHARS or len(pages) == MAX_NOTICES - 1 and len(candidate) > MAX_CHARS:
            pages.append(current)
            current = line
        else:
            current = candidate
    if current:
        pages.append(current)
    return pages[:MAX_NOTICES]


def escape(text):
    return text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def main():
    counts, locations = collect(sys.stdin)
    total = sum(counts.values())
    if not total:
        print('::notice title=clippy inventory::clean: no clippy diagnostics')
        return
    summary = f'{total} diagnostics: ' + '; '.join(
        f'{lint} x{count}' for lint, count in counts.most_common(20)
    )
    print('::notice title=clippy inventory::' + escape(summary))
    lines = [
        f'{lint} x{counts[lint]}: ' + ' '.join(locations[lint])
        for lint, _ in counts.most_common()
    ]
    for index, page in enumerate(chunk(lines), start=1):
        print(f'::notice title=clippy locations {index}::' + escape(page))


if __name__ == '__main__':
    main()
