# Synthetic codec fixtures

`idl-events.json` contains hand-constructed Borsh payloads for every event in the
pinned ARES-1 IDL. It is NOT a network capture. Integer fixtures deliberately
include a u64 above JavaScript's safe-integer limit and a negative i64.

Transaction/invocation fixtures in `tests/helpers.ts` and RPC mocks are also
synthetic. They test log attribution, multiple emit!s, replay, failure recovery
and the process/HTTP path, not devnet deployment or real economic activity.
