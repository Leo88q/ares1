#!/usr/bin/env python3
"""Restore the pinned CC0 Martian field models; --check verifies offline.

No upstream code is executed. Original glTF is losslessly packaged as GLB by
our existing local helper. GitHub authentication uses gh, not pasted credentials.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "apps/web/public/models/fields"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("ares_local_asset_helpers", HERE / "fetch-colony-assets.py")
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    manifest = json.loads((ROOT / "manifest.json").read_text())
    total = 0
    for asset in manifest["assets"] + manifest["notices"]:
        path = ROOT / asset["file"]
        data = path.read_bytes() if args.check else helpers.fetch(asset)
        if len(data) != asset["bytes"] or hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise ValueError(f"Pinned asset mismatch: {asset['file']}")
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        total += len(data)
        print(f"OK {asset['file']} ({len(data):,} bytes)")
    print(f"Verified {len(manifest['assets'])} CC0 field models + original notices: {total:,} bytes")


if __name__ == "__main__":
    main()
