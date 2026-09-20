"""Public build metadata ONLY, not logs or keypairs.

Artifact downloads may be inaccessible to API-only review environments. Publish a
bounded, checksummed compressed copy of the generated public IDL as a check
annotation as well. Source-run SHA is verified by the retrieval script.
"""
import base64
import gzip
import hashlib
import json
from pathlib import Path

idl = Path("target/idl/solana_potato.json").read_bytes()
parsed = json.loads(idl)
assert "instructions" in parsed and "address" in parsed
payload = base64.b64encode(gzip.compress(idl, mtime=0)).decode("ascii")
# GitHub truncates individual workflow annotations to 4096 characters.
# Stay under that limit AND the per-step limit of ten notice annotations.
parts = [payload[i:i + 3000] for i in range(0, len(payload), 3000)]
if len(parts) > 8:
    raise SystemExit("IDL too large for recovery annotations; use the build artifact")
print("::notice title=ares-public-idl-sha256::" + hashlib.sha256(idl).hexdigest())
print("::notice title=ares-public-idl-parts::" + str(len(parts)))
for i, part in enumerate(parts):
    print(f"::notice title=ares-public-idl-part-{i:03d}::" + part)
