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
  python3 - "$LOG" <<'PY'
import re,sys
text=open(sys.argv[1],errors='replace').read()
text=re.sub(r'\x1b\[[0-9;]*m','',text)
lines=text.splitlines()
interesting=[i for i,line in enumerate(lines) if re.search(r'error\[|^error:|^Error:|FAILED|panicked|AssertionError|failing|stack offset',line,re.I)]
selected=set()
for i in interesting[-12:]: selected.update(range(max(0,i-1),min(len(lines),i+5)))
if not selected: selected.update(range(max(0,len(lines)-20),len(lines)))
message='\n'.join(lines[i] for i in sorted(selected))[-10000:]
message=re.sub(r'https?://[^\s<>"\']+','[REDACTED_URL]',message,flags=re.I)
message=re.sub(r'((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s&,;]+',r'\1[REDACTED]',message,flags=re.I)
message=message.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
print('::error title=Validation command failed::'+message)
PY
  exit "$RESULT"
fi
