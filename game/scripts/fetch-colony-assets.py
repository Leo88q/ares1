#!/usr/bin/env python3
"""Restore ONLY the pinned CC0 colony assets. No network is needed for --check.

Usage: python3 scripts/fetch-colony-assets.py [--check]
Uses the existing GitHub CLI connection; never downloads or executes upstream code.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1] / "apps/web/public/models/colony"


def pack_gltf(source: bytes) -> bytes:
    """Losslessly repackage a single embedded glTF buffer as GLB 2.0."""
    doc = json.loads(source)
    buffers = doc.get("buffers", [])
    if len(buffers) != 1 or not buffers[0].get("uri", "").startswith("data:"):
        raise ValueError("Expected exactly one embedded buffer, not external URLs")
    binary = base64.b64decode(buffers[0]["uri"].split(",", 1)[1], validate=True)
    if len(binary) != buffers[0]["byteLength"]:
        raise ValueError("glTF buffer length mismatch")
    if any("uri" in image for image in doc.get("images", [])):
        raise ValueError("Expected images embedded in bufferViews")
    del buffers[0]["uri"]
    return pack_glb(doc, binary)


def pack_glb(doc: dict, binary: bytes) -> bytes:
    encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    length = 12 + 8 + len(encoded) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, length)
            + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def fetch_blob(asset: dict) -> bytes:
    response = subprocess.run(
        ["gh", "api", f"repos/{asset['repository']}/git/blobs/{asset['sourceBlob']}",
         "--jq", ".content"], check=True, capture_output=True, text=True,
    )
    source = base64.b64decode(response.stdout)
    git_sha = hashlib.sha1(f"blob {len(source)}\0".encode() + source).hexdigest()
    if git_sha != asset["sourceBlob"]:
        raise ValueError(f"Upstream blob mismatch: {asset['sourcePath']}")
    return source


def fetch(asset: dict) -> bytes:
    source = fetch_blob(asset)
    if asset["sourcePath"].endswith(".gltf"):
        return pack_gltf(source)
    if not asset.get("embeddedImages"):
        return source
    json_length = struct.unpack_from("<I", source, 12)[0]
    doc = json.loads(source[20:20 + json_length])
    binary = source[28 + json_length:][:doc["buffers"][0]["byteLength"]]
    for image in doc.get("images", []):
        uri = image.get("uri")
        if not uri:
            continue
        dependency = next(d for d in asset["embeddedImages"] if d["uri"] == uri)
        pixels = fetch_blob(dependency)
        if hashlib.sha256(pixels).hexdigest() != dependency["sha256"]:
            raise ValueError("Image dependency SHA-256 mismatch")
        binary += b"\0" * (-len(binary) % 4)
        image["bufferView"] = len(doc["bufferViews"])
        image["mimeType"] = "image/png"
        del image["uri"]
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(pixels)})
        binary += pixels
    doc["buffers"][0]["byteLength"] = len(binary)
    return pack_glb(doc, binary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify bundled files offline")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "manifest.json").read_text())
    total = 0
    for asset in manifest["assets"] + manifest["notices"]:
        path = ROOT / asset["file"]
        content = path.read_bytes() if args.check else fetch(asset)
        if hashlib.sha256(content).hexdigest() != asset["sha256"]:
            raise ValueError(f"SHA-256 mismatch: {asset['file']}")
        if len(content) != asset["bytes"]:
            raise ValueError(f"Size mismatch: {asset['file']}")
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        total += len(content)
        print(f"OK {asset['file']} ({len(content):,} bytes)")
    print(f"Verified {total:,} bytes; models and notices are pinned to GitHub blobs.")


if __name__ == "__main__":
    main()
