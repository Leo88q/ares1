#!/usr/bin/env bash
# Keep ordinary job logs; expose a bounded, redacted error excerpt in check
# annotations when the environment cannot download GitHub's log archive.
# CI only: never provide production keys to these commands.
set -euo pipefail
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
if "$@" 2>&1 | tee "$LOG"; then
  exit 0
else
  RESULT=$?
  python3 - "$LOG" "$RESULT" <<'PY'
import re,sys
text=open(sys.argv[1],errors='replace').read()
status=sys.argv[2]
text=re.sub(r'\x1b\[[0-9;]*m','',text)
lines=text.splitlines()

def sanitize(value):
    value=re.sub(r'https?://[^\s<>"\']+','[REDACTED_URL]',value,flags=re.I)
    value=re.sub(r'((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s&,;]+',r'\1[REDACTED]',value,flags=re.I)
    return value

def command_data(value):
    return value.replace('%','%25').replace('\r','%0D').replace('\n','%0A').replace('::','%3A%3A')

# Mocha can report several independent Anchor integration failures. Keep every
# numbered block, not just the final assertion, so a red CI run is actionable.
headers=[i for i,line in enumerate(lines) if re.match(r'^\s*\d+\)\s+\S',line)]
summary=next((i for i,line in enumerate(lines) if re.match(r'^\s*\d+\s+failing\s*$',line)),None)
if headers and summary is not None:
    starts=[i for i in headers if i > summary]
    if not starts: starts=headers
    for number,start in enumerate(starts[:10],1):
        next_header=next((h for h in starts[number:] if h>start),len(lines))
        end=min(next_header,len(lines))
        block='\n'.join(lines[start:end]).strip()
        block=re.split(r'\n(?:error Command failed|info Visit )',block,maxsplit=1)[0]
        block=sanitize(block)[-7000:]
        print(f'::error title=Anchor test failure {number}::{command_data(block)}')
    omitted=max(0,len(starts)-10)
    passing=next((line.strip() for line in lines[max(0,summary-2):summary] if re.match(r'^\s*\d+\s+passing',line)), 'passing count unavailable')
    failing=lines[summary].strip()
    print('::error title=Validation command failed::'+command_data(f'exit={status}; {passing}; {failing}; omitted_failure_blocks={omitted}'))
else:
    interesting=[i for i,line in enumerate(lines) if re.search(r'error\[|^error:|^Error:|FAILED|panicked|AssertionError|failing|stack offset',line,re.I)]
    selected=set()
    for i in interesting[-12:]: selected.update(range(max(0,i-1),min(len(lines),i+5)))
    if not selected: selected.update(range(max(0,len(lines)-20),len(lines)))
    message=sanitize('\n'.join(lines[i] for i in sorted(selected))[-10000:])
    print('::error title=Validation command failed::'+command_data(message))
PY
  exit "$RESULT"
fi
