# Real devnet evidence — not populated yet

There are **no captured real devnet transactions** in this directory. Synthetic
fixtures are in `../synthetic/` and are never evidence of live deployment.

With a verified read-only RPC, migrated PostgreSQL and a caught-up local exporter:

```sh
node --env-file=.env --import tsx scripts/verify-devnet.ts --capture-fixture
```

The tool checks the devnet genesis, executable program account, a finalized
transaction, decoding, readyz, and the exporter's corresponding event payloads.
Only a successful smoke can create `<signature>.json` here, with provenance,
collection time, slot, program ID, source IDL SHA-256 and the unmodified RPC
transaction. It never records provider URLs or credentials. Review and scan any
captured fixture before committing it. A fixture/green smoke does **not** verify
all mint/treasury/PDA addresses, deployed binary provenance or central integration.

2026-09-21: an attempted public devnet RPC probe from the sandbox failed at the
transport layer. `lastVerifiedAt` remains null; no real fixture was manufactured.
