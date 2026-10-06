# Synthetic codec fixtures

`idl-events.json` contains hand-constructed Borsh payloads for every event in the
pinned ARES-1 IDL. It is NOT a network capture. Integer fixtures deliberately
include a u64 above JavaScript's safe-integer limit and a negative i64.

`hub-ingest-samples.json` is also synthetic: it fixes the shape of
`POST /api/ingest/solana` samples (on-chain coordinates, `payload` with u64 as
decimal strings), documents the hub adapter names that ARES-1 does **not** emit,
and shows why an off-chain sample cannot satisfy the hub's `offchainIdentity()`
contract today (no eventId/sessionId/seq exist). Nothing in it was posted anywhere.

Transaction/invocation fixtures in `tests/helpers.ts` and RPC mocks are also
synthetic. They test log attribution, multiple emit!s, replay, failure recovery
and the process/HTTP path, not devnet deployment or real economic activity.

Real (but non-certified) devnet captures live in `../real-devnet/` and are marked
`real_devnet_public_explorer_capture`.
