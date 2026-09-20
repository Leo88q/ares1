#!/usr/bin/env python3
"""Bound localnet tests and reap their validator process group even on failure.

Only the spawned test group's processes are signalled. Never kill validators by
name or touch an operator's external RPC. Linux/CI runner (setsid) required.
"""
import os
import signal
import subprocess
import sys
import time

process = subprocess.Popen(["anchor", "test", "--skip-build"], start_new_session=True)
try:
    try:
        result = process.wait(timeout=600)
    except subprocess.TimeoutExpired:
        print("Localnet integration timed out after 600 seconds", file=sys.stderr)
        result = 124
finally:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        if sig == signal.SIGTERM:
            time.sleep(1)
    process.wait()
sys.exit(result if result >= 0 else 128 - result)
