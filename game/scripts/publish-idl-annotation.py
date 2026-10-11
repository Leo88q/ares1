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
# Use 4000-character parts and stay under the per-step limit of ten notices
# (8 payload parts plus the checksum and part count).
chunk_size = 4000
parts = [payload[i:i + chunk_size] for i in range(0, len(payload), chunk_size)]
if len(parts) > 8:
    raise SystemExit("IDL exceeds the bounded recovery annotation transport; use the build artifact")
print("::notice title=ares-public-idl-sha256::" + hashlib.sha256(idl).hexdigest())
print("::notice title=ares-public-idl-parts::" + str(len(parts)))
for i, part in enumerate(parts):
    print(f"::notice title=ares-public-idl-part-{i:03d}::" + part)
