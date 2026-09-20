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
if len(payload) > 48000:
    raise SystemExit("IDL too large for recovery annotation; use the build artifact")
print("::notice title=ares-public-idl-sha256::" + hashlib.sha256(idl).hexdigest())
print("::notice title=ares-public-idl-gzip-base64::" + payload)
